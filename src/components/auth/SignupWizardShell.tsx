"use client";

/**
 * SignupWizardShell — Signup v2 Phase 1 (2026-08-19).
 *
 * Owns the wizard-wide state (email / password / profile) and
 * coordinates the three step surfaces (Step 1 / 2 / 3). Route lives at
 * `/signup` and is deliberately URL-driven via `?step=` so the browser
 * back button and refresh both restore correctly (§13 in the spec).
 *
 * Draft (sessionStorage `signup:v2:draft`) is loaded once on mount and
 * every mutable field save flows through `updateDraft`. Password is
 * NEVER persisted (§11.6).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  clearSignupDraft,
  loadSignupDraft,
  saveSignupDraft,
  type SignupV2Draft,
  type SignupV2Gender,
  type SignupV2MainRole,
  type SignupV2WizardStep,
} from "@/lib/auth/signupWizardState";
import { AuthShell } from "@/components/auth/primitives/AuthShell";
import { useT } from "@/lib/i18n/useT";
import { safeNextPath } from "@/lib/identity/routing";
import { SignupStep1Email } from "./steps/SignupStep1Email";
import { SignupStep2Password } from "./steps/SignupStep2Password";
import { SignupStep3Profile } from "./steps/SignupStep3Profile";
import { SignupStep4Artwork } from "./steps/SignupStep4Artwork";

/** Wizard-level state exposed to each step. Passwords + the raw
 *  `avatarFile` live only in memory — passwords aren't persisted per
 *  §11.6 and File objects can't be JSON-serialized for sessionStorage.
 *  Both are re-entered / re-picked if the tab closes mid-wizard. */
export type SignupWizardState = {
  step: SignupV2WizardStep;
  email: string;
  password: string;
  fullName: string;
  usernameSeed: string;
  username: string;
  ageBand: string;
  mainRole: SignupV2MainRole | "";
  /** Signup v2 wireframe pass (2026-08-20). */
  secondaryRole: SignupV2MainRole | "";
  /** Signup v2 wireframe pass (2026-08-20). */
  gender: SignupV2Gender | "";
  isPublic: boolean;
  /** File selected on Step 3's avatar picker. Uploaded to
   *  Storage during Step 3 submit (after `signUpWithPassword`
   *  establishes a session), then flushed. Never persisted. */
  avatarFile: File | null;
};

const INITIAL_STATE: SignupWizardState = {
  step: 1,
  email: "",
  password: "",
  fullName: "",
  usernameSeed: "",
  username: "",
  ageBand: "",
  mainRole: "",
  secondaryRole: "",
  gender: "",
  isPublic: true,
  avatarFile: null,
};

function stepFromParam(raw: string | null): SignupV2WizardStep {
  const n = raw ? Number.parseInt(raw, 10) : 1;
  if (n === 2 || n === 3 || n === 4) return n;
  return 1;
}

/** Read-only shape passed to each step for shared draft + navigation. */
export type SignupStepApi = {
  state: SignupWizardState;
  updateState: (patch: Partial<SignupWizardState>) => void;
  /** Persist a subset of the state into sessionStorage. */
  persistDraft: (patch: Partial<Omit<SignupV2Draft, "version" | "savedAt">>) => void;
  /** Advance to a specific step (updates ?step= and re-scrolls). */
  goToStep: (step: SignupV2WizardStep) => void;
  /** Clear the draft (e.g. wizard completes or explicit "Start over"). */
  clearDraft: () => void;
  /** `?next=` value carried into `signUpWithPassword`. */
  nextPath: string | null;
};

