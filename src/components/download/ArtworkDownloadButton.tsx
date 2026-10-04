"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { canDownloadArtwork } from "@/lib/download/access";
import { useDownloadPreset } from "@/lib/download/preset";
import { DownloadRequestError } from "@/lib/download/errors";
import { useActingAs } from "@/context/ActingAsContext";

type Props = {
  artworkId: string;
  artistId: string | null;
  published: boolean;
  exhibitionPosterIds: readonly string[];
  userId: string | null;
};

export function ArtworkDownloadButton({
  artworkId,
  artistId,
  published,
  exhibitionPosterIds,
  userId,
}: Props) {
  const { t } = useT();
  const preset = useDownloadPreset();
  const { actingAsProfileId } = useActingAs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!userId || !published) return null;
  const visible = canDownloadArtwork(
    {
      userId,
      actingAsProfileId,
      accountWriterFor:
        actingAsProfileId && actingAsProfileId !== userId
          ? new Set([actingAsProfileId])
          : new Set(),
    },
    { artistId, published, exhibitionPosterIds },
  );
  if (!visible) return null;

  async function onClick() {
    setError(null);
    setBusy(true);
    try {
      const { downloadSingleArtwork } = await import("@/lib/download/runDownload");
      await downloadSingleArtwork({
        artworkId,
        actingAsProfileId,
        format: preset.image,
      });
    } catch (err) {
      const denied = err instanceof DownloadRequestError && err.code === "denied";
      setError(denied ? t("download.denied") : t("download.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        {busy ? t("download.working") : t("download.action")}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
