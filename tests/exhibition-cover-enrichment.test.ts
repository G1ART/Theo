import assert from "node:assert/strict";

/**
 * Behavior tests for `enrichExhibitionsCoversFromWorks` — the feed-only
 * fallback that lets exhibitions surface in the Living Salon when the
 * curator hasn't uploaded the full 2-cover layout yet.
 *
 * The function lives in `src/lib/supabase/exhibitions.ts` and reads from
 * supabase, so we stub the supabase client's chainable `from(...).select(...).in(...)`
 * surface with a tiny in-process double. We don't go near the real network.
 *
 * Invariants under test (all must hold to honor the boundary documented
 * in the function's JSDoc):
 *   1. Empty input → empty output, no fetches.
 *   2. All exhibitions already have ≥ target covers → returned as-is.
 *   3. Exhibitions with 0 covers → filled with first works' first images
 *      (sort_order asc), in order.
 *   4. Exhibitions with N < target covers → existing covers preserved at
 *      front, synthetic appended only enough to reach target.
 *   5. Synthetic path that duplicates an existing cover is skipped (no
 *      visible duplicate in the strip).
 *   6. Missing exhibition_works → unchanged (no crash, no synthetic).
 *   7. Missing artwork_images for the chosen works → unchanged.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub-anon-key";

type StubRows = {
  exhibition_works?: Array<{
    exhibition_id: string;
    work_id: string;
    sort_order: number | null;
  }>;
  artwork_images?: Array<{
    artwork_id: string;
    storage_path: string;
    sort_order: number | null;
  }>;
};

(async () => {
const exhibitionsMod = await import("../src/lib/supabase/exhibitions");
const clientMod = await import("../src/lib/supabase/client");

let nextRows: StubRows = {};
const fromCalls: string[] = [];

(clientMod.supabase as unknown as { from: (table: string) => unknown }).from = (
  table: string
) => {
  fromCalls.push(table);
  const rows =
    table === "exhibition_works"
      ? nextRows.exhibition_works ?? []
      : table === "artwork_images"
        ? nextRows.artwork_images ?? []
        : [];
  return {
    select: () => ({
      in: async () => ({ data: rows, error: null }),
    }),
  };
};

function reset(rows: StubRows = {}) {
  nextRows = rows;
  fromCalls.length = 0;
}

const enrich = exhibitionsMod.enrichExhibitionsCoversFromWorks;

// 1. Empty input → empty output, no fetches.
{
  reset();
  const out = await enrich([]);
  assert.deepEqual(out, [], "empty input returns empty array");
  assert.equal(fromCalls.length, 0, "no supabase calls for empty input");
}

// 2. All have target covers → unchanged + no fetches.
{
  reset();
  const input = [
    { id: "ex1", cover_image_paths: ["a", "b"] },
    { id: "ex2", cover_image_paths: ["x", "y", "z"] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any[];
  const out = await enrich(input);
  assert.deepEqual(out, input, "saturated input returned untouched");
  assert.equal(fromCalls.length, 0, "no fetches when nothing needs filling");
}

// 3. Zero covers → filled with first works in sort_order asc.
{
  reset({
    exhibition_works: [
      // Intentionally out of order; the helper must sort.
      { exhibition_id: "ex1", work_id: "w3", sort_order: 2 },
      { exhibition_id: "ex1", work_id: "w1", sort_order: 0 },
      { exhibition_id: "ex1", work_id: "w2", sort_order: 1 },
    ],
    artwork_images: [
      { artwork_id: "w1", storage_path: "p/w1.jpg", sort_order: 0 },
      { artwork_id: "w2", storage_path: "p/w2.jpg", sort_order: 0 },
      { artwork_id: "w3", storage_path: "p/w3.jpg", sort_order: 0 },
    ],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await enrich([{ id: "ex1", cover_image_paths: [] as string[] }] as any[]);
  assert.deepEqual(
    out[0].cover_image_paths,
    ["p/w1.jpg", "p/w2.jpg"],
    "zero covers filled with first 2 works in sort_order"
  );
}

// 4. Existing single cover preserved; one synthetic appended.
{
  reset({
    exhibition_works: [
      { exhibition_id: "ex2", work_id: "w10", sort_order: 0 },
      { exhibition_id: "ex2", work_id: "w11", sort_order: 1 },
    ],
    artwork_images: [
      { artwork_id: "w10", storage_path: "p/w10.jpg", sort_order: 0 },
      { artwork_id: "w11", storage_path: "p/w11.jpg", sort_order: 0 },
    ],
  });
  const out = await enrich([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { id: "ex2", cover_image_paths: ["curator-cover.jpg"] } as any,
  ]);
  assert.deepEqual(
    out[0].cover_image_paths,
    ["curator-cover.jpg", "p/w10.jpg"],
    "curator cover stays first; only the deficit is filled"
  );
}

// 5. Synthetic candidate equals existing cover → skipped, next work used.
{
  reset({
    exhibition_works: [
      { exhibition_id: "ex3", work_id: "w20", sort_order: 0 },
      { exhibition_id: "ex3", work_id: "w21", sort_order: 1 },
    ],
    artwork_images: [
      { artwork_id: "w20", storage_path: "dup.jpg", sort_order: 0 },
      { artwork_id: "w21", storage_path: "p/w21.jpg", sort_order: 0 },
    ],
  });
  const out = await enrich([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { id: "ex3", cover_image_paths: ["dup.jpg"] } as any,
  ]);
  assert.deepEqual(
    out[0].cover_image_paths,
    ["dup.jpg", "p/w21.jpg"],
    "duplicate synthetic skipped, next work picked"
  );
}

// 6. No exhibition_works → unchanged.
{
  reset({ exhibition_works: [], artwork_images: [] });
  const out = await enrich([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { id: "ex4", cover_image_paths: [] as string[] } as any,
  ]);
  assert.deepEqual(out[0].cover_image_paths, [], "no works → no synthetic, no crash");
}

// 7. Works exist but have no images → unchanged.
{
  reset({
    exhibition_works: [
      { exhibition_id: "ex5", work_id: "wempty", sort_order: 0 },
    ],
    artwork_images: [],
  });
  const out = await enrich([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { id: "ex5", cover_image_paths: [] as string[] } as any,
  ]);
  assert.deepEqual(
    out[0].cover_image_paths,
    [],
    "works without images → no synthetic, no crash"
  );
}

console.log("OK enrichment behavior — 7 invariants");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
