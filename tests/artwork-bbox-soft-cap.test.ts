process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://stub.example.com";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "stub-anon-key";

import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { AiFeatureKey } from "../src/lib/ai/types";

/**
 * 2026-10-03 — the 30 was our account-day draft counter (`ai_events`
 * since UTC midnight), not an OpenAI / gpt-5.6-sol quota. Opening a
 * photo used to fill it, and the next call returned 429 `cap` before
 * the model ran. Authenticated quality-gate, rectangle, and draft
 * calls must not be rejected for that count. A missing bearer token
 * is still 401.
 */

function countingClient(count: number, touched: string[]): SupabaseClient {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (
          resolve: (value: { count: number; error: null; data: null }) => void,
        ) => {
          resolve({ count, error: null, data: null });
        };
      }
      if (typeof prop !== "string") return undefined;
      return () => new Proxy({}, handler);
    },
  };

  return {
    auth: {
      async getUser() {
        touched.push("getUser");
        return { data: { user: { id: "artist-1" } }, error: null };
      },
    },
    from(table: string) {
      touched.push(`from:${table}`);
      return new Proxy({}, handler);
    },
  } as unknown as SupabaseClient;
}

function authedRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

async function main(): Promise<void> {
  const { handleAiRoute } = await import("../src/lib/ai/route");

  const anonymous = await handleAiRoute(
    new Request("http://localhost/api/ai/artwork-quality-gate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    {
      feature: "artwork_quality_gate",
      async buildPromptInput() {
        throw new Error("unauthenticated calls must not reach the model");
      },
    },
  );
  assert.equal(anonymous.status, 401);
  const anonymousBody = (await anonymous.json()) as { reason?: string };
  assert.equal(anonymousBody.reason, "unauthorized");

  const cases: Array<{ feature: AiFeatureKey; count: number; path: string }> = [
    { feature: "artwork_quality_gate", count: 30, path: "/api/ai/artwork-quality-gate" },
    { feature: "artwork_painting_bbox", count: 999, path: "/api/ai/artwork-painting-bbox" },
    { feature: "bio_draft", count: 999, path: "/api/ai/bio-draft" },
  ];

  for (const item of cases) {
    const touched: string[] = [];
    let built = false;
    const res = await handleAiRoute(
      authedRequest(item.path),
      {
        feature: item.feature,
        async buildPromptInput() {
          built = true;
          return NextResponse.json({ ok: true, feature: item.feature });
        },
      },
      { supabase: countingClient(item.count, touched) },
    );
    const body = (await res.json()) as { reason?: string; error?: string; ok?: boolean };
    assert.notEqual(
      res.status,
      429,
      `${item.feature} must not 429 when ${item.count} draft rows already exist today`,
    );
    assert.notEqual(body.reason, "cap", `${item.feature} must not return reason=cap`);
    assert.notEqual(body.error, "Soft cap reached");
    assert.equal(res.status, 200, `${item.feature} should pass the daily counter`);
    assert.equal(built, true, `${item.feature} should reach prompt build`);
    assert.equal(body.ok, true);
    assert.ok(
      !touched.includes("from:ai_events"),
      `${item.feature} must not consult the daily ai_events counter`,
    );
  }

  console.log("draft daily cap is not enforced: OK");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
