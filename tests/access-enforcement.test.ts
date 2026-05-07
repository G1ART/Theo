// Sprint 5.2 — Access Enforcement & Redaction Hardening invariants.
//
// These are *static* source-text checks. They guarantee that the
// viewer-facing artwork detail and room pages cannot regress to the
// Sprint 5 baseline pattern of "fetch the full row, then hide it in
// JSX". A passing run proves three things:
//
//   1. /artwork/[id]/page.tsx must fetch the artwork through the
//      redacted-passport RPC (`getArtworkPassportForViewer`) and never
//      through the full-row `getArtworkById` (which still exists for
//      owner-side flows like edit/delete elsewhere in the app).
//
//   2. /artwork/[id]/page.tsx must NOT contain the legacy fail-open
//      pattern `!priceResolution || priceResolution.canView`. The
//      Sprint 5.2 contract is fail-closed: when a resolution is
//      missing, the gate renders.
//
//   3. /room/[token]/page.tsx must fetch through
//      `getRoomForViewerByToken` and must NOT call
//      `getRoomItemsByToken` directly — the items array is gated on
//      the server, never on the client.
//
// We deliberately don't import the page modules; they are React
// client components that pull in supabase / next/navigation context
// that is hostile to a node test. Reading the file as text is enough
// for the contract we want to pin.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

(async () => {
  const artworkPage = read("src/app/artwork/[id]/page.tsx");
  const roomPage = read("src/app/room/[token]/page.tsx");

  // 1. Artwork detail must use the redacted RPC for the viewer fetch.
  assert.ok(
    artworkPage.includes("getArtworkPassportForViewer"),
    "artwork detail must fetch through getArtworkPassportForViewer"
  );

  // 2. Artwork detail must not call the standalone visibility resolver
  //    or relationship-context RPCs directly — both arrive in the
  //    redacted-passport payload now.
  assert.ok(
    !artworkPage.includes("resolveVisibilityForViewer("),
    "artwork detail must not call resolveVisibilityForViewer directly"
  );
  assert.ok(
    !artworkPage.includes("getViewerRelationshipContext("),
    "artwork detail must not call getViewerRelationshipContext directly"
  );

  // 3. The fail-open pattern from Sprint 5 baseline must be gone.
  for (const legacy of [
    "!priceResolution || priceResolution.canView",
    "!availabilityResolution || availabilityResolution.canView",
    "!descriptionResolution || descriptionResolution.canView",
  ]) {
    assert.ok(
      !artworkPage.includes(legacy),
      `artwork detail must not contain legacy fail-open pattern: ${legacy}`
    );
  }

  // 4. Owner-side claim/confirm refresh paths must also flow through
  //    the redacted RPC so visibility resolutions stay coherent (no
  //    drift between artwork state and gate state after a mutation).
  assert.ok(
    !/\bgetArtworkById\s*\(/.test(artworkPage),
    "artwork detail must not call getArtworkById in viewer flow (owner refresh uses refreshPassport)"
  );

  // 5. Room page must use the redacted RPC and NOT call the legacy
  //    items RPC directly.
  assert.ok(
    roomPage.includes("getRoomForViewerByToken"),
    "room page must fetch through getRoomForViewerByToken"
  );
  // Inspect *call sites* (open paren + ident), not docstring mentions.
  assert.ok(
    !/getRoomItemsByToken\s*\(/.test(roomPage),
    "room page must not call getRoomItemsByToken directly"
  );
  assert.ok(
    !/getRoomByToken\s*\(/.test(roomPage),
    "room page must not call getRoomByToken directly (replaced by redacted RPC)"
  );

  // 6. Room page must not import the standalone visibility resolver —
  //    visibility now arrives in the same payload as the room meta.
  assert.ok(
    !/resolveVisibilityForViewer\s*\(/.test(roomPage),
    "room page must not call resolveVisibilityForViewer directly"
  );

  // 7. GatedField must wire the follow CTA to a real follow handler.
  //    The Sprint 5 baseline rendered a bare <button onClick={onFollow?}>
  //    that no-op'd whenever the parent forgot to pass `onFollow`. The
  //    Sprint 5.2 contract is: every follow CTA renders a real
  //    <FollowButton>. Pinning the import is a quick proxy for that.
  const gateField = read("src/components/visibility/GatedField.tsx");
  assert.ok(
    gateField.includes("FollowButton"),
    "GatedField must render FollowButton for follow-kind CTAs (no inert no-op)"
  );
  // The legacy `onFollow` prop must be gone — the button is internal.
  assert.ok(
    !gateField.includes("onFollow?:"),
    "GatedField must not expose the legacy `onFollow?:` prop"
  );

  // 8. AccessRequestModal must consume the explicit `duplicate` flag
  //    from `createAccessRequest` (the timestamp-comparison heuristic
  //    is unreliable for default-inserted rows).
  const modal = read("src/components/visibility/AccessRequestModal.tsx");
  assert.ok(
    modal.includes("duplicate"),
    "AccessRequestModal must read the explicit `duplicate` flag from createAccessRequest"
  );
  assert.ok(
    !modal.includes("data.created_at !== data.updated_at"),
    "AccessRequestModal must not infer duplicates from created_at !== updated_at"
  );

  // 9. cancelAccessRequest wrapper must call the SECURITY DEFINER RPC,
  //    not a direct PostgREST UPDATE. The direct-update RLS policy is
  //    dropped in the migration; a stale wrapper here would silently
  //    error in production.
  const wrappers = read("src/lib/supabase/relationshipAccess.ts");
  assert.ok(
    wrappers.includes("cancel_access_request"),
    "cancelAccessRequest wrapper must call the cancel_access_request RPC"
  );
  assert.ok(
    !/cancelAccessRequest[\s\S]{0,400}\.from\(\"access_requests\"\)/.test(
      wrappers
    ),
    "cancelAccessRequest wrapper must not perform a direct .from('access_requests').update(...)"
  );

  console.log("access-enforcement.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
