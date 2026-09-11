/**
 * Server / Edge only. Do not import from Client Components — the
 * cookie token is derived from IR_DEMO_SECRET.
 */

export async function irDemoCookieToken(): Promise<string> {
  const secret = process.env.IR_DEMO_SECRET?.trim() ?? "";
  const data = new TextEncoder().encode(`theo-ir-gate:${secret}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function irDemoCookieIsValid(
  value: string | undefined | null,
): Promise<boolean> {
  if (!value) return false;
  const expected = await irDemoCookieToken();
  if (value.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
