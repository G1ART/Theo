"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useT } from "@/lib/i18n/useT";
import {
  PROFILE_MEDIA_LIMITS,
  ProfileMediaValidationError,
  removeProfileMedia,
  uploadProfileMedia,
  type ProfileMediaKind,
} from "@/lib/supabase/storage";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";

type Props = {
  /** "avatar" | "cover" | "statement" — drives mime/size limits + storage subpath */
  kind: ProfileMediaKind;
  /** Current storage path (or empty/null if none). Storage path, not URL. */
  value: string | null | undefined;
  /**
   * Called with the new storage path on successful upload, or null when the
   * user clears the image. **MUST throw on persistence failure** — the uploader
   * relies on rejection here to switch into the "save failed" UI branch.
   */
  onChange: (nextPath: string | null) => Promise<void> | void;
  /** Authenticated user id — must match auth.uid() for RLS. */
  userId: string;
  /** Visible label / aria-label for the uploader. */
  label: string;
  /** Helper text displayed under the picker. */
  hint?: string;
  /** Preview aspect ratio. cover bands are wide; avatars are square. */
  shape?: "square" | "wide";
  /** When true the remove button is hidden (e.g. avatar fallback exists upstream). */
  hideRemove?: boolean;
  /**
   * Optional vertical focal point (0–100) applied to the wide preview as
   * `object-position: center {y}%`. Used to mirror the live cover crop
   * exactly the way it'll render on the public profile.
   */
  objectPositionY?: number;
  /**
   * Optional caption shown directly under a wide preview, e.g.
   * "공개 프로필에서 이렇게 보여요" — confirms the preview = published crop.
   */
  previewCaption?: string;
};

const SHAPE_CLASSES: Record<"square" | "wide", { box: string; img: string }> = {
  square: { box: "h-24 w-24 rounded-full", img: "h-full w-full object-cover" },
  wide: {
    box: "aspect-[3/1] w-full max-w-md rounded-lg",
    img: "h-full w-full object-contain",
  },
};

const SUCCESS_KEY: Record<ProfileMediaKind, string> = {
  avatar: "profile.media.savedAvatar",
  cover: "profile.media.savedCover",
  statement: "profile.media.savedStatement",
};

const REMOVE_KEY: Record<ProfileMediaKind, string> = {
  avatar: "profile.media.removedAvatar",
  cover: "profile.media.removedCover",
  statement: "profile.media.removedStatement",
};

function resolvePreviewUrl(path: string | null | undefined): string | null {
  if (!path || !path.trim()) return null;
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return getArtworkImageUrl(path, "medium");
}

