"use client";

import Image from "next/image";
import Link from "next/link";
import { FollowButton } from "@/components/FollowButton";
import { Chip } from "@/components/ds";
import { setArtworkBack } from "@/lib/artworkBack";
import { setExhibitionBack } from "@/lib/exhibitionBack";
import { fillTemplate } from "@/lib/feed/walk/fill";
import type {
  FeedModule,
  WalkCopy,
  WalkExhibitionView,
  WalkPersonView,
  WalkRole,
  WalkWorkView,
} from "@/lib/feed/walk/types";
import { hasPublicLinkableUsername } from "@/lib/identity/format";
import { useT } from "@/lib/i18n/useT";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";

type Props = {
  module: FeedModule;
  userId: string | null;
  lane: "personalized" | "public" | "following";
};

export function WalkModuleView({ module, userId, lane }: Props) {
  return (
    <section className="mb-12" aria-labelledby={module.key}>
      <ModuleHeading id={module.key} title={module.title} reason={module.reason} />
      {module.type === "artist_card" && (
        <ArtistCard person={module.person} works={module.works} userId={userId} lane={lane} />
      )}
      {module.type === "artwork_gallery" && <WorkTrio works={module.works} mode="meta" />}
      {module.type === "exhibition_card" && <ExhibitionCard exhibition={module.exhibition} />}
      {module.type === "related_network" && <Network people={module.people} />}
      {(module.type === "curators_view" || module.type === "related_artwork") && (
        <WorkTrio works={module.works} mode="credits" />
      )}
    </section>
  );
}

function ModuleHeading({ id, title, reason }: { id: string; title: WalkCopy; reason: WalkCopy }) {
  const { t } = useT();
  return (
    <header className="mb-4">
      <h2 id={id} className="text-base font-semibold tracking-tight text-zinc-900">
        {fillTemplate(t(title.key), title.params)}
      </h2>
      <p className="mt-2">
        <span className="inline-block max-w-full rounded-full bg-zinc-100 px-2.5 py-1 text-xs leading-5 text-zinc-600">
          {fillTemplate(t(reason.key), reason.params)}
        </span>
      </p>
    </header>
  );
}

