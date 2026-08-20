/**
 * Signup v2 Phase 2 (2026-08-19) — shared submit helper for Step 4's
 * lightweight quick-start artwork upload.
 *
 * Deliberately kept as a **minimal** subset of `/upload`'s handleSubmit.
 * The full-page uploader is ~1700 lines and does dedup / bilingual /
 * price / exhibition attach / perspective correction; Step 4 only needs:
 *
 *   - 1 image (primary)
 *   - title (bilingual: current locale writes both raw + `_ko` / `_en`)
 *   - medium (bilingual)
 *   - size (free-text + `parseSizeToDimensionsCm` auto-fill)
 *   - story (bilingual, optional)
 *   - status → CREATED / OWNS / CURATED
 *
 * Ownership + claim mapping matches spec §3.4:
 *
 *   | Intent   | artworks.ownership_status | claims row?              |
 *   | -------- | ------------------------- | ------------------------ |
 *   | CREATED  | `available`               | none (RLS: artist=self)  |
 *   | OWNS     | `owned`                   | `claim_type='OWNS'`      |
 *   | CURATED  | `not_for_sale`            | `claim_type='CURATED'`   |
 *
 * The CREATED path deliberately does NOT insert a `claims` row —
 * `artist_id = auth.uid()` alone satisfies the artwork_images RLS
 * policy `Allow owner insert artwork_images`. OWNS / CURATED create a
 * claim BEFORE attaching the image so the same RLS policy accepts the
 * insert via `claims.subject_profile_id = auth.uid()`.
 *
 * Rollback strategy mirrors `/upload/page.tsx::handleSubmit`: on any
 * later failure we delete uploaded storage bytes and the artwork row
 * so the user isn't left with orphan blobs / draft artworks in
 * `/my/artworks`.
 *
 * A tiny dedup probe (§8 #7) runs against the caller's own works only
 * (`artist_id = auth.uid()`) — cheap, doesn't require external artist
 * scoping, and is surfaced as an INLINE WARNING rather than a hard
 * block (Step 4 is optional, we err on the side of "let them post").
 */

import type { Locale } from "@/lib/i18n/locale";
import {
  createArtwork,
  attachArtworkImage,
  deleteArtwork,
  updateArtworkDimsIfMissing,
  type CreateArtworkPayload,
} from "@/lib/supabase/artworks";
import { removeStorageFile, uploadArtworkImage } from "@/lib/supabase/storage";
import {
  createClaimForExistingArtist,
  searchWorksForDedup,
} from "@/lib/provenance/rpc";
import { parseSizeToDimensionsCm } from "@/lib/size/format";
import type { ClaimType } from "@/lib/provenance/types";

/**
 * Signup v2 Step 4 intent labels. Aligned with `/upload`'s intent
 * dropdown; INVENTORY is intentionally omitted (gallerist-only path
 * with attribution UX Step 4 doesn't surface).
 */
export type SignupStep4Intent = "CREATED" | "OWNS" | "CURATED";

const OWNERSHIP_STATUS_BY_INTENT: Record<SignupStep4Intent, string> = {
  CREATED: "available",
  OWNS: "owned",
  CURATED: "not_for_sale",
};

export type SignupStep4CreatePayload = {
  userId: string;
  intent: SignupStep4Intent;
  file: File;
  title: string;
  medium: string;
  size: string;
  story: string;
  locale: Locale;
};

export type SignupStep4CreateResult =
  | { ok: true; artworkId: string }
  | { ok: false; code: string; message: string };

/**
 * Run the cheap dedup probe (§8 #7) scoped to the caller's own works.
 * Returns the raw list — callers decide whether to render an inline
 * warning or gate the submit.
 */
export async function findMyDedupCandidates(
  userId: string,
  title: string,
): Promise<{ id: string; title: string | null }[]> {
  const q = title.trim();
  if (!q || q.length < 2 || !userId) return [];
  const { data } = await searchWorksForDedup({
    artistProfileId: userId,
    q,
    limit: 5,
  });
  return (data ?? []).map((row) => ({ id: row.id, title: row.title }));
}

/**
 * Locale-aware writer for title / medium / story. Per spec §5 #10, the
 * current locale populates BOTH the legacy slot AND its bilingual
 * companion (KO or EN) so downstream renderers pick a value regardless
 * of which projection they read. The opposite-language slot is left
 * NULL — the user can fill it later in Studio → Profile.
 */
function bilingualSlots(
  raw: string,
  locale: Locale,
): { legacy: string | null; ko: string | null; en: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { legacy: null, ko: null, en: null };
  if (locale === "ko") return { legacy: trimmed, ko: trimmed, en: null };
  return { legacy: trimmed, ko: null, en: trimmed };
}

