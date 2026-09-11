// Private IR demo: secret gate, persona seats, no production writes,
// no outbound email, storage URLs rewrite through the asset proxy.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const middleware = read("middleware.ts");
const enter = read("src/app/api/ir/enter/route.ts");
const asset = read("src/app/api/ir/asset/route.ts");
const authGate = read("src/components/AuthGate.tsx");
const routing = read("src/lib/identity/routing.ts");
const auth = read("src/lib/supabase/auth.ts");
const artworks = read("src/lib/supabase/artworks.ts");
const storage = read("src/lib/supabase/storage.ts");
const seed = read("scripts/seed-ir-demo-personas.ts");
const artistInvite = read("src/app/api/artist-invite-email/route.ts");
const delegationInvite = read("src/app/api/delegation-invite-email/route.ts");
const nextConfig = read("next.config.ts");
const layout = read("src/app/layout.tsx");
const irPage = read("src/app/ir/page.tsx");
const config = read("src/lib/irDemo/config.ts");
const messages = read("src/lib/i18n/messages.ts");

assert.match(config, /heimyunghyun/);
assert.match(config, /thegreen_oc/);
assert.match(config, /g1art_founder/);
assert.match(config, /ir-artist@theo\.demo/);
assert.match(config, /NEXT_PUBLIC_IR_DEMO/);

assert.match(middleware, /irDemoCookieIsValid/);
assert.doesNotMatch(middleware, /IR_DEMO_COOKIE\)\?\.value !== "1"/);
assert.match(middleware, /X-Robots-Tag/);
assert.match(middleware, /IR_PATH/);

assert.match(enter, /signInWithPassword/);
assert.match(enter, /irDemoCookieToken/);
assert.match(enter, /persona\.email/);
assert.doesNotMatch(enter, /sgufonscldvdwfgzltfw/);

assert.match(asset, /irDemoCookieIsValid/);
assert.match(asset, /IR_DEMO_ASSET_ORIGIN/);
assert.match(asset, /storage\/v1\/object\/public/);

assert.match(authGate, /isIrDemo\(\) \? IR_PATH : LOGIN_PATH/);
assert.match(authGate, /if \(isIrDemo\(\)\) \{\s*setReady\(true\)/);

assert.match(routing, /if \(isIrDemo\(\)\) return IR_PATH/);
assert.match(routing, /if \(isIrDemo\(\)\) \{\s*return \{ to: pickNext/);

assert.match(auth, /if \(isIrDemo\(\)\) \{\s*return \{ data: \{ user: null, session: null \}, error: null \}/);
assert.match(auth, /sendPasswordReset/);

assert.match(artworks, /irDemoAssetUrl\(path, BUCKET\)/);
assert.match(storage, /irDemoAssetUrl\(path, BUCKET\)/);

assert.match(artistInvite, /skipped: "ir_demo"/);
assert.match(delegationInvite, /skipped: "ir_demo"/);
assert.match(nextConfig, /pathname: "\/api\/ir\/asset"/);
assert.match(nextConfig, /unoptimized: process\.env\.NEXT_PUBLIC_IR_DEMO === "true"/);

assert.match(irPage, /await supabase\.auth\.signOut\(\)/);
assert.match(irPage, /setSession/);
assert.match(layout, /robots: \{ index: false, follow: false \}/);
assert.match(layout, /IrDemoBanner/);

assert.match(seed, /PRODUCTION_PROJECT_REF = "sgufonscldvdwfgzltfw"/);
assert.match(seed, /IR_DEMO_SUPABASE_URL/);
assert.match(seed, /IR_DEMO_SERVICE_ROLE_KEY/);
assert.doesNotMatch(seed, /NEXT_PUBLIC_SUPABASE_URL/);
assert.match(seed, /looksLikeProduction/);
assert.match(seed, /process\.exit\(1\)/);

for (const key of [
  "irDemo.title",
  "irDemo.persona.artist.title",
  "irDemo.persona.curator.title",
  "irDemo.persona.collector.title",
  "irDemo.banner",
]) {
  assert.match(messages, new RegExp(`"${key.replace(".", "\\.")}":`));
}

process.env.NEXT_PUBLIC_IR_DEMO = "true";

async function main() {
  const routingMod = await import(
    pathToFileURL(join(root, "src/lib/identity/routing.ts")).href
  );
  const incomplete = {
    user_id: "u",
    has_password: false,
    is_email_confirmed: true,
    needs_onboarding: true,
    username: null,
    display_name: null,
    is_placeholder_username: true,
    needs_identity_setup: true,
  };
  const { to: demoHome } = routingMod.routeByAuthState(incomplete, {
    sessionPresent: true,
    nextPath: "/u/heimyunghyun",
  });
  assert.equal(demoHome, "/u/heimyunghyun");
  assert.equal(routingMod.loginUrlWithNext({ nextPath: "/feed" }), "/ir");
  assert.equal(routingMod.onboardingUrlWithNext({ nextPath: "/feed" }), "/ir");

  const { irDemoAssetUrl, irPersona, isIrDemo } = await import(
    pathToFileURL(join(root, "src/lib/irDemo/config.ts")).href
  );
  assert.equal(isIrDemo(), true);
  assert.equal(irPersona("artist")?.username, "heimyunghyun");
  assert.match(irDemoAssetUrl("u/a.jpg"), /\/api\/ir\/asset\?/);

  console.log("ir-demo tests ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
