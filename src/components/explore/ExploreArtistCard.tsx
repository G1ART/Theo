"use client";

import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { useT } from "@/lib/i18n/useT";
import { formatIdentityPair, formatRoleChips } from "@/lib/identity/format";
import type { ProfileListItem } from "@/lib/supabase/profiles";
import { Chip } from "@/components/ds";

type Props = {
  profile: ProfileListItem;
  /**
   * When true, the identity handle + role chips are blurred and the click
   * routes to /login. Avatar/silhouette stays visible so the grid still
   * reads as a wall of people (matches the wireframe intent of encouraging
   * sign-up without hiding the volume of activity).
   */
  locked?: boolean;
};

function getAvatarUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith("http")) return avatarUrl;
  // The Artists grid renders avatars in a large 4:3 tile, so the tiny 96px
  // "avatar" variant looked badly upscaled. Use "medium" (1200px) for a crisp
  // fill; external (http) avatars are already full-res.
  return getArtworkImageUrl(avatarUrl, "medium");
}

/** Deterministic hue (0–359) from a seed so each person gets a stable color. */
function hueFromSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  return h;
}

/** First 1–2 display initials, ignoring leading "@" and whitespace. */
function initialsFrom(name: string): string {
  const cleaned = name.replace(/^@+/, "").trim();
  if (!cleaned) return "?";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

export function ExploreArtistCard({ profile, locked = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT();

  const { primary: name, secondary: handle } = formatIdentityPair(profile, t);
  const roleChips = formatRoleChips(profile, t, { max: 2 });
  const avatarUrl = getAvatarUrl(profile.avatar_url);
  const hue = hueFromSeed(profile.id || profile.username || name || "?");
  const initials = initialsFrom(name);

  function handleClick() {
    if (locked || !profile.username) {
      router.push(`/login?next=${encodeURIComponent(pathname ?? "/feed")}`);
      return;
    }
    router.push(`/u/${profile.username}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={name}
      className="group flex h-full cursor-pointer flex-col focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-100">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 45vw, 380px"
            loading="lazy"
            className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.01]"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-full w-full items-center justify-center"
            style={{
              backgroundImage: `linear-gradient(135deg, hsl(${hue} 58% 90%), hsl(${(hue + 45) % 360} 52% 80%))`,
            }}
          >
            <span
              className="text-5xl font-semibold tracking-tight transition-transform duration-300 ease-out group-hover:scale-[1.03]"
              style={{ color: `hsl(${hue} 42% 34%)` }}
            >
              {initials}
            </span>
          </div>
        )}
      </div>
      <div className={`mt-2 flex min-w-0 flex-col gap-0.5 ${locked ? "select-none blur-sm" : ""}`}>
        <p className="truncate text-sm font-medium tracking-tight text-zinc-900">{name}</p>
        {handle && (
          <p className="truncate text-xs text-zinc-500">{handle}</p>
        )}
        {roleChips.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {roleChips.map((c) => (
              <Chip key={c.key} tone={c.isPrimary ? "accent" : "neutral"} size="xs">
                {c.label}
              </Chip>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