export function SignupWizardShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useT();
  const [state, setState] = useState<SignupWizardState>(INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);
  const restoreDoneRef = useRef(false);
  const nextPath = safeNextPath(searchParams.get("next"));

  const rawUrlStep = searchParams.get("step");
  const urlStep = stepFromParam(rawUrlStep);
  const hasExplicitStep = rawUrlStep != null;

  // One-time draft restore on mount. We deliberately do NOT hydrate on
  // every ?step= change so the "user typed then hit back" flow doesn't
  // lose form state to a re-read.
  useEffect(() => {
    if (restoreDoneRef.current) return;
    restoreDoneRef.current = true;
    const draft = loadSignupDraft();
    if (draft) {
      setState((prev) => ({
        ...prev,
        email: draft.email ?? prev.email,
        fullName: draft.fullName ?? prev.fullName,
        usernameSeed: draft.usernameSeed ?? prev.usernameSeed,
        username: draft.username ?? prev.username,
        ageBand: draft.ageBand ?? prev.ageBand,
        mainRole:
          draft.mainRole ?? (prev.mainRole as SignupWizardState["mainRole"]),
        secondaryRole:
          draft.secondaryRole ??
          (prev.secondaryRole as SignupWizardState["secondaryRole"]),
        gender:
          draft.gender ?? (prev.gender as SignupWizardState["gender"]),
        isPublic:
          typeof draft.isPublic === "boolean" ? draft.isPublic : prev.isPublic,
        // If the URL explicitly says a step, it wins (link with
        // `?step=` was clicked). Otherwise fall back to whatever the
        // draft last saw. This preserves both "resume after refresh"
        // and "linked-from-banner-to-step-3" scenarios.
        step: hasExplicitStep ? urlStep : draft.step,
      }));
      // Reflect the resolved step in the URL so the browser back stack
      // is coherent from the first render onward.
      if (!hasExplicitStep && draft.step !== 1) {
        const query = new URLSearchParams(searchParams.toString());
        query.set("step", String(draft.step));
        router.replace(`/signup?${query.toString()}`, { scroll: false });
      }
    } else if (hasExplicitStep && urlStep !== 1) {
      // Stray deep-link with no draft — snap to step 1 so we don't
      // stall on an empty Step 2 / 3.
      setState((prev) => ({ ...prev, step: 1 }));
      const query = new URLSearchParams(searchParams.toString());
      query.delete("step");
      const qs = query.toString();
      router.replace(qs ? `/signup?${qs}` : `/signup`, { scroll: false });
    }
    setHydrated(true);
    // Restore is a one-shot; deps are captured above. We deliberately
    // exclude router / searchParams to avoid a re-run on transient
    // navigations before hydration completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After hydration, keep the ?step= URL in sync with state.step so a
  // browser back / forward action moves the wizard step. `goToStep`
  // pushes URL updates; this effect covers user-initiated
  // back/forward.
  useEffect(() => {
    if (!hydrated) return;
    if (urlStep !== state.step) {
      setState((prev) => ({ ...prev, step: urlStep }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStep, hydrated]);

  const updateState = useCallback((patch: Partial<SignupWizardState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const persistDraft = useCallback(
    (patch: Partial<Omit<SignupV2Draft, "version" | "savedAt">>) => {
      saveSignupDraft(patch);
    },
    [],
  );

  const goToStep = useCallback(
    (step: SignupV2WizardStep) => {
      setState((prev) => ({ ...prev, step }));
      saveSignupDraft({ step });
      const query = new URLSearchParams(searchParams.toString());
      query.set("step", String(step));
      router.replace(`/signup?${query.toString()}`, { scroll: true });
    },
    [router, searchParams],
  );

  const clearDraft = useCallback(() => {
    clearSignupDraft();
  }, []);

  const api = useMemo<SignupStepApi>(
    () => ({ state, updateState, persistDraft, goToStep, clearDraft, nextPath }),
    [state, updateState, persistDraft, goToStep, clearDraft, nextPath],
  );

  // Step 4 lands the user on the shared "quick-start artwork" surface,
  // but by that point their account already exists — the back arrow
  // would return them to a Step 3 that's already been persisted. Hide
  // it so users can't accidentally re-submit `upsert_my_profile`.
  const handleBack =
    state.step > 1 && state.step < 4
      ? () => goToStep((state.step - 1) as SignupV2WizardStep)
      : undefined;

  const alternate: ReactNode = (
    <span>
      {t("auth.signupV2.haveAccount")}{" "}
      <Link
        href={nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login"}
        className="font-medium text-zinc-900 underline-offset-2 hover:underline"
      >
        {t("auth.signupV2.logInCta")}
      </Link>
    </span>
  );

  // Wireframe polish (2026-08-19): the huge H1 is the *step label*
  // ("Step N"), the AuthShell subtitle is the short action label
  // ("Enter your email"). Descriptive body copy lives inside each step
  // as a small `<p>` above the form. Step 4 sub-label stays
  // role-aware and reuses Worker B's existing `.artistTitle` /
  // `.nonArtistTitle` copy verbatim so we don't duplicate strings.
  const step4SubLabelKey =
    state.mainRole === "artist"
      ? "auth.signupV2.step4.artistTitle"
      : "auth.signupV2.step4.nonArtistTitle";

  const titles: Record<SignupV2WizardStep, string> = {
    1: t("auth.signupV2.stepLabel.step1"),
    2: t("auth.signupV2.stepLabel.step2"),
    3: t("auth.signupV2.stepLabel.step3"),
    4: t("auth.signupV2.stepLabel.step4"),
  };
  const subtitles: Record<SignupV2WizardStep, string> = {
    1: t("auth.signupV2.step1.subLabel"),
    2: t("auth.signupV2.step2.subLabel"),
    3: t("auth.signupV2.step3.subLabel"),
    4: t(step4SubLabelKey),
  };

  let body: ReactNode = null;
  if (state.step === 1) {
    body = <SignupStep1Email api={api} />;
  } else if (state.step === 2) {
    body = <SignupStep2Password api={api} />;
  } else if (state.step === 3) {
    body = <SignupStep3Profile api={api} />;
  } else {
    body = <SignupStep4Artwork api={api} />;
  }

  // Wireframe pixel-fidelity pass (2026-08-20): Step 4 lays the
  // uploader out beside the fields on ≥sm viewports, which needs a
  // wider container than the tight Steps 1-3 column.
  const contentWidth = state.step === 4 ? "lg" : "sm";

  return (
    <AuthShell
      onBack={handleBack}
      backLabel={t("auth.signupV2.back")}
      brandPlacement="none"
      showLocale
      title={titles[state.step]}
      subtitle={subtitles[state.step]}
      alternate={alternate}
      contentWidth={contentWidth}
    >
      {body}
    </AuthShell>
  );
}