export async function createArtworkForCreatedIntent(
  payload: SignupStep4CreatePayload,
): Promise<SignupStep4CreateResult> {
  const { userId, intent, file, title, medium, size, story, locale } = payload;
  if (!userId) {
    return { ok: false, code: "not_authenticated", message: "Not authenticated" };
  }

  const titleTrim = title.trim();
  const mediumTrim = medium.trim();
  const sizeTrim = size.trim();
  if (!titleTrim) {
    return { ok: false, code: "missing_title", message: "Title is required" };
  }
  if (!file) {
    return { ok: false, code: "missing_image", message: "Image is required" };
  }

  const titleSlots = bilingualSlots(titleTrim, locale);
  const mediumSlots = bilingualSlots(mediumTrim, locale);
  const storySlots = bilingualSlots(story, locale);

  // Structured dims are best-effort — unparseable strings just leave
  // width/height NULL and we let the salon dims-confirm nudge on the
  // artwork detail page pick it up later.
  const parsedDims = parseSizeToDimensionsCm(sizeTrim, "cm");

  // Signup v2 Step 4 has no pricing surface — every artwork is created
  // in inquire mode, per §11.5. The user can add pricing later on /my.
  const artworkPayload: CreateArtworkPayload = {
    title: titleSlots.legacy ?? titleTrim,
    title_ko: titleSlots.ko,
    title_en: titleSlots.en,
    // Year is not surfaced at Step 4; default to the current calendar
    // year (matches wireframe intent — most quick-start uploads are
    // recent work). User can edit later in `/my/artworks/{id}`.
    year: new Date().getFullYear(),
    medium: mediumSlots.legacy ?? mediumTrim,
    medium_ko: mediumSlots.ko,
    medium_en: mediumSlots.en,
    size: sizeTrim,
    size_unit: sizeTrim ? "cm" : null,
    story: storySlots.legacy,
    story_ko: storySlots.ko,
    story_en: storySlots.en,
    ownership_status: OWNERSHIP_STATUS_BY_INTENT[intent],
    pricing_mode: "inquire",
    is_price_public: false,
    // For OWNS / CURATED in the signup wizard we still set
    // `artist_id = userId` because Step 4 has no attribution picker
    // (external artist search lives on `/upload`). The user can later
    // reassign the artist from `/my/artworks/{id}`.
    artist_id: userId,
  };

  const { data: artworkId, error: createErr } = await createArtwork(artworkPayload);
  if (createErr || !artworkId) {
    return {
      ok: false,
      code: "create_artwork_failed",
      message: (createErr as { message?: string } | null)?.message
        ?? "Failed to create artwork",
    };
  }

  // 1. Create the claim BEFORE image attach so RLS
  //    (`Allow owner insert artwork_images`) accepts the insert via
  //    `claims.subject_profile_id = auth.uid()`. CREATED does not need
  //    a claim — `artist_id = auth.uid()` already satisfies the same
  //    policy through the artist branch.
  if (intent !== "CREATED") {
    const claimType: ClaimType = intent === "OWNS" ? "OWNS" : "CURATED";
    const { error: claimErr } = await createClaimForExistingArtist({
      artistProfileId: userId,
      claimType,
      workId: artworkId,
      visibility: "public",
    });
    if (claimErr) {
      // Roll the artwork back so the user doesn't see an unclaimed
      // draft in `/my/artworks` on their first login.
      try {
        await deleteArtwork(artworkId);
      } catch {
        /* best-effort */
      }
      return {
        ok: false,
        code: "create_claim_failed",
        message: (claimErr as { message?: string } | null)?.message
          ?? "Failed to record ownership",
      };
    }
  }

  // 2. Upload the image bytes.
  const uploadedPaths: string[] = [];
  const rollback = async () => {
    for (const p of uploadedPaths) {
      try {
        await removeStorageFile(p);
      } catch {
        /* best-effort */
      }
    }
    try {
      await deleteArtwork(artworkId);
    } catch {
      /* best-effort */
    }
  };

  let upload: Awaited<ReturnType<typeof uploadArtworkImage>>;
  try {
    upload = await uploadArtworkImage(file, userId);
    uploadedPaths.push(upload.displayPath);
    if (upload.originalPath) uploadedPaths.push(upload.originalPath);
  } catch (uploadErr) {
    await rollback();
    return {
      ok: false,
      code: "upload_failed",
      message:
        uploadErr instanceof Error ? uploadErr.message : "Failed to upload image",
    };
  }

  // 3. Attach the image row (primary / wall_mounted). Consistent with
  //    `/upload/page.tsx`, the first image is always the canvas the
  //    feed / profile thumbnails pick up.
  const { error: attachErr } = await attachArtworkImage(
    artworkId,
    upload.displayPath,
    {
      sortOrder: 0,
      viewType: "wall_mounted",
      originalStoragePath: upload.originalPath,
      displayBytes: upload.displayBytes,
      originalBytes: upload.originalBytes,
      compressionMeta: upload.compressionMeta,
    },
  );
  if (attachErr) {
    await rollback();
    return {
      ok: false,
      code: "attach_image_failed",
      message:
        (attachErr as { message?: string } | null)?.message
          ?? "Failed to attach image to artwork",
    };
  }

  // 4. Best-effort: write structured dims when the size string parsed.
  //    RLS-friendly guard inside `updateArtworkDimsIfMissing` swallows
  //    the "not owner" case — for Signup v2 the user always IS the
  //    owner so this should succeed when `parsedDims != null`.
  if (parsedDims) {
    try {
      await updateArtworkDimsIfMissing(artworkId, {
        widthCm: parsedDims.widthCm,
        heightCm: parsedDims.heightCm,
        depthCm: parsedDims.depthCm ?? null,
      });
    } catch {
      /* best-effort — dims are additive metadata, not load-bearing */
    }
  }

  return { ok: true, artworkId };
}
