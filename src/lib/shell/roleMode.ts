/**
 * Desktop shell role mode.
 *
 * This is the view the signed-in account is using right now
 * (artist / curator / gallery / collector). It is not the account
 * type. `profiles.main_role` and `profiles.roles` are read to decide
 * which pills exist, and never written from here.
 *
 * Remembered in this browser only (`localStorage`), per user id.
 * A role the account does not hold is ignored.
 */

export const SHELL_ROLES = ["artist", "curator", "gallery", "collector"] as const;

export type ShellRole = (typeof SHELL_ROLES)[number];

const DB_TO_SHELL: Record<string, ShellRole> = {
  artist: "artist",
  curator: "curator",
  gallery: "gallery",
  gallerist: "gallery",
  collector: "collector",
};

export const ROLE_MODE_STORAGE_PREFIX = "theo.shellRoleMode:";

export function roleModeStorageKey(userId: string): string {
  return `${ROLE_MODE_STORAGE_PREFIX}${userId}`;
}

export function shellRoleFromDb(value: string | null | undefined): ShellRole | null {
  if (!value) return null;
  return DB_TO_SHELL[value.trim().toLowerCase()] ?? null;
}

export function isShellRole(value: string | null | undefined): value is ShellRole {
  return !!value && (SHELL_ROLES as readonly string[]).includes(value);
}

/** Roles this account actually holds, in the switcher order. */
export function heldShellRoles(input: {
  main_role?: string | null;
  roles?: readonly (string | null | undefined)[] | null;
}): ShellRole[] {
  const seen = new Set<ShellRole>();
  const add = (raw: string | null | undefined) => {
    const shell = shellRoleFromDb(raw);
    if (shell) seen.add(shell);
  };
  add(input.main_role);
  for (const role of input.roles ?? []) add(role);
  return SHELL_ROLES.filter((role) => seen.has(role));
}

/**
 * Stored choice if the account still holds it, otherwise the account's
 * main role, otherwise the first held role. Never invents a role.
 */
export function resolveActiveShellRole(
  held: readonly ShellRole[],
  stored: string | null | undefined,
  mainRole: string | null | undefined,
): ShellRole | null {
  if (held.length === 0) return null;
  if (isShellRole(stored) && held.includes(stored)) return stored;
  const main = shellRoleFromDb(mainRole);
  if (main && held.includes(main)) return main;
  return held[0] ?? null;
}

export function readStoredShellRole(userId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(roleModeStorageKey(userId));
  } catch {
    return null;
  }
}

/** Browser memory only. Does not touch profile columns. */
export function writeStoredShellRole(userId: string, role: ShellRole): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(roleModeStorageKey(userId), role);
  } catch {
    // Private mode — the choice still applies until reload.
  }
}

/** Dashboard tiles that belong to this view. Unknown role shows every tile. */
const DASHBOARD_TILES: Record<ShellRole, readonly string[]> = {
  artist: ["drafts", "inquiries", "ownership", "my_exhibitions", "provenance", "spaces"],
  curator: ["my_exhibitions", "provenance", "spaces"],
  gallery: ["drafts", "inquiries", "my_exhibitions", "spaces"],
  collector: ["ownership", "inquiries", "spaces"],
};

export function dashboardTileVisible(role: ShellRole | null, key: string): boolean {
  if (!role) return true;
  return DASHBOARD_TILES[role].includes(key);
}

export function shellRoleProfileLabel(
  role: ShellRole,
  t: (key: string) => string,
): string {
  return t("shell.roleProfile").replace("{role}", t(`shell.role.${role}`));
}
