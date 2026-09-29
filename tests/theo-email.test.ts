import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_EMAIL_TEMPLATES } from "../src/lib/email/authTemplates";
import { THEO_LOGO_URL } from "../src/lib/email/theoEmail";

const root = join(__dirname, "..");

for (const [name, tpl] of Object.entries(AUTH_EMAIL_TEMPLATES)) {
  const file = readFileSync(join(root, "supabase/templates", `${name}.html`), "utf8");
  assert.equal(file, tpl.html, `${name} html drifted from authTemplates`);
  assert.equal(file.includes("Abstract"), false);
  assert.equal(file.includes(THEO_LOGO_URL), true);
  assert.equal(tpl.subject.includes("Theo"), true);
  assert.equal(tpl.subject.includes("Abstract"), false);
}

assert.match(AUTH_EMAIL_TEMPLATES.confirmation.html, /\{\{ \.ConfirmationURL \}\}/);
assert.match(AUTH_EMAIL_TEMPLATES.reauthentication.html, /\{\{ \.Token \}\}/);
assert.match(AUTH_EMAIL_TEMPLATES.email_change.html, /\{\{ \.NewEmail \}\}/);

const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
for (const name of Object.keys(AUTH_EMAIL_TEMPLATES)) {
  assert.match(config, new RegExp(`content_path = "./supabase/templates/${name}.html"`));
}

console.log("theo-email.test.ts: ok");