function ArtistCard({
  person,
  works,
  userId,
  lane,
}: {
  person: WalkPersonView;
  works: WalkWorkView[];
  userId: string | null;
  lane: Props["lane"];
}) {
  const { t } = useT();
  const mutual = mutualLine(person.mutualNames, t);
  const role = roleLabel(person.role, t);
  return (
    <article className="grid grid-cols-1 gap-4 rounded-2xl border border-zinc-200 bg-white p-4 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-start gap-3">
          <Avatar person={person} />
          <div className="min-w-0">
            <PersonName person={person} />
            {person.username && hasPublicLinkableUsername({ username: person.username }) && (
              <p className="truncate text-xs text-zinc-500">@{person.username}</p>
            )}
            {role && (
              <div className="mt-1">
                <Chip size="xs">{role}</Chip>
              </div>
            )}
          </div>
        </div>
        {person.oneLine && <p className="text-sm text-zinc-700">{person.oneLine}</p>}
        {person.school && <p className="text-xs text-zinc-500">{person.school}</p>}
        {person.city && <p className="text-xs text-zinc-500">{person.city}</p>}
        {mutual && <p className="text-xs text-zinc-500">{mutual}</p>}
        {userId && userId !== person.id && (
          <div className="mt-auto pt-1">
            <FollowButton
              targetProfileId={person.id}
              initialFollowing={person.viewerFollows}
              size="sm"
              surface="feed"
              feedContext={{ tab: lane === "following" ? "following" : "all", position: 0 }}
            />
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {works.slice(0, 3).map((work) => (
          <WorkTile key={work.id} work={work} mode="meta" compact />
        ))}
      </div>
    </article>
  );
}

function WorkTrio({ works, mode }: { works: WalkWorkView[]; mode: "meta" | "credits" }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {works.slice(0, 3).map((work) => (
        <WorkTile key={work.id} work={work} mode={mode} />
      ))}
    </div>
  );
}

function WorkTile({
  work,
  mode,
  compact = false,
}: {
  work: WalkWorkView;
  mode: "meta" | "credits";
  compact?: boolean;
}) {
  const src = work.imagePath ? getArtworkImageUrl(work.imagePath, compact ? "thumb" : "medium") : null;
  const meta = [work.year, work.medium].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/artwork/${work.id}`}
      onClick={() => setArtworkBack()}
      className="group block min-w-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-zinc-100">
        {src ? (
          <Image
            src={src}
            alt={work.title}
            fill
            sizes={compact ? "120px" : "(max-width: 768px) 30vw, 240px"}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.01]"
          />
        ) : null}
      </div>
      <p className="mt-2 truncate text-xs text-zinc-500">{work.artistName}</p>
      <p className={`truncate text-zinc-900 ${compact ? "text-xs" : "text-sm"}`}>{work.title}</p>
      {mode === "meta" && meta && <p className="truncate text-xs text-zinc-500">{meta}</p>}
      {mode === "credits" && (
        <>
          {work.curatorName && <p className="truncate text-[11px] text-zinc-500">{work.curatorName}</p>}
          {work.galleryName && <p className="truncate text-[11px] text-zinc-500">{work.galleryName}</p>}
        </>
      )}
    </Link>
  );
}

function ExhibitionCard({ exhibition }: { exhibition: WalkExhibitionView }) {
  const { t } = useT();
  const src = exhibition.coverPath ? getArtworkImageUrl(exhibition.coverPath, "medium") : null;
  const dates =
    exhibition.startDate && exhibition.endDate
      ? `${exhibition.startDate} – ${exhibition.endDate}`
      : exhibition.startDate ?? exhibition.endDate;
  return (
    <Link
      href={`/e/${exhibition.id}`}
      onClick={() => setExhibitionBack()}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-zinc-200 bg-white p-4 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 sm:grid-cols-[minmax(0,220px)_1fr]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-zinc-100">
        {src ? (
          <Image src={src} alt="" fill sizes="220px" className="object-cover" />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2">
        <h3 className="truncate text-base font-semibold text-zinc-900">{exhibition.title}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {exhibition.curatorName && (
            <span className="inline-flex items-center gap-1.5">
              <Chip size="xs">{t("role.curator")}</Chip>
              <span className="truncate text-sm text-zinc-800">{exhibition.curatorName}</span>
            </span>
          )}
          {exhibition.galleryName && (
            <span className="inline-flex items-center gap-1.5">
              <Chip size="xs">{t("feed.walk.role.gallery")}</Chip>
              <span className="truncate text-sm text-zinc-800">{exhibition.galleryName}</span>
            </span>
          )}
        </div>
        {dates && <p className="text-xs text-zinc-500">{dates}</p>}
      </div>
    </Link>
  );
}

function Network({ people }: { people: WalkPersonView[] }) {
  const { t } = useT();
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {people.slice(0, 4).map((person) => {
        const role = roleLabel(person.role, t);
        const href = profileHref(person);
        const inner = (
          <>
            <Avatar person={person} />
            <p className="mt-2 truncate text-sm font-medium text-zinc-900">{person.name}</p>
            {role && (
              <div className="mt-1">
                <Chip size="xs">{role}</Chip>
              </div>
            )}
          </>
        );
        return (
          <li key={person.id} className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-3">
            {href ? (
              <Link href={href} className="block min-w-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300">
                {inner}
              </Link>
            ) : (
              <div className="min-w-0">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PersonName({ person }: { person: WalkPersonView }) {
  const href = profileHref(person);
  if (!href) return <p className="truncate text-sm font-semibold text-zinc-900">{person.name}</p>;
  return (
    <Link href={href} className="block truncate text-sm font-semibold text-zinc-900 hover:underline">
      {person.name}
    </Link>
  );
}

function Avatar({ person }: { person: WalkPersonView }) {
  const src = avatarSrc(person.avatarUrl);
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-zinc-100">
      {src ? (
        <Image src={src} alt="" width={48} height={48} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm font-medium text-zinc-500">
          {person.name.slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  );
}

function profileHref(person: WalkPersonView): string | null {
  if (!person.username || !hasPublicLinkableUsername({ username: person.username })) return null;
  return `/u/${person.username}`;
}

function avatarSrc(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return getArtworkImageUrl(url, "avatar");
}

function roleLabel(role: WalkRole, t: (key: string) => string): string | null {
  if (role === "gallery") return t("feed.walk.role.gallery");
  if (role === "artist" || role === "curator" || role === "collector") {
    const label = t(`role.${role}`);
    return label === `role.${role}` ? null : label;
  }
  return null;
}

function mutualLine(names: string[] | null, t: (key: string) => string): string | null {
  if (!names || names.length === 0) return null;
  if (names.length <= 2) {
    return fillTemplate(t("feed.walk.mutual"), { names: names.join(", ") });
  }
  return fillTemplate(t("feed.walk.mutualMore"), {
    names: names.slice(0, 2).join(", "),
    n: String(names.length - 2),
  });
}
