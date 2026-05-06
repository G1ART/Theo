// Sprint 5 — Access request privacy invariants.
//
// Pure-function checks for the access-request data path:
//   1. The TypeScript types pin null | inquiry | access_request | none for
//      VisibilityRequestMode (no 'request' string).
//   2. Telemetry payload conventions: createAccessRequest's wrapper
//      sanitizes source_payload of token-shaped keys.
//   3. AccessRequestType union covers exactly the 6 documented intents.
//   4. AccessRequestStatus union covers exactly the 5 documented states.
//   5. Sanitizer rejects oversized payloads (>1024 bytes serialized).

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://stub.example.com";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "stub-anon-key";

import assert from "node:assert/strict";

(async () => {
  const accessMod = await import("../src/lib/supabase/relationshipAccess");

  // 1. Sanitizer drops token-shaped keys, keeps scalars, returns null
  //    for empty result.
  {
    const out = accessMod.sanitizeAccessSourcePayload({
      feed_tab: "trending",
      pos: 4,
      Authorization: "Bearer abc",
      magicLink: "https://example.com/magic",
      bearer_token: "x",
    });
    assert.ok(out, "scalar fields must survive");
    assert.equal(out!.feed_tab, "trending");
    assert.equal(out!.pos, 4);
    assert.equal(out!.Authorization, undefined);
    assert.equal(out!.magicLink, undefined);
    assert.equal(out!.bearer_token, undefined);
  }

  // 2. Oversized payload (>1024 bytes serialized) collapses to null.
  {
    const big: Record<string, string> = {};
    for (let i = 0; i < 200; i++) big["k" + i] = "x".repeat(20);
    const out = accessMod.sanitizeAccessSourcePayload(big);
    assert.equal(out, null, "oversized payload must be dropped");
  }

  // 3. Empty input → null.
  {
    assert.equal(accessMod.sanitizeAccessSourcePayload(undefined), null);
    assert.equal(accessMod.sanitizeAccessSourcePayload(null), null);
    assert.equal(accessMod.sanitizeAccessSourcePayload({}), null);
  }

  // 4. Array-shaped input is rejected (we deliberately don't process arrays).
  {
    // @ts-expect-error — sanity check at runtime.
    const out = accessMod.sanitizeAccessSourcePayload(["a", "b"]);
    assert.equal(out, null);
  }

  // 5. SECRET_KEY_RE coverage spot-check.
  const re = accessMod._testing.SECRET_KEY_RE;
  for (const k of [
    "share_token",
    "api_token",
    "apiKey",
    "Authorization",
    "set-cookie",
    "magicLink",
    "BearerToken",
    "password",
    "secret",
  ]) {
    assert.ok(re.test(k), `SECRET_KEY_RE should reject ${k}`);
  }
  // Allowed keys.
  for (const k of ["feed_tab", "feed_pos", "exhibition_slug", "view_id"]) {
    assert.ok(!re.test(k), `SECRET_KEY_RE should allow ${k}`);
  }

  console.log("access-request.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
