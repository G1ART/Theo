"use client";

import Image from "next/image";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import {
  formatIdentityPair,
  formatRoleChips,
  type IdentityInput,
} from "@/lib/identity/format";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { Chip } from "@/components/ds/Chip";

type Props = {
  profile: IdentityInput & {
    avatar_url?: string | null;
    is_public?: boolean | null;
    profile_completeness?: number | null;
  };
  completeness?: number | null;
  publicHref?: string | null;
  /**
   * Social graph counts surfaced inline in the hero. When `null` or absent,
   * the social row is hidden. Both values are rendered as clickable Links
   * into `/my/followers` and `/my/following` respectively — per Brief 2
   * these are profile-native, not dashboard-secondary.
   */
  followersCount?: number | null;
  followingCount?: number | null;
  /**
   * If > 0, a small dot badge is rendered on the Delegations action button
   * to surface inbound invites awaiting user response. We deliberately
   * avoid numeric badges here — the count lives inside the hub.
   */
  pendingInboundDelegations?: number | null;
  /**
   * Sprint 6.2 — Network Hub entry point.
   * Sum of `pending_access_request_count + open_inquiry_count` across the
   * principal's relationships. When > 0, a small dot badge is rendered
   * on the Network action button. Same calm philosophy as
   * `pendingInboundDelegations`: dot only, no numerals — the breakdown
   * lives inside the Network hub itself.
   */
  pendingNetworkActivityCount?: number | null;
};

function avatarUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.startsWith("http")) return v;
  return getArtworkImageUrl(v, "avatar");
}

/**
 * Studio Hero (Track 3.1 / 3.2)
 *
 * Top of /my. Shows the authenticated artist as if it were their public
 * profile card, with edit + preview-public affordances. Provides the
 * completeness bar that drives the Next Actions priority.
 */
export function StudioHero({
  profile,
  completeness,
  publicHref,
  followersCount,
  followingCount,
  pendingInboundDelegations,
  pendingNetworkActivityCount,
}: Props) {
  const { t } = useT();
  const identity = formatIdentityPair(profile);
  const roleChips = formatRoleChips(profile, t, { max: 3 });
  const avatar = avatarUrl(profile.avatar_url);
  const pct = Math.max(0, Math.min(100, Math.round(completeness ?? 0)));
  const isPublic = profile.is_public !== false;

  return (
    <section className="h-full rounded-2xl border border-zinc-200 bg-white p-6">
      <div className="flex items-start gap-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-zinc-200">
          {avatar ? (
            <Image
              src={avatar}
              alt=""
              width={64}
              height={64}
              className="h-full w-full object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl font-medium text-zinc-500">
              {identity.primary.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-zinc-900">
              {identity.primary}
            </h2>
            {identity.secondary && (
              <span className="text-sm text-zinc-500">{identity.secondary}</span>
            )}
            <Chip tone={isPublic ? "success" : "neutral"}>
              {isPublic ? t("studio.hero.public") : t("studio.hero.private")}
            </Chip>
          </div>
          {roleChips.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1">
              {roleChips.map((chip) => (
                <Chip key={chip.key} tone={chip.isPrimary ? "accent" : "neutral"}>
                  {chip.label}
                  {chip.isPrimary && (
                    <span className="ml-1 opacity-70">· {t("role.primarySuffix")}</span>
                  )}
                </Chip>
              ))}
            </p>
          )}
          {(followersCount != null || followingCount != null) && (
            <div className="mt-2 flex items-center gap-3 text-sm">
              <Link
                href="/my/network?tab=followers"
                className="group inline-flex items-baseline gap-1 text-zinc-500 transition-colors hover:text-zinc-900"
              >
                <span className="font-semibold text-zinc-900 tabular-nums group-hover:underline">
                  {followersCount ?? 0}
                </span>
                <span className="text-xs">{t("studio.hero.followers")}</span>
              </Link>
              <span aria-hidden className="text-zinc-300">
                ·
              </span>
              <Link
                href="/my/network?tab=following"
                className="group inline-flex items-baseline gap-1 text-zinc-500 transition-colors hover:text-zinc-900"
              >
                <span className="font-semibold text-zinc-900 tabular-nums group-hover:underline">
                  {followingCount ?? 0}
                </span>
                <span className="text-xs">{t("studio.hero.following")}</span>
              </Link>
            </div>
          )}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>{t("studio.hero.completeness")}</span>
              <span className="font-medium text-zinc-700">{pct}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-zinc-900 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/settings"
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t("studio.hero.editProfile")}
            </Link>
            {publicHref && (
              <Link
                href={publicHref}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {t("studio.hero.previewPublic")}
              </Link>
            )}
            <Link
              href="/my/delegations"
              data-tour="studio-delegations"
              aria-label={
                (pendingInboundDelegations ?? 0) > 0
                  ? `${t("studio.hero.delegations")} · ${t("studio.hero.delegationsPendingDot")}`
                  : t("studio.hero.delegations")
              }
              className="relative rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t("studio.hero.delegations")}
              {(pendingInboundDelegations ?? 0) > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 inline-block h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white"
                />
              )}
            </Link>
            {/* Sprint 6.2 — Network Hub hot-link. Same calm outline tone
                as Delegations / Visibility; tour anchor (studio-network)
                wires a dedicated step in the studio tour explaining what
                "네트워크" rolls up. The dot mirrors the delegations pill:
                strictly a presence signal, no numerals. */}
            <Link
              href="/my/network"
              data-tour="studio-network"
              aria-label={
                (pendingNetworkActivityCount ?? 0) > 0
                  ? `${t("studio.hero.network")} · ${t("studio.hero.networkPendingDot")}`
                  : `${t("studio.hero.network")} — ${t("studio.hero.networkHint")}`
              }
              title={t("studio.hero.networkHint")}
              className="relative rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t("studio.hero.network")}
              {(pendingNetworkActivityCount ?? 0) > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 inline-block h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white"
                />
              )}
            </Link>
            {/* Sprint 5 — hot-link to the visibility hub. Same outline tone
                as siblings so the row stays calm; tour anchor wires the
                "Choose who sees what" step in the studio tour. */}
            <Link
              href="/my/visibility"
              data-tour="studio-visibility-hub"
              aria-label={`${t("studio.hero.visibility")} — ${t(
                "studio.hero.visibilityHint"
              )}`}
              title={t("studio.hero.visibilityHint")}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t("studio.hero.visibility")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
