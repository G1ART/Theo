"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase/client";
import {
  heldShellRoles,
  readStoredShellRole,
  resolveActiveShellRole,
  writeStoredShellRole,
  type ShellRole,
} from "@/lib/shell/roleMode";

type RoleModeValue = {
  ready: boolean;
  activeRole: ShellRole | null;
  heldRoles: ShellRole[];
  setRole: (role: ShellRole) => void;
};

const RoleModeContext = createContext<RoleModeValue | null>(null);

const EMPTY: RoleModeValue = {
  ready: false,
  activeRole: null,
  heldRoles: [],
  setRole: () => {},
};

export function useRoleMode(): RoleModeValue {
  return useContext(RoleModeContext) ?? EMPTY;
}

/**
 * Loads the account's existing roles and the browser's chosen mode.
 * `setRole` writes localStorage only.
 */
export function RoleModeProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [heldRoles, setHeldRoles] = useState<ShellRole[]>([]);
  const [activeRole, setActiveRole] = useState<ShellRole | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setUserId(data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHeldRoles([]);
      setActiveRole(null);
      setReady(true);
      return;
    }
    let cancelled = false;
    const uid = userId;
    setReady(false);

    async function load() {
      const { data, error } = await supabase
        .from("profiles")
        .select("main_role, roles")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;
      const row = !error && data ? (data as { main_role?: unknown; roles?: unknown }) : null;
      const main = typeof row?.main_role === "string" ? row.main_role : null;
      const roles = Array.isArray(row?.roles)
        ? row.roles.filter((role): role is string => typeof role === "string")
        : [];
      const held = heldShellRoles({ main_role: main, roles });
      setHeldRoles(held);
      setActiveRole(resolveActiveShellRole(held, readStoredShellRole(uid), main));
      setReady(true);
    }

    void load();
    const onProfile = () => {
      void load();
    };
    window.addEventListener("profile-updated", onProfile);
    return () => {
      cancelled = true;
      window.removeEventListener("profile-updated", onProfile);
    };
  }, [userId]);

  const setRole = useCallback(
    (role: ShellRole) => {
      if (!userId) return;
      if (!heldRoles.includes(role)) return;
      writeStoredShellRole(userId, role);
      setActiveRole(role);
    },
    [userId, heldRoles],
  );

  const value = useMemo<RoleModeValue>(
    () => ({ ready, activeRole, heldRoles, setRole }),
    [ready, activeRole, heldRoles, setRole],
  );

  return <RoleModeContext.Provider value={value}>{children}</RoleModeContext.Provider>;
}
