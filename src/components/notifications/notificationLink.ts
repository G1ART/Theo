/**
 * Notification label + deep-link helpers, extracted from
 * `src/app/notifications/page.tsx` on 2026-08-03 so both the full
 * `/notifications` page AND the new sidebar `NotificationsDrawer` can
 * share one source of truth for how each notification is worded and
 * which surface it should route to.
 *
 * These are pure functions of `NotificationRow` + entitlement flags +
 * viewerId — no side effects, no i18n locale drift (they defer all
 * string rendering to the `t()` passed in). Behaviour is identical to
 * the pre-refactor page-local versions; the only change is the
 * import site.
 */
import type { NotificationRow } from "@/lib/supabase/notifications";
import { formatDisplayName } from "@/lib/identity/format";
import type { Locale } from "@/lib/i18n/locale";
import {
  pickLocalizedArtworkTitle,
  pickLocalizedDisplayName,
} from "@/lib/i18n/pickLocalized";

export type NotificationEntitlements = {
  canSeeBoardSaver: boolean;
  canSeeBoardPublicActor: boolean;
};

/**
 * Works announced by one `new_work` row. Rows written before the
 * first-publish bundle (2026-10-17) have no count and are one work.
 */
export function newWorkCount(row: NotificationRow): number {
  const count = row.payload?.count;
  if (typeof count === "number" && Number.isFinite(count) && count >= 1) {
    return Math.floor(count);
  }
  const ids = row.payload?.artwork_ids;
  if (Array.isArray(ids) && ids.length > 0) return ids.length;
  return 1;
}

/**
 * Works in a `new_work` row that the actor listed for an artist without
 * an account, so the actor is not their artist. Rows without the field
 * have none.
 */
export function newWorkListedCount(row: NotificationRow): number {
  const ids = row.payload?.listed_ids;
  return Array.isArray(ids) ? ids.length : 0;
}

function newWorkExternalArtistName(row: NotificationRow, locale: Locale): string {
  const artist = row.payload?.external_artist;
  if (!artist || typeof artist !== "object") return "";
  const field = (value: unknown) => (typeof value === "string" ? value : null);
  const a = artist as Record<string, unknown>;
  return pickLocalizedDisplayName(
    {
      display_name: field(a.display_name),
      display_name_ko: field(a.display_name_ko),
      display_name_en: field(a.display_name_en),
    },
    locale,
  ).trim();
}

export function notificationLabel(
  row: NotificationRow,
  t: (k: string) => string,
  entitlements: NotificationEntitlements,
  locale?: Locale,
): string {
  const name = formatDisplayName(row.actor, t, locale);
  const title =
    (row.artwork
      ? pickLocalizedArtworkTitle(row.artwork, locale ?? "en")
      : "") || row.artwork?.title || "Untitled";
  switch (row.type) {
    case "like":
      return t("notifications.likeText").replace("{name}", name).replace("{title}", title);
    case "follow":
      return t("notifications.followText").replace("{name}", name);
    case "claim_request":
      return t("notifications.claimRequestText").replace("{name}", name).replace("{title}", title);
    case "claim_confirmed":
      return t("notifications.claimConfirmedText").replace("{name}", name).replace("{title}", title);
    case "claim_rejected":
      return t("notifications.claimRejectedText").replace("{name}", name).replace("{title}", title);
    case "price_inquiry":
      return t("notifications.priceInquiryText").replace("{name}", name).replace("{title}", title);
    case "price_inquiry_reply":
      return t("notifications.priceInquiryReplyText").replace("{name}", name).replace("{title}", title);
    case "new_work": {
      if (row.payload?.source === "interest") {
        const interestType = String(row.payload.interest_type ?? "");
        const interestKey = `alerts.interests.type.${interestType}`;
        const interest = t(interestKey);
        return t("notifications.newWorkInterestText")
          .replace("{interest}", interest === interestKey ? interestType : interest)
          .replace("{title}", title);
      }
      const count = newWorkCount(row);
      if (newWorkListedCount(row) > 0) {
        const artist =
          newWorkListedCount(row) === count ? newWorkExternalArtistName(row, locale ?? "en") : "";
        const many = count > 1;
        const key = artist
          ? (many ? "notifications.newWorksByArtistText" : "notifications.newWorkByArtistText")
          : (many ? "notifications.newWorksFromText" : "notifications.newWorkFromText");
        return t(key)
          .replace("{name}", name)
          .replace("{artist}", artist)
          .replace("{count}", String(count))
          .replace("{title}", title);
      }
      if (count > 1) {
        return t("notifications.newWorksText")
          .replace("{name}", name)
          .replace("{count}", String(count));
      }
      return t("notifications.newWorkText").replace("{name}", name).replace("{title}", title);
    }
    case "connection_message":
      return t("notifications.connectionMessageText").replace("{name}", name);
    case "board_save": {
      const key = entitlements.canSeeBoardSaver
        ? "notifications.boardSaveTextPaid"
        : "notifications.boardSaveText";
      return t(key).replace("{name}", name).replace("{title}", title);
    }
    case "board_public": {
      const shortlistTitle = (row.payload?.shortlist_title as string | undefined) ?? "";
      const key = entitlements.canSeeBoardPublicActor
        ? "notifications.boardPublicTextPaid"
        : "notifications.boardPublicText";
      return t(key)
        .replace("{name}", name)
        .replace("{shortlistTitle}", shortlistTitle)
        .replace("{title}", title);
    }
    case "delegation_invite_received": {
      const scope = row.payload?.scope_type as string | undefined;
      const projectTitle = (row.payload?.project_title as string | undefined) ?? "";
      const key =
        scope === "project"
          ? "notifications.delegationInviteReceivedProjectText"
          : "notifications.delegationInviteReceivedText";
      return t(key).replace("{name}", name).replace("{title}", projectTitle);
    }
    case "delegation_accepted":
      return t("notifications.delegationAcceptedText").replace("{name}", name);
    case "delegation_declined":
      return t("notifications.delegationDeclinedText").replace("{name}", name);
    case "delegation_revoked":
      return t("notifications.delegationRevokedText").replace("{name}", name);
    case "delegation_invite_canceled":
      return t("notifications.delegationInviteCanceledText").replace("{name}", name);
    case "delegation_resigned":
      return t("notifications.delegationResignedText").replace("{name}", name);
    case "delegation_permissions_updated": {
      const added = Array.isArray(row.payload?.added) ? (row.payload?.added as string[]) : [];
      const removed = Array.isArray(row.payload?.removed) ? (row.payload?.removed as string[]) : [];
      if (added.length > 0 && removed.length === 0) {
        return t("notifications.delegationPermissionsUpdatedAddedOnlyText")
          .replace("{name}", name)
          .replace("{count}", String(added.length));
      }
      if (removed.length > 0 && added.length === 0) {
        return t("notifications.delegationPermissionsUpdatedRemovedOnlyText")
          .replace("{name}", name)
          .replace("{count}", String(removed.length));
      }
      return t("notifications.delegationPermissionsUpdatedText").replace("{name}", name);
    }
    case "delegation_permission_change_requested":
      return t("notifications.delegationPermissionChangeRequestedText").replace("{name}", name);
    case "delegation_permission_change_dismissed":
      return t("notifications.delegationPermissionChangeDismissedText").replace("{name}", name);
    case "follow_request":
      return t("notifications.followRequest.body").replace("{name}", name);
    case "follow_request_accepted":
      return t("notifications.followRequestAccepted.body").replace("{name}", name);
    default:
      return "";
  }
}

