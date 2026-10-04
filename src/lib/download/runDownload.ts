import { supabase } from "@/lib/supabase/client";
import { downloadArtworkFile } from "@/lib/supabase/storage";
import { isCameraOriginalPath } from "./displayPath";
import { downloadStem, imageExtension } from "./filenames";
import { captionForArtwork, joinStoredText } from "./captionView";
import {
  buildCaptionPdf,
  buildZip,
  renderCaptionPage,
  transcodeImage,
  triggerDownload,
  type ImageFormat,
} from "./assemble";
import type { BulkConfirmChoice } from "./preset";
import type {
  DownloadArtworkPayload,
  ExhibitionPackPayload,
} from "./types";
import type { Locale } from "@/lib/i18n/locale";
import type { SizeUnitPref } from "@/lib/size/format";
import { DownloadRequestError } from "./errors";

export { DownloadRequestError };

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function postAuthorize(body: Record<string, unknown>): Promise<Response> {
  const token = await accessToken();
  if (!token) throw new DownloadRequestError("unauthorized");
  const res = await fetch("/api/download/authorize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res;
}

async function readDisplay(path: string): Promise<Blob> {
  if (isCameraOriginalPath(path)) throw new DownloadRequestError("failed");
  return downloadArtworkFile(path);
}

function uniqueName(stem: string, used: Set<string>, ext: string): string {
  let name = `${stem}.${ext}`;
  let n = 2;
  while (used.has(name)) {
    name = `${stem}-${n}.${ext}`;
    n += 1;
  }
  used.add(name);
  return name;
}

export async function authorizeArtworks(
  artworkIds: string[],
  actingAsProfileId: string | null,
): Promise<DownloadArtworkPayload[]> {
  const res = await postAuthorize({
    kind: "artworks",
    artworkIds,
    actingAsProfileId,
  });
  if (res.status === 401) throw new DownloadRequestError("unauthorized");
  if (res.status === 403) throw new DownloadRequestError("denied");
  if (!res.ok) throw new DownloadRequestError("failed");
  const json = (await res.json()) as { artworks?: DownloadArtworkPayload[] };
  if (!json.artworks?.length) throw new DownloadRequestError("failed");
  return json.artworks;
}

export async function checkExhibitionPack(
  exhibitionId: string,
  actingAsProfileId: string | null,
): Promise<{ allowed: boolean; canRequest: boolean }> {
  const res = await postAuthorize({
    kind: "exhibition",
    intent: "check",
    exhibitionId,
    actingAsProfileId,
  });
  if (!res.ok) return { allowed: false, canRequest: false };
  const json = (await res.json()) as { allowed?: boolean; canRequest?: boolean };
  return { allowed: !!json.allowed, canRequest: !!json.canRequest };
}

export async function downloadSingleArtwork(args: {
  artworkId: string;
  actingAsProfileId: string | null;
  format: ImageFormat;
}): Promise<void> {
  const [row] = await authorizeArtworks([args.artworkId], args.actingAsProfileId);
  if (!row) throw new DownloadRequestError("failed");
  const blob = await readDisplay(row.displayPath);
  const file = await transcodeImage(blob, args.format);
  const ext = imageExtension(args.format);
  triggerDownload(file, `${downloadStem(row.title)}.${ext}`);
}

export async function downloadArtworkBundle(args: {
  artworkIds: string[];
  actingAsProfileId: string | null;
  choice: BulkConfirmChoice;
  locale: Locale;
  t: (key: string) => string;
  sizePref: SizeUnitPref | null;
}): Promise<void> {
  const rows = await authorizeArtworks(args.artworkIds, args.actingAsProfileId);
  if (args.choice === "pdf") {
    const pages: Blob[] = [];
    for (const row of rows) {
      const blob = await readDisplay(row.displayPath);
      const page = await renderCaptionPage(
        blob,
        captionForArtwork(row, args.locale, args.t, args.sizePref),
      );
      pages.push(page);
    }
    const pdf = await buildCaptionPdf(pages);
    triggerDownload(pdf, "artworks.pdf");
    return;
  }
  const format: ImageFormat = args.choice === "jpeg-zip" ? "jpeg" : "png";
  const ext = imageExtension(format);
  const used = new Set<string>();
  const built: { name: string; data: Blob }[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const blob = await readDisplay(row.displayPath);
    const file = await transcodeImage(blob, format);
    built.push({
      name: uniqueName(downloadStem(row.title, i + 1), used, ext),
      data: file,
    });
  }
  const zip = await buildZip(built);
  triggerDownload(zip, "artworks.zip");
}

export async function downloadExhibitionPack(args: {
  exhibitionId: string;
  actingAsProfileId: string | null;
  format: ImageFormat;
}): Promise<void> {
  const res = await postAuthorize({
    kind: "exhibition",
    intent: "fetch",
    exhibitionId: args.exhibitionId,
    actingAsProfileId: args.actingAsProfileId,
  });
  if (res.status === 401) throw new DownloadRequestError("unauthorized");
  if (res.status === 403) throw new DownloadRequestError("denied");
  if (!res.ok) throw new DownloadRequestError("failed");
  const json = (await res.json()) as { pack?: ExhibitionPackPayload };
  const pack = json.pack;
  if (!pack) throw new DownloadRequestError("failed");
  const ext = imageExtension(args.format);
  const files: { name: string; data: Blob }[] = [];
  const used = new Set<string>();
  let posterIndex = 1;
  for (const poster of pack.posters) {
    const blob = await readDisplay(poster.displayPath);
    if (poster.kind === "pdf") {
      files.push({
        name: uniqueName(`poster-${posterIndex}`, used, "pdf"),
        data: blob,
      });
    } else {
      const image = await transcodeImage(blob, args.format);
      files.push({
        name: uniqueName(`poster-${posterIndex}`, used, ext),
        data: image,
      });
    }
    posterIndex += 1;
  }
  const preface = joinStoredText([pack.prefaceKo, pack.prefaceEn]);
  if (preface) {
    files.push({
      name: "preface.txt",
      data: new Blob([preface], { type: "text/plain;charset=utf-8" }),
    });
  }
  for (let i = 0; i < pack.works.length; i += 1) {
    const row = pack.works[i]!;
    const blob = await readDisplay(row.displayPath);
    const image = await transcodeImage(blob, args.format);
    files.push({
      name: `works/${uniqueName(downloadStem(row.title, i + 1), used, ext)}`,
      data: image,
    });
  }
  if (files.length === 0) throw new DownloadRequestError("failed");
  const zip = await buildZip(files);
  triggerDownload(zip, `${downloadStem(pack.title)}-pack.zip`);
}
