// Alerts to people who liked a work: SQL contract (source text, like
// liked-works-sql-contract.test.ts) and the wording / links.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { messages } from "../src/lib/i18n/messages";
import {
  LIKED_WORK_ALERT_TYPES,
  isLikedWorkAlert,
  likedExhibitedCount,
  likedWorkAlertLabel,
  likedWorkAlertLink,
} from "../src/lib/likes/likedWorkAlerts";
import { notificationLabel, notificationLink } from "../src/components/notifications/notificationLink";
import type { NotificationRow } from "../src/lib/supabase/notifications";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const strip = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const raw = read("supabase/migrations/20261017224500_liked_work_alerts.sql");
const sql = strip(raw);

// 1. The type check keeps every type that was live on 2026-10-17.
const LIVE_TYPES = [
  "like", "follow", "claim_request", "claim_confirmed", "claim_rejected",
  "price_inquiry", "price_inquiry_reply", "new_work", "connection_message",
  "board_save", "board_public", "delegation_invite_received", "delegation_accepted",
  "delegation_declined", "delegation_revoked", "follow_request", "follow_request_accepted",
  "delegation_invite_canceled", "delegation_resigned", "delegation_permissions_updated",
  "delegation_permission_change_requested", "delegation_permission_change_dismissed",
  "orphan_external_claimed",
];
const check = sql.slice(sql.indexOf("add constraint notifications_type_check"), sql.indexOf("]::text[])"));
const listed = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
for (const type of LIVE_TYPES) assert.ok(listed.includes(type), `keeps ${type}`);
for (const type of LIKED_WORK_ALERT_TYPES) assert.ok(listed.includes(type), `adds ${type}`);
assert.equal(listed.length, LIVE_TYPES.length + LIKED_WORK_ALERT_TYPES.length);