export function notificationLink(
  row: NotificationRow,
  entitlements: NotificationEntitlements,
  viewerId: string | null
): string | null {
  // Price-inquiry notifications fan out to several roles, and only the
  // artwork's ARTIST has a working aggregate inbox at /my/inquiries.
  // Everyone else — consignment delegates, OWNS holders, and the inquirer
  // on a reply — sees and acts on the thread from the artwork page. Route
  // accordingly so no role dead-ends on an empty inbox.
  if (row.type === "price_inquiry" || row.type === "price_inquiry_reply") {
    const artistId = row.artwork?.artist_id ?? null;
    if (viewerId && artistId && viewerId === artistId) return "/my/inquiries";
    if (row.artwork_id) return `/artwork/${row.artwork_id}`;
    return row.type === "price_inquiry_reply" ? "/my/inquiries/sent" : "/my/inquiries";
  }
  if (row.type === "connection_message") {
    // A thread is one pair, keyed by the other person like the inbox
    // rows (handle, else id). No sender on the row: the inbox.
    const peer = row.actor?.username?.trim() || row.actor_id;
    return peer ? `/my/messages/${encodeURIComponent(peer)}` : "/my/messages";
  }
  if (
    (row.type === "follow" || row.type === "follow_request_accepted") &&
    row.actor_id
  ) {
    const u = row.actor?.username;
    return u ? `/u/${u}` : null;
  }
  if (row.type === "board_public") {
    // Paid: deep-link to the shareable room. Free: keep them on their own
    // artwork page — the upgrade prompt is the curiosity gap.
    if (entitlements.canSeeBoardPublicActor) {
      const token = row.payload?.share_token as string | undefined;
      if (token) return `/room/${token}`;
    }
    if (row.artwork_id) return `/artwork/${row.artwork_id}`;
    return null;
  }
  if (row.type === "board_save") {
    if (row.artwork_id) return `/artwork/${row.artwork_id}`;
    return null;
  }
  if (
    row.type === "delegation_invite_received" ||
    row.type === "delegation_accepted" ||
    row.type === "delegation_declined" ||
    row.type === "delegation_revoked" ||
    row.type === "delegation_invite_canceled" ||
    row.type === "delegation_resigned" ||
    row.type === "delegation_permissions_updated" ||
    row.type === "delegation_permission_change_requested" ||
    row.type === "delegation_permission_change_dismissed"
  ) {
    const delegationId = row.payload?.delegation_id as string | undefined;
    if (
      row.type === "delegation_permission_change_requested" &&
      delegationId
    ) {
      return `/my/delegations?openId=${delegationId}&action=update`;
    }
    return "/my/delegations";
  }
  if (row.type === "new_work" && newWorkCount(row) > 1) {
    const u = row.actor?.username;
    if (u) return `/u/${u}`;
  }
  if (row.artwork_id) return `/artwork/${row.artwork_id}`;
  return null;
}
