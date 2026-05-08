// Sprint 6.2 — Network Hub regression guard.
//
// Pins three architectural promises so a future patch can't quietly
// undo them:
//   1. /my/network exposes 4 tabs (followers, following, relationships,
//      requests) and renders the two new panel components when those
//      tabs are active.
//   2. /my/relationships and /my/access-requests are thin redirect
//      pages that funnel into /my/network?tab=... — neither route is
//      allowed to ship its own desk / inbox body again.
//   3. The Studio Hero exposes the calm `studio-network` pill (single
//      button + presence dot) and /my/page.tsx feeds it
//      `pendingNetworkActivityCount`, sourced from the desk RPC.
//   4. Tour registry covers the new tabs (relationships + requests +
//      activity-dot steps), and bumped its version.

import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

(async () => {
  // 1. /my/network — 4 tabs.
  const network = read("src/app/my/network/page.tsx");
  assert.ok(
    /type TabKey =[^;]*"followers"[^;]*"following"[^;]*"relationships"[^;]*"requests"/.test(
      network
    ),
    "MyNetworkPage TabKey must list the 4 hub tabs"
  );
  for (const tab of ["followers", "following", "relationships", "requests"]) {
    assert.ok(
      new RegExp(`"network\\.tabs\\.${tab}"`).test(network),
      `MyNetworkPage must render the network.tabs.${tab} label`
    );
    assert.ok(
      new RegExp(`"network\\.guide\\.${tab}"`).test(network),
      `MyNetworkPage must render the network.guide.${tab} explanatory copy`
    );
  }
  assert.ok(
    /RelationshipDeskPanel\b/.test(network) &&
      /AccessRequestsPanel\b/.test(network),
    "MyNetworkPage must mount both new panels"
  );

  // 2. Redirect pages — must contain router.replace, must NOT re-emit
  //    desk / inbox surface itself.
  // Strip both line and block comments before scanning so a doc
  // comment that mentions e.g. "RelationshipDeskPanel" can't trip the
  // banned-symbol check (the body may legitimately reference panel
  // names while explaining the redirect intent).
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
  }
  for (const [rel, target] of [
    [
      "src/app/my/relationships/page.tsx",
      "/my/network?tab=relationships",
    ],
    ["src/app/my/access-requests/page.tsx", "/my/network?tab=requests"],
  ] as const) {
    const body = read(rel);
    const code = stripComments(body);
    assert.ok(
      code.includes(`router.replace("${target}")`),
      `${rel} must redirect to ${target}`
    );
    // Must not import the panel directly (prevents a second mount with
    // its own state on top of the redirect, which would reintroduce the
    // duplicate-fetch we are explicitly avoiding).
    for (const banned of [
      "RelationshipDeskPanel",
      "AccessRequestsPanel",
      "getRelationshipDeskForOwner(",
      "listAccessRequestsForMe(",
    ]) {
      assert.ok(
        !code.includes(banned),
        `${rel} must NOT mount or call ${banned} (it must remain a redirect)`
      );
    }
  }

  // 3. StudioHero pill + /my page wiring.
  const hero = read("src/components/studio/StudioHero.tsx");
  assert.ok(
    /pendingNetworkActivityCount\?:\s*number\s*\|\s*null/.test(hero),
    "StudioHero must accept pendingNetworkActivityCount prop"
  );
  assert.ok(
    /data-tour="studio-network"/.test(hero) &&
      /href="\/my\/network"/.test(hero),
    "StudioHero must render the network pill anchored at studio-network"
  );
  // Dot rendered only when count > 0.
  assert.ok(
    /\(pendingNetworkActivityCount\s*\?\?\s*0\)\s*>\s*0/.test(hero),
    "StudioHero must gate the dot on pendingNetworkActivityCount > 0"
  );

  const my = read("src/app/my/page.tsx");
  assert.ok(
    /getRelationshipDeskForOwner\(/.test(my),
    "/my/page.tsx must call the desk RPC to compute pendingNetworkActivityCount"
  );
  assert.ok(
    /pendingNetworkActivityCount=\{pendingNetworkActivityCount\}/.test(my),
    "/my/page.tsx must forward the count into StudioHero"
  );
  assert.ok(
    /pending_access_request_count[\s\S]{0,80}open_inquiry_count/.test(my),
    "/my/page.tsx must sum pending_access_request_count + open_inquiry_count for the dot signal"
  );
  // The legacy text-link strip is acting-as only after Sprint 6.2.
  assert.ok(
    /profile\s*&&\s*actingAsProfileId\s*&&[\s\S]{0,400}\/my\/network\?tab=requests/.test(
      my
    ),
    "/my/page.tsx legacy strip must be acting-as only and point at /my/network?tab=requests"
  );

  // 4. Tour registry covers the new steps and bumped its version.
  const tours = read("src/lib/tours/tourRegistry.ts");
  // Network tour: version >= 3, includes relationships / requests /
  // activity-dot steps.
  const networkTourBlock =
    tours.match(
      /\[TOUR_IDS\.network\]:\s*\{[\s\S]*?titleKey:\s*"tour\.network\.title"[\s\S]*?\],\s*\}/
    )?.[0] ?? "";
  assert.ok(networkTourBlock.length > 0, "tour registry must define network tour");
  assert.ok(
    /version:\s*([3-9]|\d{2,})/.test(networkTourBlock),
    "network tour version must be bumped to >=3 in Sprint 6.2"
  );
  for (const stepId of ["relationships", "requests", "activity-dot"]) {
    assert.ok(
      new RegExp(`id:\\s*"${stepId}"`).test(networkTourBlock),
      `network tour must include the "${stepId}" step`
    );
  }

  // Studio tour: version bumped to >=10 with a network step pointing at
  // studio-network anchor.
  const studioTourBlock =
    tours.match(
      /\[TOUR_IDS\.studio\]:\s*\{[\s\S]*?titleKey:\s*"tour\.studio\.title"[\s\S]*?\],\s*\}/
    )?.[0] ?? "";
  assert.ok(
    /version:\s*(1[0-9]|[2-9]\d|\d{3,})/.test(studioTourBlock),
    "studio tour version must be bumped to >=10 in Sprint 6.2"
  );
  assert.ok(
    /target:\s*"studio-network"/.test(studioTourBlock),
    "studio tour must include a step anchored at studio-network"
  );

  console.log("sprint6-2-network-hub.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
