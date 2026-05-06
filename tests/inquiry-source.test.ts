// Stub Supabase env vars BEFORE any import that pulls the supabase
// client (priceInquiries.ts → @/lib/supabase/client). Without these
// stubs `createClient` throws at module-init time. Mirrors the pattern
// used by feed-telemetry.test.ts.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://stub.example.com";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "stub-anon-key";

import assert from "node:assert/strict";

(async () => {
  const mod = await import("../src/lib/supabase/priceInquiries");
  const { sanitizeInquirySource } = mod._testing;

  // 1. Empty input → all nullable, no surface set.
  {
    const r = sanitizeInquirySource({});
    assert.equal(r.source_surface, null);
    assert.equal(r.source_room_id, null);
    assert.equal(r.source_payload, null);
  }

  // 2. Unknown surface is rejected (CHECK constraint defense-in-depth).
  {
    const r = sanitizeInquirySource({ surface: "checkout" as unknown as "feed" });
    assert.equal(r.source_surface, null, "unknown surface must be dropped");
  }

  // 3. Known surfaces pass through.
  for (const s of ["feed", "room", "artwork", "exhibition", "profile", "direct"] as const) {
    const r = sanitizeInquirySource({ surface: s });
    assert.equal(r.source_surface, s, `surface ${s} must round-trip`);
  }

  // 4. Privacy: secret-shaped keys (token, password, secret, *_token) MUST
  //    be stripped from payload — no exceptions, this is the sprint's
  //    privacy invariant for room TOKEN attribution.
  {
    const r = sanitizeInquirySource({
      surface: "room",
      payload: {
        tab: "all",
        share_token: "S3CRET-abc-123",
        password: "no",
        secret: "nope",
        api_token: "x",
        position: 4,
      },
    });
    const p = r.source_payload as Record<string, unknown>;
    assert.ok(!("share_token" in p), "share_token must be stripped");
    assert.ok(!("password" in p), "password must be stripped");
    assert.ok(!("secret" in p), "secret must be stripped");
    assert.ok(!("api_token" in p), "*_token must be stripped");
    assert.equal(p.tab, "all", "non-secret keys preserved");
    assert.equal(p.position, 4, "non-secret keys preserved");
  }

  // 5. Nested objects/arrays in payload are dropped (v1 keeps payload flat
  //    so analytics rows stay compact and the privacy posture is easy to
  //    reason about).
  {
    const r = sanitizeInquirySource({
      surface: "feed",
      payload: {
        tab: "all",
        nested: { a: 1 },
        list: [1, 2, 3],
        position: 2,
      },
    });
    const p = r.source_payload as Record<string, unknown>;
    assert.ok(!("nested" in p), "nested objects must be dropped");
    assert.ok(!("list" in p), "arrays must be dropped");
    assert.equal(p.tab, "all");
    assert.equal(p.position, 2);
  }

  // 6. Payload that explodes past 1 KiB is dropped entirely so we never
  //    bloat analytics rows by mistake.
  {
    const big: Record<string, string> = {};
    for (let i = 0; i < 100; i++) big[`k${i}`] = "x".repeat(50);
    const r = sanitizeInquirySource({ surface: "feed", payload: big });
    assert.equal(r.source_payload, null, "oversized payload must be dropped");
  }

  // 7. A room source must NEVER carry a token, even if the caller hands
  //    one in by mistake — the schema column is `source_room_id` (uuid).
  //    The sanitizer only writes whitelisted fields; assert there's no
  //    field that could carry a token at all.
  {
    const r = sanitizeInquirySource({
      surface: "room",
      roomId: "11111111-1111-1111-1111-111111111111",
    });
    const keys = Object.keys(r);
    for (const k of keys) {
      assert.ok(!/token/i.test(k), `no field name may include 'token' (saw ${k})`);
    }
    assert.equal(r.source_room_id, "11111111-1111-1111-1111-111111111111");
  }

  console.log("inquiry-source.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
