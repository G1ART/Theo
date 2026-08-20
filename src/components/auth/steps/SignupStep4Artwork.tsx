"use client";

/**
 * Signup v2 · Step 4 (Artwork quick-start) — wireframe pixel-fidelity
 * pass (2026-08-20). Phase 2 behavior preserved verbatim.
 *
 * Layout (desktop ≥sm):
 *   ┌───────────────┬───────────────────────────────┐
 *   │               │ Title*         │ Year*        │
 *   │  Uploader     │ Medium         │ Size         │
 *   │  (aspect-1/1) │ Status                        │
 *   │               │ Description                   │
 *   └───────────────┴───────────────────────────────┘
 *
 * Mobile (<sm): uploader on top full-width, fields stacked below.
 *
 * Copy is role-aware (§5 #7):
 *   - artist   → primary CTA "Upload your first work"; skip is a
 *                secondary text link.
 *   - anyone   → primary CTA "Skip for now"; upload sits under a
 *     else       "Show anyway" disclosure.
 *
 * On success or skip we clear the wizard sessionStorage draft and
 * route to `/feed`. A brief `TheoLoadingMark` covers the network
 * round-trip so the tone doesn't whip-flash to the dense feed.
 */

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { OvalInput } from "@/components/auth/primitives/OvalInput";
import { OvalSelect } from "@/components/auth/primitives/OvalSelect";
import { PillButton } from "@/components/auth/primitives/PillButton";
import { TheoLoadingMark } from "@/components/brand/TheoLoadingMark";
import { getSession } from "@/lib/supabase/auth";
import { useT } from "@/lib/i18n/useT";
import { TAXONOMY } from "@/lib/profile/taxonomy";
import {
  createArtworkForCreatedIntent,
  findMyDedupCandidates,
  type SignupStep4Intent,
} from "@/lib/supabase/createArtworkForCreatedIntent";
import type { SignupStepApi } from "../SignupWizardShell";

const STATUS_OPTIONS: readonly {
  value: SignupStep4Intent;
  labelKey: string;
}[] = [
  { value: "CREATED", labelKey: "auth.signupV2.step4.status.created" },
  { value: "OWNS", labelKey: "auth.signupV2.step4.status.owns" },
  { value: "CURATED", labelKey: "auth.signupV2.step4.status.curated" },
];

function defaultIntentForRole(
  mainRole: string,
): SignupStep4Intent | "" {
  if (mainRole === "artist") return "CREATED";
  if (mainRole === "collector") return "OWNS";
  return "";
}

const MAX_DESCRIPTION_LEN = 2000;
const DEDUP_DEBOUNCE_MS = 500;