// 2. Editor-safe SQL: sections, letters-only dollar tags, no client access.
assert.equal((raw.match(/^-- == SECTION \d+ ==/gm) ?? []).length, 4);
for (const tag of sql.match(/\$[A-Za-z0-9_]*\$/g) ?? []) assert.match(tag, /^\$[A-Za-z]+\$$/);
for (const fn of [
  "artwork_viewer_fields_as(uuid, uuid)",
  "notify_likers_on_state_event()",
  "notify_likers_on_exhibition_link()",
]) {
  assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated`), fn);
}
assert.ok(!/grant execute on function public\.(artwork_viewer_fields_as|notify_likers)/.test(sql));

// 3. No price ever goes into an alert.
const state = sql.slice(
  sql.indexOf("create or replace function public.notify_likers_on_state_event"),
  sql.indexOf("create trigger trg_notify_likers_on_state_event"),
);
const show = sql.slice(sql.indexOf("create or replace function public.notify_likers_on_exhibition_link"));
for (const body of [state, show]) {
  assert.ok(!/price_input_amount|price_usd|price_input_currency|fx_rate/.test(body), "no amount in alerts");
}
assert.ok(/values \(v_liker, v_type, v_aw\.artist_id, v_aw\.id, '\{\}'::jsonb\)/.test(state));

// 4. Price listed only reaches likers who can see the price now.
assert.ok(/v_fields := public\.artwork_viewer_fields_as\(v_liker, v_aw\.id\)/.test(state));
assert.ok(/coalesce\(v_fields->>'pricing_mode', ''\) <> 'fixed'/.test(state));
assert.ok(/coalesce\(v_fields->>'is_price_public', ''\) <> 'true'/.test(state));
assert.ok(/v_type = 'liked_work_price_listed' and coalesce\(v_aw\.ownership_status::text, ''\) <> 'available'/.test(state));

// 5. Never to the artist, the uploader or whoever made the change.
for (const body of [state, show]) {
  assert.ok(/l\.user_id <> v_aw\.artist_id/.test(body));
  assert.ok(/l\.user_id is distinct from v_aw\.created_by/.test(body));
  assert.ok(/l\.user_id is distinct from v_actor/.test(body));
  assert.ok(/coalesce\(v_aw\.visibility::text, ''\) <> 'public'/.test(body), "public works only");
}

// 6. One exhibition alert per person per show.
assert.ok(/n\.payload->>'exhibition_id' = v_show\.id::text/.test(show));
assert.ok(/n\.read_at is null/.test(show));
assert.ok(/interval '6 hours'/.test(show));
assert.ok(/not \(coalesce\(n\.payload->'artwork_ids', '\[\]'::jsonb\) \? v_aw\.id::text\)/.test(show));
assert.ok(/v_phase not in \('ongoing', 'upcoming'\)/.test(show));
assert.ok(/public\.is_artist_publicly_visible\(v_show\.host_profile_id\)/.test(show));
assert.ok(/after insert on public\.exhibition_works/.test(sql));
assert.ok(/after insert on public\.artwork_state_events/.test(sql));

// 7. The judging helper puts the caller back.
const as = sql.slice(
  sql.indexOf("create or replace function public.artwork_viewer_fields_as"),
  sql.indexOf("-- == SECTION 3 =="),
);
assert.equal((as.match(/set_config\('request\.jwt\.claims', coalesce\(v_claims, ''\), true\)/g) ?? []).length, 2);

// 8. Wording and links.
const tFor = (locale: "en" | "ko") => (key: string) => {
  const table = messages[locale] as Record<string, string>;
  return table[key] ?? key;
};
const row = (over: Partial<NotificationRow>): NotificationRow => ({
  id: "n1",
  user_id: "u1",
  type: "liked_work_sold",
  actor_id: "artist",
  artwork_id: "w1",
  claim_id: null,
  payload: {},
  read_at: null,
  created_at: "2026-10-17T00:00:00Z",
  actor: { username: "artist", display_name: "Artist" },
  artwork: { id: "w1", title: "Blue", title_ko: "파랑", title_en: "Blue", artist_id: "artist" },
  ...over,
});
const ent = { canSeeBoardSaver: false, canSeeBoardPublicActor: false };

for (const type of LIKED_WORK_ALERT_TYPES) {
  for (const locale of ["en", "ko"] as const) {
    const key = type === "liked_work_exhibited" ? "notifications.likedWorkExhibitedText" : null;
    const label = notificationLabel(
      row({ type, payload: { exhibition_id: "e1", exhibition_title: "Show", count: 1 } }),
      tFor(locale),
      ent,
      locale,
    );
    assert.ok(label.length > 0, `${type} ${locale} has a label`);
    assert.ok(!label.includes("{"), `${type} ${locale} fills every slot`);
    assert.ok(!/[₩$]|\d{2,}|KRW|USD/.test(label), `${type} ${locale} has no price`);
    if (key) assert.ok(label.includes("Show"));
  }
  assert.ok(isLikedWorkAlert(type));
}
assert.ok(!isLikedWorkAlert("new_work"));

const bundled = row({
  type: "liked_work_exhibited",
  payload: {
    exhibition_id: "e1",
    exhibition_title: "Show",
    exhibition_title_ko: "전시",
    artwork_ids: ["w1", "w2", "w3"],
    count: 3,
  },
});
assert.equal(likedExhibitedCount(bundled), 3);
assert.equal(likedExhibitedCount(row({ type: "liked_work_exhibited", payload: { artwork_ids: ["a", "b"] } })), 2);
assert.equal(likedExhibitedCount(row({ type: "liked_work_exhibited" })), 1);
assert.ok(likedWorkAlertLabel(bundled, tFor("ko"), "파랑", "ko").includes("3점"));
assert.ok(likedWorkAlertLabel(bundled, tFor("ko"), "파랑", "ko").includes("전시"));
assert.ok(likedWorkAlertLabel(bundled, tFor("en"), "Blue", "en").includes("3"));

assert.equal(likedWorkAlertLink(bundled), "/e/e1");
assert.equal(notificationLink(bundled, ent, "u1"), "/e/e1");
assert.equal(notificationLink(row({ type: "liked_work_sold" }), ent, "u1"), "/artwork/w1");
assert.equal(notificationLink(row({ type: "liked_work_price_listed" }), ent, "u1"), "/artwork/w1");
assert.equal(likedWorkAlertLink(row({ type: "liked_work_exhibited", payload: {} })), "/artwork/w1");

// 9. One switch (on by default) turns all three off, and the latest
//    trigger definitions read it.
const switchSql = strip(read("supabase/migrations/20261017230007_liked_work_alerts_switch.sql"));
assert.ok(/add column if not exists liked_work_alerts boolean not null default true/.test(switchSql));
const migrationFiles = readdirSync(path.join(ROOT, "supabase/migrations"))
  .filter((name) => /^\d{14}_.*\.sql$/.test(name))
  .sort();
function latestBody(fn: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of migrationFiles) {
    const text = strip(read(`supabase/migrations/${file}`));
    const start = text.indexOf(`create or replace function public.${fn}(`);
    if (start < 0) continue;
    const rest = text.slice(start);
    const tag = /\bas\s+(\$[A-Za-z]*\$)/.exec(rest)?.[1];
    assert.ok(tag, `${file}: ${fn} has a dollar-quoted body`);
    const open = rest.indexOf(tag);
    found = { file, body: rest.slice(open, rest.indexOf(tag, open + tag.length)) };
  }
  assert.ok(found, `${fn} is defined`);
  return found;
}
for (const fn of ["notify_likers_on_state_event", "notify_likers_on_exhibition_link"]) {
  const { file, body } = latestBody(fn);
  assert.ok(/ap\.user_id = l\.user_id and ap\.liked_work_alerts = false/.test(body), `${file}: ${fn} skips switched-off likers`);
  assert.ok(/l\.user_id is distinct from v_actor/.test(body), `${file}: ${fn} still skips the actor`);
}
assert.ok(read("src/lib/supabase/alerts.ts").includes("liked_work_alerts?: boolean"));
const alertsPage = read("src/app/my/alerts/page.tsx");
assert.ok(alertsPage.includes("liked_work_alerts: !(prefs?.liked_work_alerts ?? true)"), "toggle defaults to on");
for (const locale of ["en", "ko"] as const) {
  for (const key of ["alerts.likedWork.title", "alerts.likedWork.hint", "alerts.likedWork.enable"]) {
    assert.ok((messages[locale] as Record<string, string>)[key], `${locale}: ${key}`);
    assert.ok(alertsPage.includes(`t("${key}")`), `page shows ${key}`);
  }
}

console.log("liked-work-alerts: ok");
