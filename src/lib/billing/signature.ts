import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SEC = 300;

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" };

/**
 * Stripe-Signature: t=<unix>,v1=<hex hmac sha256 of `${t}.${payload}`>.
 * The raw body is the exact request text. A failed check must not update a plan.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): SignatureResult {
  if (!header || !secret) return { ok: false, reason: "missing" };
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1" && value) signatures.push(value.toLowerCase());
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > TOLERANCE_SEC) {
    return { ok: false, reason: "expired" };
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const match = signatures.some((sig) => {
    if (!/^[0-9a-f]+$/.test(sig) || sig.length !== expected.length) return false;
    const got = Buffer.from(sig, "hex");
    if (got.length !== expectedBuf.length) return false;
    return timingSafeEqual(got, expectedBuf);
  });
  return match ? { ok: true } : { ok: false, reason: "mismatch" };
}
