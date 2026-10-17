/**
 * Wording and links for alerts sent to people who liked a work
 * (20261017224500_liked_work_alerts.sql). The rows never carry a price.
 */
import type { NotificationRow, NotificationType } from "@/lib/supabase/notifications";
import type { Locale } from "@/lib/i18n/locale";
import { pickLocalizedTitle } from "@/lib/i18n/pickLocalized";

export const LIKED_WORK_ALERT_TYPES = [
  "liked_work_exhibited",
  "liked_work_price_listed",
  "liked_work_sold",
] as const;

export type LikedWorkAlertType = (typeof LIKED_WORK_ALERT_TYPES)[number];

export function isLikedWorkAlert(type: NotificationType): type is LikedWorkAlertType {
  return (LIKED_WORK_ALERT_TYPES as readonly string[]).includes(type);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Works in one `liked_work_exhibited` row; one row per exhibition. */
export function likedExhibitedCount(row: NotificationRow): number {
  const count = row.payload?.count;
  if (typeof count === "number" && Number.isFinite(count) && count >= 1) {
    return Math.floor(count);
  }
  const ids = row.payload?.artwork_ids;
  return Array.isArray(ids) && ids.length > 0 ? ids.length : 1;
}

function exhibitionTitle(row: NotificationRow, locale: Locale): string {
  const p = row.payload ?? {};
  return pickLocalizedTitle(
    {
      title: text(p.exhibition_title),
      title_ko: text(p.exhibition_title_ko),
      title_en: text(p.exhibition_title_en),
    },
    locale,
  ).trim();
}

export function likedWorkAlertLabel(
  row: NotificationRow,
  t: (k: string) => string,
  title: string,
  locale: Locale,
): string {
  switch (row.type) {
    case "liked_work_exhibited": {
      const count = likedExhibitedCount(row);
      const key =
        count > 1 ? "notifications.likedWorksExhibitedText" : "notifications.likedWorkExhibitedText";
      return t(key)
        .replace("{show}", exhibitionTitle(row, locale))
        .replace("{count}", String(count))
        .replace("{title}", title);
    }
    case "liked_work_price_listed":
      return t("notifications.likedWorkPriceListedText").replace("{title}", title);
    case "liked_work_sold":
      return t("notifications.likedWorkSoldText").replace("{title}", title);
    default:
      return "";
  }
}

export function likedWorkAlertLink(row: NotificationRow): string | null {
  if (row.type === "liked_work_exhibited") {
    const id = text(row.payload?.exhibition_id);
    if (id) return `/e/${id}`;
  }
  return row.artwork_id ? `/artwork/${row.artwork_id}` : null;
}
