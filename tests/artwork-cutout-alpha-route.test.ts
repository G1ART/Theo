import assert from "node:assert/strict";

/**
 * Display Simulation Phase 2 (2026-08-20) — Track 2 (Photoroom)
 * route contract. This test validates the ONE non-Supabase behaviour
 * of the route: when `PHOTOROOM_API_KEY` is unset, the endpoint
 * short-circuits with HTTP 501 + a degraded body so the UI can
 * render a graceful "not configured" hint. Track 1 stays unaffected.
 *
 * We hit the route handler directly (as a plain function) with a
 * bare `Request` — no Supabase client is involved because the check
 * happens BEFORE auth extraction. This keeps the test hermetic and
 * doesn't require network / DB fixtures.
 */

async function run() {
  // Dummy Supabase creds so the route's transitive imports (which
  // instantiate a shared client at module load) don't crash the
  // test process. The route short-circuits BEFORE ever touching
  // Supabase, so these values are never actually used.
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-test-key";

  const prev = process.env.PHOTOROOM_API_KEY;
  delete process.env.PHOTOROOM_API_KEY;

  try {
    const { POST } = await import(
      "../src/app/api/ai/artwork-cutout-alpha/route"
    );
    const req = new Request("http://localhost/api/ai/artwork-cutout-alpha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artworkId: "test-artwork" }),
    });
    const res = await POST(req);
    assert.equal(
      res.status,
      501,
      `PHOTOROOM_API_KEY unset should return HTTP 501, got ${res.status}`,
    );

    const body = (await res.json()) as {
      degraded?: boolean;
      reason?: string;
      error?: string;
    };
    assert.equal(
      body.degraded,
      true,
      "501 body should carry degraded:true so callers can branch cleanly",
    );
    assert.equal(
      body.reason,
      "no_key",
      "501 body should carry reason:no_key so the UI can localize the hint",
    );
    assert.ok(
      typeof body.error === "string" && body.error.includes("PHOTOROOM_API_KEY"),
      "501 body should mention the missing env var so ops can fix it fast",
    );
  } finally {
    if (prev !== undefined) process.env.PHOTOROOM_API_KEY = prev;
  }

  console.log("artwork-cutout-alpha route: no-key contract ok");
}

void run().catch((err) => {
  console.error(err);
  process.exit(1);
});
