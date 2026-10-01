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
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { TheoLoadingMark } from "@/components/brand/TheoLoadingMark";
import { useT } from "@/lib/i18n/useT";
import { pathAfterNewAccount } from "@/lib/auth/signupDestination";
import { routeByAuthState, safeNextPath } from "@/lib/identity/routing";
import { ensureFreeEntitlement } from "@/lib/entitlements";
import { getMyAuthState, getSession } from "@/lib/supabase/auth";
import { SignupStep1Email } from "./steps/SignupStep1Email";

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
  /** Set when Step 3's sign-up hits a known email (anti-enumeration
   *  empty-identities signal). The wizard snaps back to Step 1 so
   *  the red one-liner can sit under "Already have an account?"
   *  exactly as the wireframe draws it. Memory-only. */
  duplicateEmail: string | null;
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
  duplicateEmail: null,
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
  const [sessionReady, setSessionReady] = useState(false);
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
      const queryEmail = searchParams.get("email")?.trim() ?? "";
      const emailSeed =
        queryEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(queryEmail)
          ? queryEmail
          : "";
      // An invite link's email wins over a draft for a different address,
      // and always starts at step 1 so a finished account is caught
      // before password and profile.
      const draftForSeed =
        emailSeed &&
        draft?.email &&
        draft.email.toLowerCase() !== emailSeed.toLowerCase()
          ? null
          : draft;
      if (draftForSeed || emailSeed) {
      setState((prev) => ({
        ...prev,
        email: emailSeed || draftForSeed?.email || prev.email,
        fullName: draftForSeed?.fullName ?? prev.fullName,
        usernameSeed: draftForSeed?.usernameSeed ?? prev.usernameSeed,
        username: draftForSeed?.username ?? prev.username,
        ageBand: draftForSeed?.ageBand ?? prev.ageBand,
        mainRole:
          draftForSeed?.mainRole ?? (prev.mainRole as SignupWizardState["mainRole"]),
        secondaryRole:
          draftForSeed?.secondaryRole ??
          (prev.secondaryRole as SignupWizardState["secondaryRole"]),
        gender:
          draftForSeed?.gender ?? (prev.gender as SignupWizardState["gender"]),
        isPublic:
          typeof draftForSeed?.isPublic === "boolean"
            ? draftForSeed.isPublic
            : prev.isPublic,
        step: 1,
      }));
    }
    if (hasExplicitStep) {
      // Profile is /onboarding/identity. Drop ?step= so the address
      // matches the Step 1 form this shell actually shows.
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

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await getSession();
        if (cancelled) return;
        if (!session) {
          setSessionReady(true);
          return;
        }
        const authState = await getMyAuthState();
        if (cancelled) return;
        await ensureFreeEntitlement(session.user.id);
        const { to } = routeByAuthState(authState, {
          nextPath,
          sessionPresent: true,
        });
        router.replace(pathAfterNewAccount(to, nextPath));
      } catch {
        if (!cancelled) setSessionReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, nextPath, router]);

  const api = useMemo<SignupStepApi>(
    () => ({ state, updateState, persistDraft, goToStep, clearDraft, nextPath }),
    [state, updateState, persistDraft, goToStep, clearDraft, nextPath],
  );

  if (!hydrated || !sessionReady) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <TheoLoadingMark />
      </div>
    );
  }

  // Step 2 is `/onboarding/identity`. This shell only draws Step 1 so
  // `/signup` and `/onboarding` stay on the same account form.
  return (
    <AuthShell
      brandPlacement="none"
      title={t("auth.signupV2.stepLabel.step1")}
      subtitle={t("auth.signupV2.step1.subLabel")}
      contentWidth="sm"
    >
      <SignupStep1Email api={api} />
    </AuthShell>
  );
}
