// A save or cancel leaves the form out of history and returns to where
// the form was opened. Message alerts open their thread.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { notificationLink } from "../src/components/notifications/notificationLink";
import type { NotificationRow } from "../src/lib/supabase/notifications";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// Profile edit (settings) save: the opener, else the edited account's profile.
const settings = read("src/app/settings/page.tsx");
assert.match(settings, /replaceWithEntry\(\{ router, pathname: "\/settings", fallback: profileHref \}\)/);
assert.equal((settings.match(/leaveSettingsAfterSave\(`\/u\/\$\{profileUsername\}`\)/g) ?? []).length, 2);
assert.equal(settings.includes("router.push(`/u/${profileUsername}`)"), false, "save must not push the profile over settings");
// Delegated edit keeps loading and saving the acting subject.
assert.match(settings, /getProfileById\(actingSubjectRef\.current\)/);
assert.match(settings, /saveActingPublicProfile\(\{/);

// Artwork edit: save, cancel, and back return without stacking the form.
const artworkEdit = read("src/app/artwork/[id]/edit/page.tsx");
assert.match(artworkEdit, /leaveFormTo\(\{ router, pathname, target: detailHref \}\)/);
assert.equal((artworkEdit.match(/\{\.\.\.exitProps\}/g) ?? []).length, 2);
assert.equal(artworkEdit.includes("router.push(`/artwork/${id}`)"), false);

// The request inbox stamps the exhibition it opens too.
const requests = read("src/components/network/AccessRequestsPanel.tsx");
assert.match(requests, /onClick=\{\(\) => stampBackFromHref\(subjectHref\)\}/);

// Message alerts open the thread with the sender; the thread's back is the entry.
const entitlements = { canSeeBoardSaver: false, canSeeBoardPublicActor: false };
function messageRow(overrides: Partial<NotificationRow>): NotificationRow {
  return {
    id: "n1",
    user_id: "me",
    type: "connection_message",
    actor_id: "6f4c2a1e-0000-4000-8000-000000000001",
    artwork_id: null,
    claim_id: null,
    payload: { message_id: "m1", preview: "hi" },
    read_at: null,
    created_at: "2026-10-17T00:00:00Z",
    actor: { username: "heimyunghyun", display_name: "현혜명" },
    ...overrides,
  };
}
assert.equal(notificationLink(messageRow({}), entitlements, "me"), "/my/messages/heimyunghyun");
assert.equal(
  notificationLink(messageRow({ actor: { username: null, display_name: null } }), entitlements, "me"),
  "/my/messages/6f4c2a1e-0000-4000-8000-000000000001",
);
assert.equal(notificationLink(messageRow({ actor: null, actor_id: null }), entitlements, "me"), "/my/messages");
const thread = read("src/app/my/messages/[peer]/page.tsx");
assert.equal((thread.match(/<EntryBackLink\s+fallback="\/my\/messages"/g) ?? []).length, 2);

console.log("save-exit-destination.test.ts: ok");
