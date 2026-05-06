/**
 * Deterministic, non-cryptographic hashing + PRNG helpers for the
 * Personalized Salon Mixer.
 *
 * The mixer must produce a *stable per (user, tab, sort)* ordering — the
 * same logged-in viewer should not see the feed jitter every refresh, and
 * the same anonymous bucket should always degrade to the same default
 * salon shape. At the same time, two different viewers should get a
 * meaningfully different first screen.
 *
 * To get there cheaply we use:
 *
 *   1. **FNV-1a 32-bit** — a tiny, dependency-free, non-cryptographic
 *      string hash. Good enough for seeding tie-break jitter; never used
 *      for security or storage keys.
 *   2. **Mulberry32** — a public-domain 32-bit PRNG that takes a seed and
 *      returns a deterministic stream of [0, 1) floats. Same seed → same
 *      sequence, every time. Tiny (≤10 lines).
 *
 * Together they give us:
 *
 *   const rng = createRngFromSeed(seedFromViewer({ userId, tab, sort }));
 *   const jitter = rng() * 2 - 1; // ∈ (-1, 1)
 *
 * That jitter, multiplied by a small constant (see `feedScoring.ts`), is
 * what lets two viewers diverge on tie cases without ever destroying the
 * meaningful base ordering of `latest` / `popular`.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit hash of a UTF-16 code-point sequence. Returns an unsigned
 * 32-bit integer represented as a JS number.
 *
 * Notes:
 *   - This is *not* a cryptographic hash. Do not use for auth, identifiers
 *     visible to the network, or anything that needs collision resistance.
 *   - Stable across runs: same input string ⇒ same number on every JS
 *     engine. Used as the seed for our PRNG.
 */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Mulberry32 — public-domain 32-bit PRNG. Returns a closure that yields
 * the next [0, 1) float on each call. Same `seed` ⇒ same sequence.
 *
 * Source: https://stackoverflow.com/a/47593316 (public domain attribution
 * by Tommy Ettinger). Reproduced here so we don't pull a runtime dep.
 */
export function createRngFromSeed(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a stable seed for one viewer + (tab, sort) pair. Anonymous viewers
 * fall into a single shared bucket — they all see the same default salon,
 * which is fine because anonymous = no personalization signals to differ
 * on. Adding a coarser bucket (e.g. day) is a future-Sprint freshness
 * lever; deliberately omitted here so a refresh stays stable.
 */
export function seedFromViewer(input: {
  userId: string | null;
  tab: string;
  sort?: string | null;
}): number {
  const userKey = input.userId ?? "anon";
  const sortKey = input.sort ?? "_";
  return fnv1a32(`v1:${userKey}:${input.tab}:${sortKey}`);
}

/**
 * Per-item jitter bucket. Pure function of `(viewerSeed, itemKey)` so
 * the same artwork lands in the same jitter bucket every time the viewer's
 * seed is constant. Output ∈ `(-1, 1)`.
 *
 * Why XOR + Mulberry32 step (instead of FNV-1a on `seed:itemKey`):
 *
 * FNV-1a has a weak avalanche on the *trailing* bytes of its input. When
 * the only difference between two inputs is the very last character
 * (which is what you get for adjacent ids like `art-a0` / `art-a1`),
 * the resulting hashes end up numerically close — and once divided into
 * `[0, 1)` they produce nearly-identical jitter. The mixer then can't
 * distinguish two viewers on adjacent ties because each viewer's per-item
 * jitter values march in lockstep.
 *
 * Composing the *FNV-1a hash of the full item key* with the viewer seed
 * via XOR, then running one Mulberry32 mixing step, fixes that: small
 * input changes diffuse across all 32 bits before division, so adjacent
 * ids produce well-separated jitter values per viewer.
 *
 * This is still deterministic on `(viewerSeed, itemKey)`.
 */
export function jitterForItem(viewerSeed: number, itemKey: string): number {
  const itemHash = fnv1a32(itemKey);
  let t = ((viewerSeed >>> 0) ^ (itemHash >>> 0)) >>> 0;
  t = (t + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = (t ^ (t >>> 14)) >>> 0;
  return (u / 4294967296) * 2 - 1;
}
