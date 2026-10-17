"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { logActingScopeChange } from "@/lib/delegation/actingContext";
import { isActiveDelegateOf } from "@/lib/supabase/delegations";
import { getSession } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";

const STORAGE_KEY = "abstract_acting_as";

type ActingAsState = {
  profileId: string | null;
  label: string | null;
};

function loadStored(): ActingAsState {
  if (typeof window === "undefined") return { profileId: null, label: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { profileId: null, label: null };
    const parsed = JSON.parse(raw) as { profileId?: string; label?: string };
    if (parsed?.profileId && typeof parsed.profileId === "string") {
      return {
        profileId: parsed.profileId,
        label: typeof parsed.label === "string" ? parsed.label : null,
      };
    }
  } catch {
    // ignore
  }
  return { profileId: null, label: null };
}

function saveStored(state: ActingAsState) {
  if (typeof window === "undefined") return;
  if (state.profileId) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

type ActingAsContextValue = {
  actingAsProfileId: string | null;
  actingAsLabel: string | null;
  setActingAs: (profileId: string, label: string) => void;
  clearActingAs: () => void;
  /**
   * True when a server-side liveness probe has just discovered that
   * the locally-stored "acting as" target no longer corresponds to
   * any active delegation. The provider auto-clears the state; this
   * flag lets surfaces (e.g. the global Header) flash a one-shot
   * notice. Consumers must call `acknowledgeStaleCleared()` after
   * displaying the notice so it doesn't re-flash on every render.
   */
  staleCleared: boolean;
  acknowledgeStaleCleared: () => void;
};

const ActingAsContext = createContext<ActingAsContextValue | null>(null);

export function ActingAsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ActingAsState>(loadStored);
  const [staleCleared, setStaleCleared] = useState(false);
  const previousProfileIdRef = useRef<string | null>(state.profileId);
  const lastVerifiedRef = useRef<{ profileId: string; at: number } | null>(null);

  const setActingAs = useCallback((profileId: string, label: string) => {
    const next = { profileId, label };
    const prev = previousProfileIdRef.current;
    setState(next);
    saveStored(next);
    previousProfileIdRef.current = profileId;
    // Locally-set targets are trusted briefly so we don't immediately
    // clear them while the RPC round-trip is in flight.
    lastVerifiedRef.current = { profileId, at: Date.now() };
    void logActingScopeChange({
      subjectProfileId: profileId,
      previousSubjectProfileId: prev,
    });
  }, []);

  const clearActingAs = useCallback(() => {
    const prev = previousProfileIdRef.current;
    setState({ profileId: null, label: null });
    saveStored({ profileId: null, label: null });
    previousProfileIdRef.current = null;
    lastVerifiedRef.current = null;
    void logActingScopeChange({
      subjectProfileId: null,
      previousSubjectProfileId: prev,
    });
  }, []);

  const acknowledgeStaleCleared = useCallback(() => {
    setStaleCleared(false);
  }, []);

  // Acting-as belongs to the session. Any sign-out (button, another tab,
  // expired refresh token) drops it so the next sign-in on this tab does
  // not reopen the banner. The logout buttons clear it first, while the
  // exit can still be logged.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      setState({ profileId: null, label: null });
      saveStored({ profileId: null, label: null });
      previousProfileIdRef.current = null;
      lastVerifiedRef.current = null;
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Stale-state liveness probe.
  //
  // Why this exists:
  //   `actingAsProfileId` lives in localStorage. If the delegator
  //   revokes the delegation server-side, our local banner keeps
  //   advertising the now-broken context until the user manually
  //   exits — and any mutation in that window now triggers RLS
  //   denials with cryptic error toasts.
  //
  // Strategy:
  //   On mount, on tab focus, and on visibility change → ask the
  //   server "is this delegation still active for me?". If false
  //   AND we've already validated at least once (so we don't race
  //   with a freshly-set value), silently clear the local state and
  //   raise `staleCleared` so the Header can flash a one-shot notice.
  //
  // Rate-limit:
  //   Once per visibility/focus pulse and at most every 10s. Avoids
  //   pounding the RPC on noisy focus toggles.
  useEffect(() => {
    let cancelled = false;
    const MIN_INTERVAL_MS = 10_000;

    async function verify() {
      const target = state.profileId;
      if (!target) return;
      const last = lastVerifiedRef.current;
      if (last && last.profileId === target && Date.now() - last.at < MIN_INTERVAL_MS) {
        return;
      }
      const { data: { session } } = await getSession();
      if (cancelled) return;
      if (!session) {
        // No session → caller is probably mid-logout. Don't fire the
        // RPC; defer to the next pulse. We also don't clear here
        // because the auth gate will route the user away regardless.
        return;
      }
      const { data, error } = await isActiveDelegateOf(target);
      if (cancelled) return;
      lastVerifiedRef.current = { profileId: target, at: Date.now() };
      if (error) return;            // probe error → keep current state
      if (data === true) return;    // still valid
      if (data === false) {
        // Stale: server says no active delegation against this owner.
        const prev = previousProfileIdRef.current;
        setState({ profileId: null, label: null });
        saveStored({ profileId: null, label: null });
        previousProfileIdRef.current = null;
        setStaleCleared(true);
        void logActingScopeChange({
          subjectProfileId: null,
          previousSubjectProfileId: prev,
        });
      }
    }

    void verify();

    const onFocus = () => { void verify(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void verify();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state.profileId]);

  const value = useMemo(
    () => ({
      actingAsProfileId: state.profileId,
      actingAsLabel: state.label,
      setActingAs,
      clearActingAs,
      staleCleared,
      acknowledgeStaleCleared,
    }),
    [state.profileId, state.label, setActingAs, clearActingAs, staleCleared, acknowledgeStaleCleared]
  );

  return (
    <ActingAsContext.Provider value={value}>{children}</ActingAsContext.Provider>
  );
}

export function useActingAs() {
  const ctx = useContext(ActingAsContext);
  return ctx ?? {
    actingAsProfileId: null,
    actingAsLabel: null,
    setActingAs: () => {},
    clearActingAs: () => {},
    staleCleared: false,
    acknowledgeStaleCleared: () => {},
  };
}