function clampFocal(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 50;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

/**
 * Uploader for profile media (avatar / cover / statement hero).
 *
 * Owns its own busy/success/error state but never persists the path itself —
 * the parent decides where the storage path lands (avatar_url, cover_image_url,
 * artist_statement_hero_image_url). The uploader does best-effort cleanup of
 * the previous path on replace + clear, and surfaces an inline localized
 * success/error badge so the user gets immediate feedback without having to
 * scroll to the section-bottom or click "저장".
 */
export function ProfileMediaUploader({
  kind,
  value,
  onChange,
  userId,
  label,
  hint,
  shape = "square",
  hideRemove,
  objectPositionY,
  previewCaption,
}: Props) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [successKey, setSuccessKey] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (localPreview && localPreview.startsWith("blob:")) {
        URL.revokeObjectURL(localPreview);
      }
    };
  }, [localPreview]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const flashSuccess = useCallback((key: string) => {
    setErr(null);
    setSuccessKey(key);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setSuccessKey(null), 2500);
  }, []);

  const previewUrl = localPreview ?? resolvePreviewUrl(value);

  const onPick = useCallback(
    async (file: File) => {
      setErr(null);
      setSuccessKey(null);
      const objectUrl = URL.createObjectURL(file);
      setLocalPreview(objectUrl);
      setBusy(true);
      try {
        const nextPath = await uploadProfileMedia(file, kind, userId);
        const previousPath = value ?? null;
        await onChange(nextPath);
        if (previousPath && previousPath !== nextPath) {
          await removeProfileMedia(previousPath);
        }
        flashSuccess(SUCCESS_KEY[kind]);
      } catch (e) {
        if (e instanceof ProfileMediaValidationError) {
          if (e.code === "size") {
            setErr(t("profile.media.errorSize").replace("{mb}", String(Math.round(PROFILE_MEDIA_LIMITS[kind].maxBytes / (1024 * 1024)))));
          } else if (e.code === "mime") {
            setErr(t("profile.media.errorMime"));
          } else {
            setErr(e.message);
          }
        } else {
          const msg =
            (e as { message?: string } | null)?.message?.trim() || "";
          setErr(msg.length > 0 ? msg : t("profile.media.errorGeneric"));
          console.error("[profile media] upload failed", e);
        }
        URL.revokeObjectURL(objectUrl);
        setLocalPreview(null);
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [kind, userId, value, onChange, t, flashSuccess]
  );

  const onRemove = useCallback(async () => {
    setErr(null);
    setSuccessKey(null);
    setBusy(true);
    try {
      const previousPath = value ?? null;
      await onChange(null);
      if (previousPath) await removeProfileMedia(previousPath);
      setLocalPreview(null);
      flashSuccess(REMOVE_KEY[kind]);
    } catch (e) {
      const msg = (e as { message?: string } | null)?.message?.trim() || "";
      setErr(msg.length > 0 ? msg : t("profile.media.errorGeneric"));
      console.error("[profile media] remove failed", e);
    } finally {
      setBusy(false);
    }
  }, [value, onChange, t, kind, flashSuccess]);

  const shapeClasses = SHAPE_CLASSES[shape];
  const accept = "image/jpeg,image/png,image/webp";
  const focal = clampFocal(objectPositionY);
  // Only the wide cover preview tracks the focal slider; square avatars are
  // always center-cropped server-side, so applying objectPosition would be
  // misleading. Statement heroes don't expose a focal slider yet.
  const previewStyle =
    shape === "wide" && typeof objectPositionY === "number"
      ? { objectPosition: `center ${focal}%` }
      : undefined;

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-zinc-800">{label}</span>
      <div className="flex items-start gap-3">
        <div
          className={`overflow-hidden border border-zinc-200 bg-zinc-100 ${shapeClasses.box}`}
          aria-hidden={!previewUrl}
        >
          {previewUrl ? (
            <Image
              src={previewUrl}
              alt=""
              width={shape === "square" ? 96 : 480}
              height={shape === "square" ? 96 : 160}
              sizes={shape === "square" ? "96px" : "(max-width: 480px) 100vw, 480px"}
              className={shapeClasses.img}
              style={previewStyle}
              unoptimized={previewUrl.startsWith("blob:")}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
              {t("profile.media.noImage")}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            disabled={busy}
            aria-label={label}
            className="block w-full text-sm text-zinc-700 file:mr-3 file:cursor-pointer file:rounded file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-zinc-800 file:hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
            }}
          />
          {!hideRemove && previewUrl && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="self-start text-xs font-medium text-zinc-500 underline hover:text-zinc-800 disabled:opacity-50"
            >
              {t("profile.media.remove")}
            </button>
          )}
          {hint && <p className="text-xs text-zinc-500">{hint}</p>}
          {busy && <p className="text-xs text-zinc-500" aria-live="polite">{t("profile.media.uploading")}</p>}
          {!busy && successKey && (
            <p
              className="rounded bg-green-50 px-2 py-1 text-xs font-medium text-green-700"
              role="status"
              aria-live="polite"
            >
              {t(successKey)}
            </p>
          )}
          {err && (
            <p
              className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
              role="alert"
            >
              {err}
            </p>
          )}
        </div>
      </div>
      {shape === "wide" && previewUrl && previewCaption && (
        <p className="text-xs text-zinc-500">{previewCaption}</p>
      )}
    </div>
  );
}
