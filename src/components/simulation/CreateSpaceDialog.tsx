"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import {
  createEmptySpace,
  SimulationEntitlementError,
} from "@/lib/supabase/spaces";
import {
  uploadSpacePhoto,
  SpacePhotoValidationError,
} from "@/lib/simulation/storage";

/**
 * Shared "create a new space" dialog used by both the list page and
 * the artwork-detail zero-space onboarding sheet. Kept as one file so
 * the microcopy, validation, and RLS-order (row first → photo second)
 * stay identical across every entry point.
 *
 * Flow:
 *   1. User picks a photo + names the space.
 *   2. On submit we `createEmptySpace()` (RLS gate + entitlement gate).
 *   3. `uploadSpacePhoto()` stores the file and patches
 *      `spaces.photo_*` — must happen after step 1 because the
 *      storage path is scoped by `{userId}/spaces/{spaceId}/…`.
 *   4. Fire `onCreated({ id, initialTitle })` so the caller can
 *      route into `/my/spaces/{id}` (list flow) or upsert an
 *      artwork placement + route (artwork flow).
 */
type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (result: { id: string; title: string }) => void | Promise<void>;
  /** Optional initial title (e.g. shortlist title). */
  seedTitle?: string;
  /** When set, hides the built-in "cancel" button — useful when the
   *  caller wraps the dialog in a multi-step sheet. */
  hideCancel?: boolean;
  /** Optional slot rendered above the form (e.g. onboarding hint). */
  header?: React.ReactNode;
  /** When true, entitlements have already been resolved and we're
   *  called from an over-cap paywall path. The dialog is disabled. */
  paywalled?: boolean;
};

export function CreateSpaceDialog({
  open,
  onClose,
  onCreated,
  seedTitle,
  hideCancel,
  header,
  paywalled = false,
}: Props) {
  const { t } = useT();
  const [title, setTitle] = useState(seedTitle ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      // Reset the form whenever the dialog opens. This is the canonical
      // "sync local state to external open flag" pattern — HANDOFF
      // 2026-08-17 (13) established the disable comment as the accepted
      // suppression. Only the first setState needs the annotation; the
      // linter groups the remaining ones under the same effect body.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(seedTitle ?? "");
      setFile(null);
      setError(null);
    }
  }, [open, seedTitle]);

  const handleSubmit = useCallback(async () => {
    if (paywalled) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError(t("simulation.create.errorTitle"));
      return;
    }
    if (!file) {
      setError(t("simulation.create.errorPhoto"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { data: space, error: createErr } = await createEmptySpace({
        title: trimmed,
        kind: "room_photo_2d",
      });
      if (createErr || !space) {
        setSubmitting(false);
        setError(
          (createErr as { message?: string })?.message ??
            t("simulation.create.errorGeneric"),
        );
        return;
      }
      try {
        await uploadSpacePhoto(space.id, file);
      } catch (uploadErr) {
        setSubmitting(false);
        if (uploadErr instanceof SpacePhotoValidationError) {
          setError(t("simulation.create.errorMime"));
        } else {
          setError(t("simulation.errors.uploadFailed"));
        }
        return;
      }
      await onCreated({ id: space.id, title: trimmed });
      setSubmitting(false);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof SimulationEntitlementError) {
        setError(t("simulation.errors.entitlement"));
      } else {
        setError(
          (err as { message?: string })?.message ??
            t("simulation.create.errorGeneric"),
        );
      }
    }
  }, [file, onCreated, paywalled, t, title]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("simulation.create.title")}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900">
            {t("simulation.create.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-zinc-400 hover:text-zinc-600 disabled:opacity-40"
            aria-label={t("simulation.picker.close")}
          >
            ×
          </button>
        </div>

        {header && <div className="mb-3">{header}</div>}

        <div className="space-y-3">
          <div>
            <label
              htmlFor="space-title-input"
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              {t("simulation.create.titleLabel")}
            </label>
            <input
              id="space-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("simulation.create.titlePlaceholder")}
              disabled={submitting || paywalled}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              {t("simulation.create.photoLabel")}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting || paywalled}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                {file
                  ? t("simulation.create.photoReplace")
                  : t("simulation.create.photoPick")}
              </button>
              {file && (
                <span className="truncate text-xs text-zinc-500">
                  {file.name}
                </span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (error) setError(null);
              }}
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              {t("simulation.create.photoHint")}
            </p>
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          {!hideCancel && (
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {t("simulation.create.cancel")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || paywalled || !file || !title.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitting
              ? t("simulation.create.submitting")
              : t("simulation.create.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
