"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { exhibitionPackFieldKey } from "@/lib/download/access";
import { useDownloadPreset } from "@/lib/download/preset";
import { DownloadRequestError } from "@/lib/download/errors";
import { useActingAs } from "@/context/ActingAsContext";
import { createAccessRequest } from "@/lib/supabase/relationshipAccess";

type Props = {
  exhibitionId: string;
  hostProfileId: string | null;
  curatorId: string | null;
  userId: string | null;
};

type Phase = "pending" | "download" | "request" | "hidden";

export function ExhibitionPackActions({
  exhibitionId,
  hostProfileId,
  curatorId,
  userId,
}: Props) {
  const { t } = useT();
  const preset = useDownloadPreset();
  const { actingAsProfileId } = useActingAs();
  const [phase, setPhase] = useState<Phase>("pending");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setPhase("hidden");
      return;
    }
    let cancelled = false;
    setPhase("pending");
    void (async () => {
      const { checkExhibitionPack } = await import("@/lib/download/runDownload");
      const result = await checkExhibitionPack(exhibitionId, actingAsProfileId);
      if (cancelled) return;
      if (result.allowed) setPhase("download");
      else if (result.canRequest) setPhase("request");
      else setPhase("hidden");
    })();
    return () => {
      cancelled = true;
    };
  }, [exhibitionId, userId, actingAsProfileId]);

  if (phase === "pending" || phase === "hidden") return null;

  async function onDownload() {
    setNotice(null);
    setBusy(true);
    try {
      const { downloadExhibitionPack } = await import("@/lib/download/runDownload");
      await downloadExhibitionPack({
        exhibitionId,
        actingAsProfileId,
        format: preset.image,
      });
    } catch (err) {
      const denied = err instanceof DownloadRequestError && err.code === "denied";
      setNotice(denied ? t("download.denied") : t("download.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onRequest() {
    if (!userId) return;
    setNotice(null);
    setBusy(true);
    const owners = [...new Set([hostProfileId, curatorId].filter((id): id is string => !!id))].filter(
      (id) => id !== userId,
    );
    if (owners.length === 0) {
      setBusy(false);
      setNotice(t("download.requestFailed"));
      return;
    }
    let ok = false;
    for (const owner of owners) {
      const { error } = await createAccessRequest({
        ownerProfileId: owner,
        subjectType: "exhibition",
        subjectId: null,
        fieldKey: exhibitionPackFieldKey(exhibitionId),
        requestType: "general_access",
        message: t("download.requestMessage"),
        sourceSurface: "exhibition",
        sourcePayload: { exhibitionId },
      });
      if (!error) ok = true;
    }
    setBusy(false);
    setNotice(ok ? t("download.requested") : t("download.requestFailed"));
  }

  return (
    <div className="mt-4 flex flex-col items-start gap-1">
      {phase === "download" ? (
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          className="rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {busy ? t("download.working") : t("download.pack")}
        </button>
      ) : (
        <button
          type="button"
          onClick={onRequest}
          disabled={busy}
          className="rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {busy ? t("download.working") : t("download.request")}
        </button>
      )}
      {notice && <p className="text-xs text-zinc-600">{notice}</p>}
    </div>
  );
}
