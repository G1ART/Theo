"use client";

/**
 * CV PDF uploader — QA 2026-06-26 (Wave 5 #6).
 *
 * Lives next to the structured CV editor at /my/profile/cv. Lets an
 * artist offer a downloadable resume PDF alongside the structured
 * entries. The actual storage object lives in the existing `artworks`
 * bucket under `{userId}/profile/cv/{uuid}-{safeName}` (Shape 1 of
 * `can_manage_artworks_storage_path`, so no storage policy changes are
 * required). The path itself is mirrored on `profiles.cv_pdf_path`
 * via the dedicated `update_my_cv_pdf_path` RPC.
 *
 * Behaviour:
 *   - Upload validates MIME (`application/pdf`) and size (10 MB cap).
 *   - On successful upload, we call the RPC to persist the new path
 *     and roll the storage object back if the RPC fails.
 *   - Replacing an existing PDF removes the previous storage object
 *     after the new path is persisted (best-effort, so a transient
 *     storage error doesn't strand the new file).
 *   - Removing clears the column first, then best-effort-deletes the
 *     storage object so a transient storage error doesn't leave the
 *     profile in a half-state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { FloorPanel } from "@/components/ds/FloorPanel";
import { supabase } from "@/lib/supabase/client";
import {
  getProfileCvPdfUrl,
  PROFILE_CV_MAX_BYTES,
  ProfileCvValidationError,
  removeProfileCvPdf,
  uploadProfileCvPdf,
} from "@/lib/supabase/storage";
import { getMyCvPdfPath, updateMyCvPdfPath } from "@/lib/supabase/profileCv";
import { useActingAs } from "@/context/ActingAsContext";
import { listMyDelegations } from "@/lib/supabase/delegations";
import { profileManageGrants } from "@/lib/studio/profileManageAccess";
import { saveActingCvPdfPath } from "@/lib/supabase/actingProfileWrite";
import { getProfileById } from "@/lib/supabase/profiles";

type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "removing" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

export function CvPdfUploader() {
  const { t } = useT();
  const { actingAsProfileId } = useActingAs();
  const actingSubjectRef = useRef<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let subjectId: string | null = null;
      if (actingAsProfileId) {
        const { data } = await listMyDelegations();
        const row = (data?.received ?? []).find(
          (item) =>
            item.delegator_profile_id === actingAsProfileId && item.scope_type === "account",
        );
        const allowed = profileManageGrants({
          viewerId: "operator",
          profileId: actingAsProfileId,
          actingProfileId: actingAsProfileId,
          delegation: row
            ? {
                scopeType: row.scope_type,
                status: row.status,
                permissions: row.permissions ?? [],
                expiresAt: row.expires_at,
              }
            : null,
        }).editPublicProfile;
        if (allowed) subjectId = actingAsProfileId;
      }
      actingSubjectRef.current = subjectId;
      const current = subjectId
        ? ((await getProfileById(subjectId)).data as { cv_pdf_path?: string | null } | null)
            ?.cv_pdf_path ?? null
        : (await getMyCvPdfPath()).path;
      if (!alive) return;
      setPath(current);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [actingAsProfileId]);

  const flashSuccess = useCallback((message: string) => {
    setStatus({ kind: "success", message });
    window.setTimeout(() => {
      setStatus((prev) =>
        prev.kind === "success" && prev.message === message ? { kind: "idle" } : prev,
      );
    }, 3000);
  }, []);

  const handleFileChosen = useCallback(
    async (file: File) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = actingSubjectRef.current ?? session?.user?.id;
      if (!uid) {
        setStatus({ kind: "error", message: t("cv.pdf.errorUpload") });
        return;
      }
      const previous = path;
      setStatus({ kind: "uploading" });
      let uploadedPath: string | null = null;
      try {
        uploadedPath = await uploadProfileCvPdf(file, uid);
      } catch (err) {
        if (err instanceof ProfileCvValidationError) {
          setStatus({
            kind: "error",
            message:
              err.code === "mime"
                ? t("cv.pdf.errorMime")
                : err.code === "size"
                  ? t("cv.pdf.errorSize")
                  : t("cv.pdf.errorUpload"),
          });
        } else {
          setStatus({ kind: "error", message: t("cv.pdf.errorUpload") });
        }
        return;
      }
      const subjectId = actingSubjectRef.current;
      const saved = subjectId
        ? await saveActingCvPdfPath(subjectId, uploadedPath)
        : await updateMyCvPdfPath(uploadedPath);
      if (!saved.ok) {
        // Roll back the storage object so we don't strand a file the
        // profile can't reach.
        await removeProfileCvPdf(uploadedPath);
        setStatus({ kind: "error", message: t("cv.pdf.errorSave") });
        return;
      }
      setPath(uploadedPath);
      // Best-effort cleanup of the previous file. We never block the
      // success toast on this — if it fails the file is orphaned but
      // the profile is still consistent.
      if (previous && previous !== uploadedPath) {
        void removeProfileCvPdf(previous);
      }
      flashSuccess(t("cv.pdf.savedToast"));
    },
    [flashSuccess, path, t],
  );

  const handleRemove = useCallback(async () => {
    if (!path) return;
    const previous = path;
    setStatus({ kind: "removing" });
    const subjectId = actingSubjectRef.current;
    const saved = subjectId
      ? await saveActingCvPdfPath(subjectId, null)
      : await updateMyCvPdfPath(null);
    if (!saved.ok) {
      setStatus({ kind: "error", message: t("cv.pdf.errorRemove") });
      return;
    }
    setPath(null);
    void removeProfileCvPdf(previous);
    flashSuccess(t("cv.pdf.removedToast"));
  }, [flashSuccess, path, t]);

  const onPickFile: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void handleFileChosen(file);
  };

  const downloadUrl = getProfileCvPdfUrl(path);
  const uploading = status.kind === "uploading";
  const removing = status.kind === "removing";
  const busy = uploading || removing;

  return (
    <FloorPanel padding="md" className="space-y-3">
      <header className="space-y-1">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          {t("cv.pdf.title")}
        </h2>
        <p className="text-sm text-zinc-600">{t("cv.pdf.lead")}</p>
      </header>

      {loading ? (
        <p className="text-xs text-zinc-500">{t("common.loading")}</p>
      ) : downloadUrl ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/60 px-4 py-3">
          <span className="text-xs uppercase tracking-wider text-zinc-500">
            {t("cv.pdf.currentLabel")}
          </span>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-zinc-900 underline-offset-4 hover:underline"
          >
            {t("cv.pdf.preview")}
          </a>
          <a
            href={downloadUrl}
            download
            className="text-sm font-medium text-zinc-700 underline-offset-4 hover:underline"
          >
            {t("cv.pdf.download")}
          </a>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">{t("cv.pdf.empty")}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={onPickFile}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-400 disabled:opacity-50"
        >
          {uploading
            ? t("cv.pdf.uploading")
            : path
              ? t("cv.pdf.replace")
              : t("cv.pdf.upload")}
        </button>
        {path && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRemove()}
            className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
          >
            {removing ? t("cv.pdf.removing") : t("cv.pdf.remove")}
          </button>
        )}
        <span className="text-xs text-zinc-400">{t("cv.pdf.sizeLimit")}</span>
      </div>

      {status.kind === "error" && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {status.message}
        </p>
      )}
      {status.kind === "success" && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {status.message}
        </p>
      )}
    </FloorPanel>
  );
}
