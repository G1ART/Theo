// Followers get one new_work alert per publish. The label and link follow
// the bundle count, and the migration keeps the first-publish rules.
// The database side runs in supabase/tests/new_work_alert_bundle.sql.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  newWorkCount,
  notificationLabel,
  notificationLink,
} from "../src/components/notifications/notificationLink";
import { messages } from "../src/lib/i18n/messages";
import type { NotificationRow } from "../src/lib/supabase/notifications";

const entitlements = { canSeeBoardSaver: false, canSeeBoardPublicActor: false };

function translator(locale: "ko" | "en") {
  const table = messages[locale] as Record<string, string>;
  const fallback = messages.en as Record<string, string>;
  return (key: string) => table[key] ?? fallback[key] ?? key;
}

function alertRow(
  payload: Record<string, unknown>,
  overrides: Partial<NotificationRow> = {},
): NotificationRow {
  return {
    id: "alert-1",
    user_id: "follower-1",
    type: "new_work",
    actor_id: "artist-1",
    artwork_id: "work-1",
    claim_id: null,
    payload,
    read_at: null,
    created_at: "2026-10-17T21:00:00.000Z",
    actor: {
      username: "heimyunghyun",
      display_name: "현혜명",
      display_name_ko: "현혜명",
      display_name_en: "Heimyung Hyun",
    },
    artwork: {
      id: "work-1",
      title: "바람",
      title_ko: "바람",
      title_en: "Wind",
      artist_id: "artist-1",
    },
    ...overrides,
  };
}

const ko = translator("ko");
const en = translator("en");

for (const key of [
  "notifications.newWorkText",
  "notifications.newWorksText",
  "notifications.newWorkInterestText",
]) {
  assert.ok((messages.en as Record<string, string>)[key], `en ${key}`);
  assert.ok((messages.ko as Record<string, string>)[key], `ko ${key}`);
}

const bundle = alertRow({
  source: "follow",
  artwork_ids: ["work-1", "work-2", "work-3"],
  count: 3,
});
assert.equal(newWorkCount(bundle), 3);
assert.equal(
  notificationLabel(bundle, ko, entitlements, "ko"),
  "현혜명 작가가 새 작품 3점을 올렸어요",
);
assert.equal(
  notificationLabel(bundle, en, entitlements, "en"),
  "Heimyung Hyun posted 3 new works",
);
assert.equal(notificationLink(bundle, entitlements, "follower-1"), "/u/heimyunghyun");
assert.equal(
  notificationLink(alertRow(bundle.payload, { actor: null }), entitlements, "follower-1"),
  "/artwork/work-1",
);

const single = alertRow({ source: "follow", artwork_ids: ["work-1"], count: 1 });
assert.equal(newWorkCount(single), 1);
assert.equal(
  notificationLabel(single, ko, entitlements, "ko"),
  "현혜명 작가가 새 작품 〈바람〉을(를) 올렸어요",
);
assert.equal(
  notificationLabel(single, en, entitlements, "en"),
  "Heimyung Hyun posted a new work “Wind”",
);
assert.equal(notificationLink(single, entitlements, "follower-1"), "/artwork/work-1");

const legacy = alertRow({ source: "follow" });
assert.equal(newWorkCount(legacy), 1);
assert.equal(notificationLink(legacy, entitlements, "follower-1"), "/artwork/work-1");
assert.equal(
  newWorkCount(alertRow({ source: "follow", artwork_ids: ["a", "b"], count: "3" })),
  2,
);
assert.equal(newWorkCount(alertRow({ source: "follow", count: 0 })), 1);

assert.equal(
  notificationLabel(
    alertRow({ source: "interest", interest_type: "medium", interest_value: "oil" }),
    ko,
    entitlements,
    "ko",
  ),
  "관심사(매체)에 맞는 새 작품 〈바람〉이(가) 올라왔어요",
);
assert.equal(
  notificationLabel(
    alertRow({ source: "interest", interest_type: "medium", interest_value: "oil" }),
    en,
    entitlements,
    "en",
  ),
  "New work matching your Medium interest: “Wind”",
);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20261017211500_new_work_alert_on_first_publish.sql"),
  "utf8",
);
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .toLowerCase();

assert.ok((sql.match(/-- == SECTION \d+ ==/g) ?? []).length >= 6, "section banners");
for (const tag of sql.match(/\$[A-Za-z0-9_]*\$/g) ?? []) {
  assert.match(tag, /^\$[a-z]+\$$/, `dollar tag ${tag} must be letters only`);
}
assert.equal(/\bselect\b[^;]*?\binto\s+v_/.test(code), false, "use v_x := (select ...)");
assert.equal(code.includes("notifications_type_check"), false, "type check untouched");

assert.ok(code.includes("add column if not exists first_published_at timestamptz"));
assert.ok(code.includes("disable trigger trg_artworks_updated_at"));
assert.ok(code.includes("enable trigger trg_artworks_updated_at"));
assert.ok(code.includes("set first_published_at = created_at"));
assert.ok(code.includes("before insert or update of visibility, first_published_at on public.artworks"));
assert.ok(code.includes("new.first_published_at := old.first_published_at"));

assert.ok(code.includes("after update of visibility on public.artworks"));
assert.ok(code.includes("when (old.first_published_at is null and new.first_published_at is not null)"));
assert.ok(code.includes("after insert on public.artworks"));
assert.ok(code.includes("when (new.first_published_at is not null)"));
assert.ok(code.includes("after update of artist_id on public.artworks"));
assert.ok(code.includes("after delete on public.artworks"));

assert.ok(code.includes("f.status = 'accepted'"));
assert.ok(code.includes("coalesce(ap.new_work_alerts, true)"));
assert.ok(code.includes("f.follower_id <> p_artist_id"));
assert.ok(code.includes("f.follower_id is distinct from p_uploader_id"));
assert.ok(code.includes("f.follower_id is distinct from auth.uid()"));
assert.ok(code.includes("n.read_at is null"));
assert.ok(code.includes("n.created_at > now() - interval '10 minutes'"));
assert.ok(code.includes("'artwork_ids', v_ids, 'count', 1"));
assert.ok(
  code.includes("revoke all on function public.new_work_alert_add(uuid, uuid, uuid) from public, anon, authenticated"),
);
assert.ok(
  code.includes("revoke all on function public.new_work_alert_remove(uuid, uuid) from public, anon, authenticated"),
);
assert.ok(code.includes("exception when others then"));

const dbCheck = readFileSync(join(root, "supabase/tests/new_work_alert_bundle.sql"), "utf8");
assert.ok(dbCheck.includes("raise exception 'new_work_alert: ok %'"), "db check always rolls back");
assert.ok(dbCheck.includes("@example.invalid"), "db check uses throwaway accounts");

console.log("new-work-alert.test.ts: ok");
