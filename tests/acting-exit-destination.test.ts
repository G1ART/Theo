// Leaving or entering acting-as lands on a public profile, never the
// workspace. Pins the banner, every switcher row, resigning the
// delegation in use, logout, the "manage" CTA, and `/me`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { returnToOwnAccount } from "../src/lib/delegation/returnToOwnAccount";
import {
  ownAccountProfileHref,
  principalEntryHref,
} from "../src/lib/delegation/principalProfileHref";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function fakeRouter() {
  const calls: string[] = [];
  return {
    calls,
    router: {
      push: (href: string) => calls.push(`push:${href}`),
      refresh: () => calls.push("refresh"),
    },
  };
}

{
  const { calls, router } = fakeRouter();
  let cleared = 0;
  const href = returnToOwnAccount({
    username: "g1art_founder",
    pathname: "/u/heimyunghyun",
    clearActingAs: () => {
      cleared += 1;
    },
    router,
  });
  assert.equal(href, "/u/g1art_founder");
  assert.equal(cleared, 1);
  assert.deepEqual(calls, ["push:/u/g1art_founder", "refresh"]);
}

{
  const { calls, router } = fakeRouter();
  const href = returnToOwnAccount({
    username: "user_abc123",
    pathname: "/my",
    clearActingAs: () => {},
    router,
  });
  assert.equal(href, "/onboarding/identity");
  assert.deepEqual(calls, ["push:/onboarding/identity", "refresh"]);
}

// Off the upload wizard it is a full page load, not a client push.
{
  const assigned: string[] = [];
  const g = globalThis as { window?: unknown };
  g.window = { location: { assign: (h: string) => assigned.push(h) } };
  const { calls, router } = fakeRouter();
  returnToOwnAccount({
    username: "g1art_founder",
    pathname: "/upload/bulk",
    clearActingAs: () => {},
    router,
  });
  assert.deepEqual(assigned, ["/u/g1art_founder"]);
  assert.deepEqual(calls, []);
  delete g.window;
}

assert.equal(ownAccountProfileHref("heimyunghyun"), "/u/heimyunghyun");
assert.equal(principalEntryHref("heimyunghyun"), "/u/heimyunghyun");
assert.equal(principalEntryHref("user_abc123"), "/my");
assert.equal(principalEntryHref(null), "/my");

const header = read("src/components/Header.tsx");
const switcher = read("src/components/shell/AccountSwitcher.tsx");
const drawer = read("src/components/delegation/DelegationDetailDrawer.tsx");
for (const [name, src] of [
  ["Header", header],
  ["AccountSwitcher", switcher],
] as const) {
  assert.equal(src.includes('router.push("/my")'), false, `${name} must not send acting exits to /my`);
  assert.equal(src.includes('"/my")) return'), false, `${name} must not hard-leave to /my`);
}
assert.match(header, /function handleSwitchToOperator\(\) \{[\s\S]*?returnToOwnAccount\(/);
assert.match(switcher, /function switchToOwn\(\) \{[\s\S]*?returnToOwnAccount\(/);
assert.match(drawer, /const handleResign = useCallback\(async \(\) => \{[\s\S]*?returnToOwnAccount\(/);
assert.match(drawer, /actingAsProfileId === detail\.delegation\.delegator_profile_id/);

// "View permissions" opens the delegation in use.
assert.match(header, /\/my\/delegations\?openId=\$\{encodeURIComponent\(actingDelegationId\)\}/);
assert.match(header, /href=\{viewPermissionsHref\}/);
const hub = read("src/app/my/delegations/page.tsx");
assert.match(hub, /if \(!openId\) \{[\s\S]*?consumedDeepLinkRef\.current = null;/);

// Logout ends acting-as.
assert.match(switcher, /async function handleLogout\(\) \{[\s\S]*?clearActingAs\(\);\s*await signOut\(\);/);
assert.match(read("src/app/settings/page.tsx"), /clearActingAs\(\);\s*await signOut\(\);/);
const provider = read("src/context/ActingAsContext.tsx");
assert.match(provider, /if \(event !== "SIGNED_OUT"\) return;[\s\S]*?saveStored\(\{ profileId: null, label: null \}\)/);

// `/me` is my public profile.
const me = read("src/app/me/page.tsx");
assert.match(me, /router\.replace\(ownAccountProfileHref\(/);
assert.equal(me.includes('redirect("/my")'), false);

// Delegation brief links open real screens.
const brief = read("src/app/api/ai/delegation-brief/route.ts");
assert.equal(brief.includes('"/profile/edit"'), false);
assert.match(brief, /href: "\/my\/library\?visibility=draft"/);
assert.match(read("src/components/delegation/DelegationBriefPanel.tsx"), /sanitizeActionHref\(p\.href\)/);

// The invite keeps the token through login and both signup flows.
const invite = read("src/app/invites/delegation/page.tsx");
assert.match(invite, /loginUrlWithNext\(\{ nextPath: nextTarget \}\)/);
assert.match(invite, /onboardingUrlWithNext\(\{ nextPath: nextTarget \}\)/);

console.log("acting-exit-destination.test.ts: ok");
