// 대표님 요청 (2026-10-17):
//   1) The likes entry sits under "Edit profile", as tall and padded as that
//      button, showing only a lock icon (no label, count or "only you" text),
//      only for the login on its own profile. The list is called
//      "Works I liked" / "내가 좋아한 작품들", which is also its accessible name.
//   2) Every contact button about a work says "Inquire" / "문의하기"; the
//      follow relation shows next to the artist's name instead.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { followRelation } from "../src/lib/follow/relation";
import { messages } from "../src/lib/i18n/messages";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const ko = messages.ko as Record<string, string>;
const en = messages.en as Record<string, string>;

// 1. Copy.
assert.equal(ko["inquiry.cta"], "문의하기");
assert.equal(en["inquiry.cta"], "Inquire");
assert.equal(ko["likes.title"], "내가 좋아한 작품들");
assert.equal(en["likes.title"], "Works I liked");
assert.equal(ko["likes.backLabel"], ko["likes.title"]);
assert.equal(en["likes.backLabel"], en["likes.title"]);
assert.ok(ko["likes.toast"].includes("내가 좋아한 작품들") && en["likes.toast"].includes("Works I liked"));
assert.ok(ko["likes.empty.title"].includes("내가 좋아한 작품") && ko["likes.loadFailed"].includes("내가 좋아한 작품들"));
assert.ok(en["likes.loadFailed"].includes("Works I liked"));
for (const [key, value] of Object.entries(ko)) {
  assert.ok(!value.includes("좋아요한 작품"), `${key}: the list is "내가 좋아한 작품"`);
}
for (const locale of [ko, en]) {
  for (const removed of ["likes.cta.ask", "likes.cta.askAbout", "priceInquiry.ask", "visibility.gate.cta.askAboutWork", "room.askAboutWork", "likes.onlyMe"]) {
    assert.equal(locale[removed], undefined, `${removed} is replaced by one label`);
  }
  for (const kind of ["mutual", "following", "followsYou"]) assert.ok(locale[`follow.relation.${kind}`], kind);
  assert.ok(locale["likes.cta.continue"] && locale["likes.cta.reply"], "state labels stay");
}
assert.equal(ko["follow.relation.mutual"], "맞팔로우");

// 2. One relation rule (accepted follows both ways).
assert.equal(followRelation(true, true), "mutual");
assert.equal(followRelation(true, false), "following");
assert.equal(followRelation(false, true), "followsYou");
assert.equal(followRelation(false, false), null);
const follows = read("src/lib/supabase/follows.ts");
const relations = follows.slice(follows.indexOf("export async function getFollowRelations"));
assert.equal((relations.match(/\.eq\("status", "accepted"\)/g) ?? []).length >= 2, true, "both directions count accepted follows only");

// 3. Every contact button uses the one label; the relation chip sits by the name.
const card = read("src/components/likes/LikedArtworkCard.tsx");
assert.ok(card.includes('cta.kind === "ask" ? t("inquiry.cta")'));
assert.ok(card.includes("<FollowRelationChip relation={relation}"));
assert.ok(card.includes("getCardGateCopy("), "the gate line under a hidden price stays");
const detail = read("src/app/artwork/[id]/page.tsx");
assert.ok(detail.includes('{t("inquiry.cta")}') && detail.includes("<FollowRelationChip"));
assert.ok(/headerProfileId === artwork\.artist_id && viewerRelationship/.test(detail), "relation only for the owner whose rules gate the work");
assert.ok(detail.includes("onFollowed={() => void refreshPassport()}"));
const gate = read("src/components/visibility/GatedField.tsx");
assert.equal((gate.match(/t\("inquiry\.cta"\)/g) ?? []).length, 2);
assert.ok(read("src/app/room/[token]/page.tsx").includes('{t("inquiry.cta")}'));
const panel = read("src/components/likes/LikedWorksPanel.tsx");
assert.ok(/relationProfileId: ownerShown \? artwork\.artist_id : null/.test(panel), "external or credited names get no chip");
assert.ok(panel.includes("getFollowRelations("));

// 4. Where the inquiry opens is unchanged: the detail form via ?ask=1.
const view = read("src/lib/likes/likedWorksView.ts");
assert.ok(view.includes('return { kind: "ask", href: `${detail}?ask=1` };'));
assert.ok(!view.includes("askAbout"));

// 5. The likes entry: under "Edit profile", same height and padding, lock icon only, own profile only.
const profile = read("src/components/UserProfileContent.tsx");
const editAt = profile.indexOf('{t("profile.editProfile")}');
const entryAt = profile.indexOf("aria-label={t(\"likes.title\")}");
const tabsAt = profile.indexOf('data-profile-freeze="tabs"');
assert.ok(editAt > 0 && entryAt > editAt && entryAt < tabsAt, "entry comes right after Edit profile, before the tab row");
const entry = profile.slice(profile.lastIndexOf("{showLikesTab ? (", entryAt), profile.indexOf("</button>", entryAt));
assert.ok(entry.includes('title={t("likes.title")}'));
assert.ok(entry.includes("rounded-full border") && entry.includes("px-4 py-1.5 text-xs font-medium"), "Edit profile's size");
assert.ok(entry.includes("<svg aria-hidden"), "lock icon");
assert.ok(/<span className="inline-flex h-4 items-center justify-center">\s+<svg aria-hidden/.test(entry), "icon centred in a text-xs-tall box");
const body = entry.slice(entry.indexOf(">", entry.indexOf("className={`inline-flex shrink-0")) + 1);
assert.ok(!/\{t\(/.test(body), "no visible text in the entry");
assert.ok(!entry.includes("likesCount") && !profile.includes('t("likes.onlyMe")'), "no count, no only-you text");
assert.equal(ko["likes.tab"], undefined, "the visible label is gone");
assert.equal(en["likes.tab"], undefined, "the visible label is gone");
assert.ok(/const showLikesTab = isOwner && viewerId != null && viewerId === profile\.id;/.test(profile), "hidden from visitors and acting-as");
assert.ok(!profile.slice(tabsAt, profile.indexOf("</div>", profile.indexOf("<ProfileTabManager", tabsAt) + 1)).includes("openLikes"), "not in the tab row");

console.log("likes-entry-and-inquiry-cta: ok");
