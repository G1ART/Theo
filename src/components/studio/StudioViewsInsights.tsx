"use client";

import Link from "next/link";
import Image from "next/image";
import { useT } from "@/lib/i18n/useT";
import {
  formatDisplayName,
  formatUsername,
} from "@/lib/identity/format";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import type { ProfileViewerRow } from "@/lib/supabase/profileViews";
import { SectionFrame } from "@/components/ds/SectionFrame";
import { SectionTitle } from "@/components/ds/SectionTitle";

type Props = {
  count: number | null;
  canViewViewers: boolean;
  viewers: ProfileViewerRow[];
  /** If true (acting-as mode) the upsell/settings link is suppressed. */
  suppressActions?: boolean;
};

function avatarSrc(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.startsWith("http")) return v;
  return getArtworkImageUrl(v, "avatar");
}

/**
 * Condensed insights strip for `/my`. Shows the 7-day count and, when the
 * viewer list is unlocked, up to 3 recent viewers. The full list lives under
 * `/settings` (so we never duplicate the long roster inside Studio overview).
 */
export function StudioViewsInsights({
  count,
  canViewViewers,
  viewers,
  suppressActions,
}: Props) {
  const { t, locale } = useT();
  const preview = viewers.slice(0, 3);
  const primary = count === null ? t("studio.views.loading") : String(count);
  return (
    <SectionFrame>
      <SectionTitle eyebrow={t("studio.views.title")} size="sm">
        <span className="text-xl font-semibold text-zinc-900">{primary}</span>
      </SectionTitle>

      {canViewViewers ? (
        preview.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <ul className="flex -space-x-2">
              {preview.map((row) => {
                const src = avatarSrc(row.viewer_profile?.avatar_url);
                const name = formatDisplayName(row.viewer_profile, t, locale);
                return (
                  <li key={row.id} className="h-8 w-8 overflow-hidden rounded-full border-2 border-white bg-zinc-200">
                    <Link
                      href={row.viewer_profile?.username ? `/u/${row.viewer_profile.username}` : "#"}
                      title={name}
                      className="block h-full w-full"
                    >
                      {src ? (
                        <Image
                          src={src}
                          alt=""
                          width={32}
                          height={32}
                          className="h-full w-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-xs font-medium text-zinc-500">
                          {name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-zinc-500">
              {formatDisplayName(preview[0]?.viewer_profile, t, locale)}
              {preview[0]?.viewer_profile?.username && (
                <span className="ml-1 text-zinc-400">{formatUsername(preview[0].viewer_profile)}</span>
              )}
              {preview.length > 1 && (
                <span className="ml-1 text-zinc-400">·</span>
              )}
              {preview.length > 1 && (
                <span className="ml-1">+{viewers.length - 1}</span>
              )}
            </p>
            {!suppressActions && (
              <Link
                href="/settings"
                className="ml-auto text-xs font-medium text-zinc-600 hover:text-zinc-900"
              >
                {t("studio.views.seeAll")} →
              </Link>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">{t("insights.noViewsYet")}</p>
        )
      ) : !suppressActions ? (
        <Link
          href="/settings"
          className="inline-block rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          {t("studio.views.upgrade")}
        </Link>
      ) : null}
    </SectionFrame>
  );
}
