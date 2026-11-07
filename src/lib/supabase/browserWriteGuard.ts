const WRITE_METHODS = new Set(["PATCH", "POST", "PUT", "DELETE"]);

/**
 * Browser PostgREST must not write profiles or entitlements.
 * Entitlement plan changes go through the service role and the signed webhook.
 */
export function blockedBrowserWrite(url: string, method: string): "profiles" | "entitlements" | null {
  if (!WRITE_METHODS.has(method.toUpperCase())) return null;
  if (url.includes("/rest/v1/profiles")) return "profiles";
  if (url.includes("/rest/v1/entitlements")) return "entitlements";
  return null;
}
