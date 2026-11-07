import { createHash } from "node:crypto";

const STRIPE_API = "https://api.stripe.com/v1";

export function isStripeHostedUrl(value: string, kind: "checkout" | "portal"): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (kind === "checkout") return url.hostname === "checkout.stripe.com";
    return url.hostname === "billing.stripe.com";
  } catch {
    return false;
  }
}

export function stripeFormBody(fields: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) params.append(key, value);
  return params.toString();
}

export async function stripeRequest(
  secret: string,
  method: "GET" | "POST",
  path: string,
  fields?: Record<string, string>,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; code: string }
> {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: fields ? stripeFormBody(fields) : undefined,
  });
  const json = (await response.json().catch(() => null)) as
    | { error?: { code?: string } }
    | Record<string, unknown>
    | null;
  if (!response.ok) {
    const errorBody =
      json && typeof json === "object" && "error" in json ? json.error : null;
    const code =
      errorBody &&
      typeof errorBody === "object" &&
      "code" in errorBody &&
      typeof errorBody.code === "string"
        ? errorBody.code
        : "stripe_error";
    return { ok: false, status: response.status, code };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, status: 502, code: "stripe_error" };
  }
  return { ok: true, body: json };
}

const portalConfigIds = new Map<string, string>();

function secretCacheKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Portal sessions are short-lived and are not stored.
 * Cancellation is at period end, so access stays until the paid period finishes.
 */
export async function withtheoPortalConfiguration(secret: string): Promise<string | null> {
  const cacheKey = secretCacheKey(secret);
  const cached = portalConfigIds.get(cacheKey);
  if (cached) return cached;

  const list = await stripeRequest(secret, "GET", "/billing_portal/configurations?limit=20");
  if (list.ok && Array.isArray(list.body.data)) {
    for (const row of list.body.data) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      const meta = rec.metadata as Record<string, unknown> | null | undefined;
      const features = rec.features as Record<string, unknown> | null | undefined;
      const cancel = features?.subscription_cancel as Record<string, unknown> | null | undefined;
      if (
        meta?.app === "withtheo" &&
        cancel?.enabled === true &&
        cancel?.mode === "at_period_end" &&
        typeof rec.id === "string"
      ) {
        portalConfigIds.set(cacheKey, rec.id);
        return rec.id;
      }
    }
  }

  const created = await stripeRequest(secret, "POST", "/billing_portal/configurations", {
    "metadata[app]": "withtheo",
    "features[payment_method_update][enabled]": "true",
    "features[invoice_history][enabled]": "true",
    "features[subscription_cancel][enabled]": "true",
    "features[subscription_cancel][mode]": "at_period_end",
    "features[subscription_cancel][proration_behavior]": "none",
    "business_profile[privacy_policy_url]": "https://withtheo.art/legal/privacy",
    "business_profile[terms_of_service_url]": "https://withtheo.art/legal/terms",
  });
  if (!created.ok || typeof created.body.id !== "string") return null;
  portalConfigIds.set(cacheKey, created.body.id);
  return created.body.id;
}
