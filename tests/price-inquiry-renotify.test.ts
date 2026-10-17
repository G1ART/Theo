// Price inquiry "notify again": once per 24 hours per inquiry, at most 3
// times, enforced by the server (20261017225332). SQL contract (source
// text) plus the state parser and the line under the button.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { messages } from "../src/lib/i18n/messages";
import { readRenotifyState, renotifyHint } from "../src/lib/inquiry/renotify";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const strip = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const raw = read("supabase/migrations/20261017225332_price_inquiry_renotify_limit.sql");
const sql = strip(raw);

// 1. Editor-safe SQL.
assert.equal((raw.match(/^-- == SECTION \d+ ==/gm) ?? []).length, 5);
for (const tag of sql.match(/\$[A-Za-z0-9_]*\$/g) ?? []) assert.match(tag, /^\$[A-Za-z]+\$$/);
assert.ok(!/select[^;]*\binto\s+v_/i.test(sql), "assignments use :=");

// 2. The rule lives in one function and every entry point goes through it.
const info = sql.slice(sql.indexOf("function public.price_inquiry_renotify_info"), sql.indexOf("-- == SECTION 3"));
assert.ok(/when v_used >= 3 then 'limit'/.test(info));
assert.ok(/greatest\(v_pi\.created_at, coalesce\(v_last, v_pi\.created_at\)\) \+ interval '24 hours'/.test(info));
assert.ok(/v_pi\.replied_at is not null/.test(info));
assert.ok(/revoke all on function public\.price_inquiry_renotify_info\(uuid\) from public, anon, authenticated/.test(sql));

const send = sql.slice(sql.indexOf("function public.renotify_price_inquiry"), sql.indexOf("-- == SECTION 5"));
assert.ok(/for update/.test(send), "concurrent clicks cannot both pass");
assert.ok(/v_pi\.inquirer_id is distinct from auth\.uid\(\)/.test(send), "only the inquirer");
assert.ok(/v_state := public\.price_inquiry_renotify_info\(v_pi\.id\)/.test(send));
assert.ok(/if not coalesce\(\(v_state->>'can'\)::boolean, false\) then/.test(send));
assert.ok(/insert into public\.price_inquiry_renotifies/.test(send));

const old = sql.slice(sql.indexOf("function public.resend_price_inquiry_notification"));
assert.ok(/v_out := public\.renotify_price_inquiry\(p_inquiry_id\)/.test(old), "old RPC has the same limit");
assert.ok(!/insert into public\.notifications/.test(old));

const state = sql.slice(sql.indexOf("function public.price_inquiry_renotify_state"), sql.indexOf("-- == SECTION 4"));
assert.ok(/v_inquirer is distinct from auth\.uid\(\)/.test(state));

for (const fn of ["price_inquiry_renotify_state", "renotify_price_inquiry", "resend_price_inquiry_notification"]) {
  assert.ok(sql.includes(`revoke all on function public.${fn}(uuid) from public, anon`), fn);
  assert.ok(sql.includes(`grant execute on function public.${fn}(uuid) to authenticated`), fn);
}

// 3. The log is server-only, and history is counted, not invented.
assert.ok(/alter table public\.price_inquiry_renotifies enable row level security/.test(sql));
assert.ok(/revoke all on public\.price_inquiry_renotifies from public, anon, authenticated/.test(sql));
assert.ok(!/create policy[^;]*price_inquiry_renotifies/i.test(sql));
assert.ok(/n\.created_at > pi\.created_at/.test(sql), "the first alert is not a re-notify");
assert.ok(/o\.payload->>'inquiry_id' is distinct from b\.inquiry_id::text/.test(sql), "shared batches were backfills");

// 4. The client calls the limited RPCs.
const client = read("src/lib/supabase/priceInquiries.ts");
assert.ok(client.includes('rpc("renotify_price_inquiry"'));
assert.ok(client.includes('rpc("price_inquiry_renotify_state"'));
assert.ok(!client.includes('rpc("resend_price_inquiry_notification"'));
const page = read("src/app/artwork/[id]/page.tsx");
assert.ok(page.includes("!renotifyState.can"), "the button is disabled when the server says no");
assert.ok(page.includes("renotifyHint(renotifyState, t, locale)"));

// 5. State parsing.
assert.equal(readRenotifyState(null), null);
assert.equal(readRenotifyState({ reason: "nope" }), null);
assert.deepEqual(
  readRenotifyState({ used: 1, limit: 3, remaining: 2, next_at: "2026-10-18T10:00:00Z", can: false, reason: "too_soon" }),
  { used: 1, limit: 3, remaining: 2, nextAt: "2026-10-18T10:00:00Z", can: false, reason: "too_soon" },
);
assert.equal(readRenotifyState({ reason: "ok", can: "yes" })?.can, false);

// 6. The line under the button, both locales.
const tFor = (locale: "en" | "ko") => (key: string) => (messages[locale] as Record<string, string>)[key] ?? key;
for (const locale of ["en", "ko"] as const) {
  const t = tFor(locale);
  const ok = renotifyHint(readRenotifyState({ used: 1, limit: 3, remaining: 2, can: true, reason: "ok" }), t, locale);
  const soon = renotifyHint(
    readRenotifyState({ used: 1, limit: 3, remaining: 2, next_at: "2026-10-18T10:00:00Z", can: false, reason: "too_soon" }),
    t,
    locale,
  );
  const done = renotifyHint(readRenotifyState({ used: 3, limit: 3, remaining: 0, can: false, reason: "limit" }), t, locale);
  for (const line of [ok, soon, done]) {
    assert.ok(line.length > 0, `${locale}: ${line}`);
    assert.ok(!line.includes("{"), `${locale}: every slot filled in ${line}`);
    assert.ok(!line.startsWith("priceInquiry."), `${locale}: copy exists`);
  }
  assert.ok(ok.includes("2") && ok.includes("3"), `${locale}: remaining and limit`);
  assert.ok(soon.includes("2"), `${locale}: remaining while waiting`);
  assert.ok(/18|Oct|10월/.test(soon), `${locale}: when it opens again (${soon})`);
  assert.ok(done.includes("3"), `${locale}: limit reached`);
  assert.equal(renotifyHint(readRenotifyState({ reason: "replied" }), t, locale), "");
}

console.log("price-inquiry-renotify: ok");
