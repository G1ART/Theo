/**
 * After a password signup creates a session, `/onboarding` is the
 * account form they just left. Send them to the profile step instead
 * of bouncing back onto that form.
 */
export function pathAfterNewAccount(to: string, nextPath: string | null): string {
  if (to === "/onboarding" || to.startsWith("/onboarding?")) {
    const q = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    return `/onboarding/identity${q}`;
  }
  return to;
}
