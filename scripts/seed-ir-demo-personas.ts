/**
 * Set IR-demo persona emails + a shared password on the cloned
 * Supabase project. Refuses the production project. Never pass
 * production URL/keys.
 *
 *   IR_DEMO_SUPABASE_URL=https://<branch-ref>.supabase.co \
 *   IR_DEMO_SERVICE_ROLE_KEY=... \
 *   IR_DEMO_PASSWORD='...' \
 *   npm run seed:ir-demo
 */

import { createClient } from "@supabase/supabase-js";
import { IR_PERSONAS } from "../src/lib/irDemo/config";

const PRODUCTION_PROJECT_REF = "sgufonscldvdwfgzltfw";

function looksLikeProduction(url: string): boolean {
  return url.includes(PRODUCTION_PROJECT_REF);
}

async function main() {
  const url = process.env.IR_DEMO_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.IR_DEMO_SERVICE_ROLE_KEY?.trim() ?? "";
  const password = process.env.IR_DEMO_PASSWORD ?? "";

  if (!url || !serviceKey || !password) {
    console.error(
      "Need IR_DEMO_SUPABASE_URL, IR_DEMO_SERVICE_ROLE_KEY, and IR_DEMO_PASSWORD. Do not fall back to production env.",
    );
    process.exit(1);
  }
  if (looksLikeProduction(url)) {
    console.error(
      `Refusing to seed production (${PRODUCTION_PROJECT_REF}). Point IR_DEMO_SUPABASE_URL at the clone.`,
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("IR_DEMO_PASSWORD must be at least 12 characters.");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const persona of IR_PERSONAS) {
    const { data: existing, error: getErr } = await admin.auth.admin.getUserById(
      persona.profileId,
    );
    if (getErr || !existing.user) {
      console.error(`Missing auth user for ${persona.key} (${persona.profileId})`, getErr);
      process.exit(1);
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(persona.profileId, {
      email: persona.email,
      password,
      email_confirm: true,
    });
    if (updErr) {
      console.error(`Failed to update ${persona.key}`, updErr);
      process.exit(1);
    }
    console.log(`ok ${persona.key} ${persona.email} (was ${existing.user.email})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
