"use client";

/**
 * Signup v2 · Step 4 (Artwork quick-start) — wireframe pixel-fidelity
 * pass (2026-08-20). Phase 2 behavior preserved.
 *
 * Layout (desktop ≥sm):
 *   ┌───────────────┬───────────────────────────────┐
 *   │               │ Title*         │ Year*        │
 *   │  Uploader     │ Medium         │ Size         │
 *   │  (aspect-1/1) │ Status*                       │
 *   │               │ Description*                  │
 *   └───────────────┴───────────────────────────────┘
 *
 * Fields are underline inputs (not the oval pills of Steps 1–3) —
 * that is the designer's catalog-card language for this step.
 *
 * Product decision: every persona sees this form (not artist-only).
 * The black pill is always Skip. If the form is complete, a quiet
 * "Post this work" text action sits under Skip so filled work is
 * not discarded.
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
import {
  UnderlineInput,
  UnderlineSelect,
  UnderlineTextarea,
} from "@/components/auth/primitives/UnderlineField";
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

function defaultIntentForRole(mainRole: string): SignupStep4Intent | "" {
  if (mainRole === "artist") return "CREATED";
  if (mainRole === "collector") return "OWNS";
  return "";
}

const MAX_DESCRIPTION_LEN = 2000;
const DEDUP_DEBOUNCE_MS = 500;

export function SignupStep4Artwork({ api }: { api: SignupStepApi }) {
  const { t, locale } = useT();
  const router = useRouter();

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

  const parsedYear = year.trim() ? Number.parseInt(year.trim(), 10) : NaN;
  const yearOk = Number.isFinite(parsedYear) && parsedYear >= 1000 && parsedYear <= 9999;
  const canSubmit =
    !!file &&
    !!title.trim() &&
    yearOk &&
    !!intent &&
    !!description.trim() &&
    !submitting &&
    !!userId;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit || !file || !intent || !userId) return;

    setSubmitting(true);
    setUploadPhase("uploading");
    const res = await createArtworkForCreatedIntent({
      userId,
      intent,
      file,
      title,
      year: parsedYear,
      medium,
      size,
      description,
      locale,
    });

    if (!res.ok) {
      setSubmitting(false);
      setUploadPhase("idle");
      setError(`${t("auth.signupV2.step4.uploadError")} (${res.code})`);
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

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      <div className="grid grid-cols-1 items-start gap-8 sm:grid-cols-[220px_1fr]">
        <ArtworkPhotoUploader
          file={file}
          previewUrl={previewUrl}
          onChange={setFile}
          uploadHint={t("auth.signupV2.step4.photoHint")}
          removeLabel={t("auth.signupV2.step4.photoRemove")}
        />

        <div className="space-y-5">
          <div className="grid grid-cols-[1fr_88px] gap-6">
            <UnderlineInput
              label={t("auth.signupV2.step4.titleLabel")}
              value={title}
              onChange={setTitle}
              required
            />
            <UnderlineInput
              label={t("auth.signupV2.step4.yearLabel")}
              type="text"
              inputMode="numeric"
              value={year}
              onChange={(v) => setYear(v.replace(/[^0-9]/g, "").slice(0, 4))}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <UnderlineInput
              label={t("auth.signupV2.step4.mediumLabel")}
              value={medium}
              onChange={setMedium}
              list="signupv2-step4-medium"
            />
            <UnderlineInput
              label={t("auth.signupV2.step4.sizeLabel")}
              value={size}
              onChange={setSize}
            />
          </div>
          <datalist id="signupv2-step4-medium">
            {TAXONOMY.mediumOptions.map((opt) => (
              <option key={opt.value} value={t(opt.labelKey)} />
            ))}
          </datalist>

          <UnderlineSelect
            label={t("auth.signupV2.step4.statusLabel")}
            value={intent}
            onChange={(v) => setIntent((v as SignupStep4Intent) || "")}
            options={statusOptions}
            placeholder={t("auth.signupV2.step4.statusPlaceholder")}
            required
          />

          <UnderlineTextarea
            label={t("auth.signupV2.step4.descriptionLabel")}
            value={description}
            onChange={(v) =>
              setDescription(
                v.length > MAX_DESCRIPTION_LEN
                  ? v.slice(0, MAX_DESCRIPTION_LEN)
                  : v,
              )
            }
            required
            rows={2}
            maxLength={MAX_DESCRIPTION_LEN}
          />
        </div>
      </div>

      <p className="text-[11px] text-zinc-400">
        {t("auth.signupV2.step4.footerHint")}
      </p>

      {dedupCandidates.length > 0 && (
        <div
          role="alert"
          className="text-xs text-amber-800"
        >
          <p>{t("auth.signupV2.step4.dedupWarning")}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {dedupCandidates.slice(0, 3).map((row) => (
              <li key={row.id}>{row.title ?? t("common.untitled")}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="text-center text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <PillButton
          type="button"
          variant="primary"
          fullWidth
          onClick={skipAndFinish}
        >
          {t("auth.signupV2.step4.skipCta")}
        </PillButton>
        {canSubmit ? (
          <button
            type="submit"
            className="mx-auto block text-center text-xs text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
          >
            {t("auth.signupV2.step4.postCta")}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ArtworkPhotoUploader({
  file,
  previewUrl,
  onChange,
  uploadHint,
  removeLabel,
}: {
  file: File | null;
  previewUrl: string | null;
  onChange: (next: File | null) => void;
  uploadHint: string;
  removeLabel: string;
}) {
  return (
    <label
      className={`group relative flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-4 text-center text-sm text-zinc-500 transition-colors ${
        file
          ? "border-zinc-200"
          : "border-zinc-400 hover:border-zinc-600 hover:text-zinc-800"
      }`}
    >
      {previewUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt=""
            className="absolute inset-1 rounded-xl object-contain"
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
          <span aria-hidden className="text-2xl leading-none text-zinc-400">
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
  );
}
