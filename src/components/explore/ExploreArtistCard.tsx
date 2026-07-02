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
  return getArtworkImageUrl(avatarUrl, "avatar");
}

export function ExploreArtistCard({ profile, locked = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT();

  const { primary: name, secondary: handle } = formatIdentityPair(profile, t);
  const roleChips = formatRoleChips(profile, t, { max: 2 });
  const avatarUrl = getAvatarUrl(profile.avatar_url);

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
          <div className="flex h-full w-full items-center justify-center text-4xl font-medium text-zinc-400">
            {(name || "?").charAt(0).toUpperCase()}
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
