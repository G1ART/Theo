import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AiSoftCapError,
  checkDailySoftCap,
  isSoftCapExempt,
} from "../src/lib/ai/softCap";

/**
 * 2026-10-03 — opening the enhancer logs a quality gate and a painting
 * bbox. Fifteen photos filled the draft soft cap (30). Later rectangle
 * detects returned `cap` before gpt-5.6-sol ran, and the editor showed
 * the manual-corner banner. Bbox detection must not consult that cap,
 * and its rows must not count toward it.
 */

assert.equal(isSoftCapExempt("artwork_painting_bbox"), true);
assert.equal(isSoftCapExempt("artwork_quality_gate"), false);
assert.equal(isSoftCapExempt("bio_draft"), false);

type Thenable = {
  select: (...args: unknown[]) => Thenable;
  eq: (...args: unknown[]) => Thenable;
  gte: (...args: unknown[]) => Thenable;
  neq: (col: string, val: string) => Thenable;
  then: (resolve: (value: { count: number; error: null }) => void) => void;
};

function client(opts: { count: number; touched: string[] }): SupabaseClient {
  const builder: Thenable = {
    select() {
      opts.touched.push("select");
      return builder;
    },
    eq() {
      opts.touched.push("eq");
      return builder;
    },
    gte() {
      opts.touched.push("gte");
      return builder;
    },
    neq(col, val) {
      opts.touched.push(`neq:${col}:${val}`);
      return builder;
    },
    then(resolve) {
      resolve({ count: opts.count, error: null });
    },
  };
  return {
    from(table: string) {
      opts.touched.push(`from:${table}`);
      return builder;
    },
  } as unknown as SupabaseClient;
}

const previousCap = process.env.AI_USER_DAILY_SOFT_CAP;
process.env.AI_USER_DAILY_SOFT_CAP = "30";

async function main(): Promise<void> {
  const exemptTouch: string[] = [];
  await checkDailySoftCap(
    client({ count: 999, touched: exemptTouch }),
    "user",
    "artwork_painting_bbox",
  );
  assert.deepEqual(
    exemptTouch,
    [],
    "rectangle vision does not read the draft cap",
  );

  const blockedTouch: string[] = [];
  await assert.rejects(
    () =>
      checkDailySoftCap(
        client({ count: 30, touched: blockedTouch }),
        "user",
        "bio_draft",
      ),
    (err: unknown) => err instanceof AiSoftCapError,
  );
  assert.ok(
    blockedTouch.includes("neq:feature_key:artwork_painting_bbox"),
    "draft cap ignores painting-bbox rows",
  );

  const openTouch: string[] = [];
  await checkDailySoftCap(
    client({ count: 29, touched: openTouch }),
    "user",
    "bio_draft",
  );
  assert.ok(openTouch.includes("from:ai_events"));

  console.log("artwork bbox soft cap: OK");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    if (previousCap === undefined) delete process.env.AI_USER_DAILY_SOFT_CAP;
    else process.env.AI_USER_DAILY_SOFT_CAP = previousCap;
  });
