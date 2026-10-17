// A gallery or curator listing an artist without an account is not
// called the artist in new-work alerts, and a newly published work goes
// to the front of manual orders. The database side runs in
// supabase/tests/new_work_credit_order.sql.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  newWorkListedCount,
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
const ko = translator("ko");
const en = translator("en");

const outsideArtist = {
  id: "ext-1",
  display_name: "김바다",
  display_name_ko: "김바다",
  display_name_en: "Bada Kim",
};

function galleryAlert(payload: Record<string, unknown>): NotificationRow {
  return {
    id: "alert-1",
    user_id: "follower-1",
    type: "new_work",
    actor_id: "gallery-1",
    artwork_id: "work-1",
    claim_id: null,
    payload: { source: "follow", ...payload },
    read_at: null,
    created_at: "2026-10-17T22:00:00.000Z",
    actor: {
      username: "green_gallery",
      display_name: "그린갤러리",
      display_name_ko: "그린갤러리",
      display_name_en: "Green Gallery",
    },
    artwork: {
      id: "work-1",
      title: "파도",
      title_ko: "파도",
      title_en: "Wave",
      artist_id: "gallery-1",
    },
  };
}

for (const key of [
  "notifications.newWorkByArtistText",
  "notifications.newWorksByArtistText",
  "notifications.newWorkFromText",
  "notifications.newWorksFromText",
]) {
  assert.ok((messages.en as Record<string, string>)[key], `en ${key}`);
  assert.ok((messages.ko as Record<string, string>)[key], `ko ${key}`);
  assert.equal((messages.ko as Record<string, string>)[key].includes("{name} 작가"), false, key);
}

const oneKnown = galleryAlert({
  artwork_ids: ["work-1"],
  count: 1,
  listed_ids: ["work-1"],
  external_artist: outsideArtist,
});
assert.equal(newWorkListedCount(oneKnown), 1);
assert.equal(
  notificationLabel(oneKnown, ko, entitlements, "ko"),
  "그린갤러리에 김바다 작가의 새 작품 〈파도〉이(가) 올라왔어요",
);
assert.equal(
  notificationLabel(oneKnown, en, entitlements, "en"),
  "New work by Bada Kim from Green Gallery: “Wave”",
);
assert.equal(notificationLink(oneKnown, entitlements, "follower-1"), "/artwork/work-1");

const manyKnown = galleryAlert({
  artwork_ids: ["work-1", "work-2", "work-3"],
  count: 3,
  listed_ids: ["work-1", "work-2", "work-3"],
  external_artist: outsideArtist,
});
assert.equal(
  notificationLabel(manyKnown, ko, entitlements, "ko"),
  "그린갤러리에 김바다 작가의 새 작품 3점이 올라왔어요",
);
assert.equal(
  notificationLabel(manyKnown, en, entitlements, "en"),
  "3 new works by Bada Kim from Green Gallery",
);
assert.equal(notificationLink(manyKnown, entitlements, "follower-1"), "/u/green_gallery");

const twoArtists = galleryAlert({
  artwork_ids: ["work-1", "work-2"],
  count: 2,
  listed_ids: ["work-1", "work-2"],
  external_artist: null,
});
assert.equal(notificationLabel(twoArtists, ko, entitlements, "ko"), "그린갤러리에 새 작품 2점이 올라왔어요");
assert.equal(notificationLabel(twoArtists, en, entitlements, "en"), "2 new works from Green Gallery");

const mixed = galleryAlert({
  artwork_ids: ["work-1", "work-2", "work-3"],
  count: 3,
  listed_ids: ["work-1"],
  external_artist: outsideArtist,
});
assert.equal(notificationLabel(mixed, ko, entitlements, "ko"), "그린갤러리에 새 작품 3점이 올라왔어요");