export function SignupStep4Artwork({ api }: { api: SignupStepApi }) {
  const { t, locale } = useT();
  const router = useRouter();

  const isArtist = api.state.mainRole === "artist";

  // Non-artist personas start with the form collapsed. Artists see the
  // form open so the "Add your first piece" tone lands immediately.
  const [expanded, setExpanded] = useState<boolean>(isArtist);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState<string>("");
  const [medium, setMedium] = useState("");
  const [size, setSize] = useState("");
  const [description, setDescription] = useState("");
  const [intent, setIntent] = useState<SignupStep4Intent | "">(() =>
    defaultIntentForRole(api.state.mainRole),
  );

  const [dedupCandidates, setDedupCandidates] = useState<
    { id: string; title: string | null }[]
  >([]);
  const dedupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dedupSeqRef = useRef(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [uploadPhase, setUploadPhase] = useState<
    "idle" | "uploading" | "done"
  >("idle");

  // Preload the current session's user id so we can (a) scope the
  // dedup probe correctly and (b) surface a clean error if the wizard
  // somehow landed here without a session (Step 3 should always have
  // established one first, but defence-in-depth).
  useEffect(() => {
    let cancelled = false;
    void getSession().then((res) => {
      if (cancelled) return;
      setUserId(res.data.session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Object-URL hygiene. Revoke the preview blob URL when the file
  // changes or the component unmounts.
  useEffect(() => {
    if (!file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* best-effort */
      }
    };
  }, [file]);

  // Debounced dedup probe (§8 #7).
  useEffect(() => {
    if (dedupTimerRef.current) clearTimeout(dedupTimerRef.current);
    const q = title.trim();
    if (!userId || q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDedupCandidates([]);
      return;
    }
    const seq = ++dedupSeqRef.current;
    dedupTimerRef.current = setTimeout(async () => {
      const rows = await findMyDedupCandidates(userId, q);
      if (seq !== dedupSeqRef.current) return;
      setDedupCandidates(rows);
    }, DEDUP_DEBOUNCE_MS);
    return () => {
      if (dedupTimerRef.current) clearTimeout(dedupTimerRef.current);
    };
  }, [title, userId]);

  const statusOptions = useMemo(
    () =>
      STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );

  const skipAndFinish = useCallback(() => {
    api.clearDraft();
    router.replace("/feed?tab=all&sort=latest");
  }, [api, router]);

  const canSubmit =
    !!file && !!title.trim() && !!intent && !submitting && !!userId;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit || !file || !intent || !userId) return;

    setSubmitting(true);
    setUploadPhase("uploading");
    const parsedYear = year.trim() ? Number.parseInt(year.trim(), 10) : NaN;
    const res = await createArtworkForCreatedIntent({
      userId,
      intent,
      file,
      title,
      year: Number.isFinite(parsedYear) ? parsedYear : null,
      medium,
      size,
      description,
      locale,
    });

    if (!res.ok) {
      setSubmitting(false);
      setUploadPhase("idle");
      setError(
        `${t("auth.signupV2.step4.uploadError")} (${res.code})`,
      );
      return;
    }

    setUploadPhase("done");
    api.clearDraft();
    router.replace("/feed?tab=all&sort=latest");
  }

  if (submitting && uploadPhase !== "idle") {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <TheoLoadingMark label={t("auth.signupV2.step4.uploading")} />
      </div>
    );
  }

  const primaryCta = isArtist
    ? t("auth.signupV2.step4.submitArtist")
    : t("auth.signupV2.step4.skipCta");
  const skipTextForArtist = t("auth.signupV2.step4.skipLink");
  const showAnywayLabel = t("auth.signupV2.step4.showAnyway");

  // Non-artist collapsed lead: primary CTA is "Skip" and a small
  // secondary link toggles the actual form.
  if (!expanded) {
    return (
      <div className="max-w-md space-y-6">
        <p className="-mt-2 mb-2 text-sm text-zinc-500">
          {t("auth.signupV2.step4.nonArtistBody")}
        </p>
        <PillButton
          type="button"
          variant="primary"
          fullWidth
          onClick={skipAndFinish}
        >
          {t("auth.signupV2.step4.skipCta")}
        </PillButton>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mx-auto block text-center text-xs text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
        >
          {showAnywayLabel}
        </button>
      </div>
    );
  }

  const expandedBodyKey = isArtist
    ? "auth.signupV2.step4.artistSubtitle"
    : "auth.signupV2.step4.nonArtistSubtitle";

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <p className="-mt-2 mb-2 text-sm text-zinc-500">
        {t(expandedBodyKey)}
      </p>

      <div className="grid grid-cols-1 items-start gap-8 sm:grid-cols-[240px_1fr]">
        <ArtworkPhotoUploader
          file={file}
          previewUrl={previewUrl}
          onChange={setFile}
          uploadLabel={t("auth.signupV2.step4.photoLabel")}
          uploadHint={t("auth.signupV2.step4.photoHint")}
          removeLabel={t("auth.signupV2.step4.photoRemove")}
        />

        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <OvalInput
              labelStyle="outer"
              label={t("auth.signupV2.step4.titleLabel")}
              value={title}
              onChange={setTitle}
              required
              hint={t("auth.signupV2.step4.titleHint")}
            />
            <OvalInput
              labelStyle="outer"
              label={t("auth.signupV2.step4.yearLabel")}
              type="text"
              inputMode="numeric"
              value={year}
              onChange={(v) => setYear(v.replace(/[^0-9]/g, "").slice(0, 4))}
              hint={t("auth.signupV2.step4.yearHint")}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <OvalInput
              labelStyle="outer"
              label={t("auth.signupV2.step4.mediumLabel")}
              value={medium}
              onChange={setMedium}
              hint={t("auth.signupV2.step4.mediumHint")}
              list="signupv2-step4-medium"
            />
            <OvalInput
              labelStyle="outer"
              label={t("auth.signupV2.step4.sizeLabel")}
              value={size}
              onChange={setSize}
              hint={t("auth.signupV2.step4.sizeHint")}
            />
          </div>
          <datalist id="signupv2-step4-medium">
            {TAXONOMY.mediumOptions.map((opt) => (
              <option key={opt.value} value={t(opt.labelKey)} />
            ))}
          </datalist>

          <OvalSelect
            labelStyle="outer"
            label={t("auth.signupV2.step4.statusLabel")}
            value={intent}
            onChange={(v) => setIntent((v as SignupStep4Intent) || "")}
            options={statusOptions}
            placeholder={t("auth.signupV2.step4.statusPlaceholder")}
            hint={t("auth.signupV2.step4.statusHint")}
          />

          <div>
            <label className="mb-1.5 block px-1 text-xs font-medium text-zinc-600">
              {t("auth.signupV2.step4.descriptionLabel")}
            </label>
            <div className="rounded-3xl border border-zinc-300 bg-white px-5 py-3 transition-shadow focus-within:border-zinc-900 focus-within:ring-2 focus-within:ring-zinc-100">
              <textarea
                value={description}
                onChange={(e) => {
                  const v = e.target.value;
                  setDescription(
                    v.length > MAX_DESCRIPTION_LEN
                      ? v.slice(0, MAX_DESCRIPTION_LEN)
                      : v,
                  );
                }}
                rows={3}
                placeholder={t("auth.signupV2.step4.descriptionPlaceholder")}
                className="w-full resize-none bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
                maxLength={MAX_DESCRIPTION_LEN}
              />
              <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-400">
                <span>{t("auth.signupV2.step4.descriptionHint")}</span>
                <span>
                  {description.length} / {MAX_DESCRIPTION_LEN}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {dedupCandidates.length > 0 && (
        <div
          role="alert"
          className="rounded-3xl border border-amber-200 bg-amber-50/70 px-5 py-3 text-xs text-amber-900"
        >
          <p className="font-medium">
            {t("auth.signupV2.step4.dedupWarning")}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-800">
            {dedupCandidates.slice(0, 3).map((row) => (
              <li key={row.id}>{row.title ?? t("common.untitled")}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-3xl border border-red-100 bg-red-50 px-5 py-3 text-xs text-red-700"
        >
          {error}
        </p>
      )}

      <div className="space-y-2">
        <PillButton
          type="submit"
          variant="primary"
          fullWidth
          loading={submitting}
          disabled={!canSubmit}
        >
          {primaryCta}
        </PillButton>
        <button
          type="button"
          onClick={skipAndFinish}
          className="mx-auto block text-center text-xs text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
        >
          {isArtist ? skipTextForArtist : t("auth.signupV2.step4.skipCta")}
        </button>
      </div>
      <p className="text-center text-[11px] text-zinc-400">
        {t("auth.signupV2.step4.footerHint")}
      </p>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Uploader tile
// ─────────────────────────────────────────────────────────────────────

/** Square drop-zone tile that matches the wireframe's Step 4 upload
 *  affordance. On desktop it sits in a 240px column beside the fields;
 *  on mobile it becomes full-width above the fields. Preview and X-
 *  remove button live inside the same aspect box so the layout doesn't
 *  jump between empty and filled states. */
function ArtworkPhotoUploader({
  file,
  previewUrl,
  onChange,
  uploadLabel,
  uploadHint,
  removeLabel,
}: {
  file: File | null;
  previewUrl: string | null;
  onChange: (next: File | null) => void;
  uploadLabel: string;
  uploadHint: string;
  removeLabel: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block px-1 text-xs font-medium text-zinc-600">
        {uploadLabel}
      </label>
      <label
        className={`group relative flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border border-dashed p-4 text-center text-xs text-zinc-500 transition-colors ${
          file
            ? "border-zinc-200"
            : "border-zinc-300 hover:border-zinc-500 hover:text-zinc-800"
        }`}
      >
        {previewUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt=""
              className="absolute inset-1 rounded-2xl object-contain"
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onChange(null);
              }}
              aria-label={removeLabel}
              className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-sm text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-white hover:text-zinc-900"
            >
              ×
            </button>
          </>
        ) : (
          <>
            <span
              aria-hidden
              className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-300 text-lg text-zinc-500"
            >
              +
            </span>
            <span>{uploadHint}</span>
          </>
        )}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (next) onChange(next);
          }}
        />
      </label>
    </div>
  );
}
