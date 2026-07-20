"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setArtworkBack } from "@/lib/artworkBack";
import {
  getArtworkImageUrl,
  getPrimaryClaim,
  type ArtworkWithLikes,
} from "@/lib/supabase/artworks";
import { CroppedArtworkImage } from "@/components/artwork/CroppedArtworkImage";
import { readDisplayAdjust } from "@/lib/image/displayAdjust";
import { useT } from "@/lib/i18n/useT";
import {
  formatDisplayName,
  formatIdentityPair,
  hasPublicLinkableUsername,
} from "@/lib/identity/format";
import {
  formatSizeForLocale,
  parseSizeWithUnit,
  type SizeUnitPref,
} from "@/lib/size/format";
import { useSizeUnitPref } from "@/lib/size/preference";

/**
 * Explore-grid artwork card (wireframe redesign).
 *
 * Layout per wireframe (`메인랜딩페이지` / `전시게시물보기뷰`):
 *   - Image (aspect 4:5-ish rectangle) with @Artist overlay (bottom-left)
 *     and Date overlay (bottom-right).
 *   - Meta line below: `Title, size medium`.
 *
 * When `locked=true`, the artist/meta info is blurred (identity concealed
 * for anonymous viewers) and clicks route to /onboarding?next=<artwork>
 * (signup-first) instead of the artwork detail. The image itself stays sharp
 * because the grid needs to remain browsable — the point is to hide *who made
 * what* until the visitor signs up, matching the product decision that a cold
 * visitor tapping a detail should be sent straight to signup.
 */
type Props = {
  artwork: ArtworkWithLikes;
  /**
   * When true the card is a public teaser: artist name / meta blurred,
   * click routes to /onboarding?next=<artwork> (signup-first). Also disables
   * outbound artwork links behind the overlays.
   */
  locked?: boolean;
  priority?: boolean;
};

function pickYear(a: ArtworkWithLikes): string | null {
  if (a.year != null) {
    const s = String(a.year).trim();
    if (s) return s;
  }
  if (a.created_at) {
    const d = new Date(a.created_at);
    if (!Number.isNaN(d.getTime())) return String(d.getUTCFullYear());
  }
  return null;
}

function extractSizePill(
  size: string | null | undefined,
  sizeUnit: "cm" | "in" | null | undefined,
  locale: string,
  pref: SizeUnitPref
): string | null {
  if (!size || !size.trim()) return null;
  const parsed = parseSizeWithUnit(size);
  const inputHasUnit = parsed?.unit != null;
  if (!inputHasUnit && (sizeUnit == null || sizeUnit === undefined)) return null;
  const formatted = formatSizeForLocale(size, locale, sizeUnit ?? null, pref);
  if (!formatted) return null;
  const stripped = formatted
    .replace(/^(?:약\s+|~)?\d+\s*[FPMSfpms]\s*·\s*/, "")
    .trim();
  return /\b(?:cm|in)\b/i.test(stripped) ? stripped : null;
}

export function ExploreArtworkCard({ artwork, locked = false, priority = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, locale } = useT();
  const sizePref = useSizeUnitPref();

  const images = artwork.artwork_images ?? [];
  const sorted = [...images].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  const first = sorted[0];
  const imageUrl = first ? getArtworkImageUrl(first.storage_path, "medium") : null;

  const artistProfile = (artwork as { profiles?: {
    id?: string;
    username?: string | null;
    display_name?: string | null;
    main_role?: string | null;
    roles?: string[] | null;
  } | null }).profiles ?? null;
  const primaryClaim = getPrimaryClaim(artwork);
  const externalName = primaryClaim
    ? ((artwork.claims ?? []).find(
        (c) =>
          (c as { external_artists?: { display_name?: string | null } })
            .external_artists?.display_name
      ) as { external_artists?: { display_name?: string | null } } | undefined)
        ?.external_artists?.display_name ?? null
    : null;

  const identity = externalName
    ? { display_name: externalName, username: null }
    : artistProfile;
  const { primary: displayName } = formatIdentityPair(identity, t);
  const artistUsername = hasPublicLinkableUsername(artistProfile)
    ? artistProfile?.username ?? ""
    : "";
  const artistHandle = artistUsername
    ? `@${artistUsername}`
    : displayName || formatDisplayName(identity, t) || "";

  const year = pickYear(artwork);
  const sizePill = extractSizePill(
    artwork.size,
    artwork.size_unit ?? null,
    locale,
    sizePref
  );
  const captionParts = [artwork.title ?? "", sizePill].filter(Boolean);
  const caption = captionParts.join(", ");

  const signupHref = `/onboarding?next=${encodeURIComponent(`/artwork/${artwork.id}`)}`;

  function handleClick(e: React.MouseEvent) {
    if (locked) {
      e.preventDefault();
      router.push(signupHref);
      return;
    }
    setArtworkBack(pathname ?? "/feed");
    router.push(`/artwork/${artwork.id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick(e as unknown as React.MouseEvent);
    }
  }

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={artwork.title ?? undefined}
      className="group flex h-full cursor-pointer flex-col focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    >
      {/* Framing policy (2026-07-20): grid surfaces NEVER crop the
          artwork. Portrait / landscape / square all fit inside the
          frame via `object-contain`, and the per-image gentle crop
          from `display_adjust.crop` (when the uploader has trimmed
          excess background whitespace) will land here later via
          `CroppedArtworkImage`. Cover mode cropped works arbitrarily
          and misrepresented the piece — the compositional integrity
          of the work is a Theo trust boundary. */}
      <div className="relative w-full overflow-hidden bg-zinc-100">
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          {imageUrl ? (
            <CroppedArtworkImage
              src={imageUrl}
              alt={artwork.title ?? ""}
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 45vw, 380px"
              loading={priority ? "eager" : "lazy"}
              priority={priority}
              adjust={readDisplayAdjust(first?.display_adjust)}
              imgClassName="transition-transform duration-300 ease-out group-hover:scale-[1.01]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400" />
          )}

          {/* @Artist overlay (bottom-left). Blurred for anon viewers. */}
          <span
            className={`pointer-events-none absolute bottom-2 left-2 max-w-[65%] truncate rounded-sm bg-white/85 px-1.5 py-0.5 text-[11px] font-medium text-zinc-800 shadow-sm backdrop-blur-sm ${
              locked ? "select-none blur-sm" : ""
            }`}
            aria-hidden={locked || undefined}
          >
            {artistHandle || "\u00A0"}
          </span>

          {/* Date overlay (bottom-right). */}
          {year && (
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-sm bg-white/85 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 shadow-sm backdrop-blur-sm">
              {year}
            </span>
          )}

          {/* Anon lock hint appears on hover for public visitors. */}
          {locked && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-8 opacity-0 transition-opacity group-hover:opacity-100">
              <Link
                href={signupHref}
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-auto rounded-full bg-zinc-900/90 px-3 py-1.5 text-xs font-medium text-white shadow-md hover:bg-zinc-900"
              >
                {t("feed.anonLockCta")}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* `Title, size medium` — one truncated line below the image. */}
      <p
        className={`mt-2 truncate text-xs tracking-tight text-zinc-700 ${
          locked ? "select-none blur-sm" : ""
        }`}
      >
        {caption || (artwork.title ?? "")}
      </p>
    </article>
  );
}