const legacyListed = galleryAlert({
  listed_ids: ["work-1"],
  external_artist: { display_name: "김바다", display_name_ko: null, display_name_en: null },
});
assert.equal(
  notificationLabel(legacyListed, en, entitlements, "en"),
  "New work by 김바다 from Green Gallery: “Wave”",
);
const legacyUnknown = galleryAlert({ listed_ids: ["work-1"], external_artist: null });
assert.equal(
  notificationLabel(legacyUnknown, ko, entitlements, "ko"),
  "그린갤러리에 새 작품 〈파도〉이(가) 올라왔어요",
);
assert.equal(
  notificationLabel(legacyUnknown, en, entitlements, "en"),
  "A new work from Green Gallery: “Wave”",
);

const ownWorks = galleryAlert({
  artwork_ids: ["work-1", "work-2"],
  count: 2,
  listed_ids: [],
  external_artist: null,
});
assert.equal(newWorkListedCount(ownWorks), 0);
assert.equal(notificationLabel(ownWorks, ko, entitlements, "ko"), "그린갤러리 작가가 새 작품 2점을 올렸어요");
assert.equal(newWorkListedCount(galleryAlert({})), 0);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20261017215517_new_work_credit_and_order_first.sql"),
  "utf8",
);
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .toLowerCase();

assert.ok((sql.match(/-- == SECTION \d+ ==/g) ?? []).length >= 8, "section banners");
for (const tag of sql.match(/\$[A-Za-z0-9_]*\$/g) ?? []) {
  assert.match(tag, /^\$[a-z]+\$$/, `dollar tag ${tag} must be letters only`);
}
assert.equal(/\bselect\b[^;]*?\binto\s+v_/.test(code), false, "use v_x := (select ...)");
assert.equal(code.includes("notifications_type_check"), false, "type check untouched");

for (const fn of [
  "custom_tabs_put_first(p_tabs jsonb, p_artwork_id text)",
  "artwork_put_first(p_artwork_id uuid)",
  "artwork_order_on_publish()",
  "file_artworks_into_existing_tab(",
  "new_work_alert_sync(p_alert_id uuid)",
  "new_work_alert_add(",
  "new_work_alert_remove(",
  "claims_on_recent_publish()",
]) {
  assert.ok(code.includes(`create or replace function public.${fn}`), fn);
}
for (const fn of [
  "custom_tabs_put_first(jsonb, text)",
  "artwork_put_first(uuid)",
  "new_work_alert_sync(uuid)",
  "new_work_alert_add(uuid, uuid, uuid)",
  "new_work_alert_remove(uuid, uuid)",
]) {
  assert.ok(code.includes(`revoke all on function public.${fn} from public, anon, authenticated`), fn);
}

assert.ok(code.includes("coalesce((select min(o.sort_order) from public.profile_artwork_orders o where o.profile_id = p.id), 0) - 1"));
assert.ok(code.includes("on conflict (profile_id, artwork_id) do nothing"));
assert.ok(code.includes("and a.artist_sort_order is not null"));
assert.ok(code.includes("c.visibility = 'public'"));
assert.ok(code.includes("v_ids := v_front || v_ids || v_back"));
assert.ok(code.includes("a.first_published_at > now() - interval '10 minutes'"));
assert.ok(code.includes("after insert on public.artworks"));
assert.ok(code.includes("after update of visibility, artist_id on public.artworks"));
assert.ok(code.includes("on public.claims"));
assert.ok(code.includes("'listed_ids', v_listed"));
assert.ok(code.includes("'external_artist', coalesce(v_artist, 'null'::jsonb)"));
assert.ok(code.includes("update public.digest_events"));

const dbCheck = readFileSync(join(root, "supabase/tests/new_work_credit_order.sql"), "utf8");
assert.ok(dbCheck.includes("raise exception 'new_work_credit_order: ok"), "db check always rolls back");
assert.ok(dbCheck.includes("@example.invalid"), "db check uses throwaway accounts");

console.log("new-work-credit-order.test.ts: ok");
