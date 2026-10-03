"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { FollowButton } from "@/components/FollowButton";
import { setArtworkBack } from "@/lib/artworkBack";
import { setExhibitionBack } from "@/lib/exhibitionBack";
import { visibleModule } from "@/lib/feed/walk/content";
import { fillTemplate } from "@/lib/feed/walk/fill";
import type {
  FeedModule,
  WalkCopy,
  WalkCredit,
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
  const shown = visibleModule(module);
  if (!shown) return null;
  return (
    <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-4" aria-labelledby={shown.key}>
      <ModuleHeading id={shown.key} titleKey={moduleTitleKey(shown)} reason={shown.reason} />
      {shown.type === "artist_card" && (
        <ArtistCard person={shown.person} works={shown.works} userId={userId} lane={lane} />
      )}
      {shown.type === "artwork_gallery" && <WorkTrio works={shown.works} mode="gallery" />}
      {shown.type === "exhibition_card" && <ExhibitionCard exhibition={shown.exhibition} />}
      {shown.type === "related_network" && <Network people={shown.people} />}
      {(shown.type === "curators_view" || shown.type === "related_artwork") && (
        <WorkTrio works={shown.works} mode="credits" />
      )}
    </section>
  );
}

function ModuleHeading({ id, titleKey, reason }: { id: string; titleKey: string; reason: WalkCopy }) {
  const { t } = useT();
  const reasonText = fillTemplate(t(reason.key), reason.params).trim();
  return (
    <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 id={id} className="shrink-0 text-lg font-medium tracking-tight text-zinc-900">
        {t(titleKey)}
      </h2>
      {reasonText && (
        <p className="min-w-0">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs leading-5 text-zinc-600">
            <PersonGlyph />
            <span className="truncate">{reasonText}</span>
          </span>
        </p>
      )}
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
  const cv = cvLine(person);
  const mutual = mutualBlock(person, t);
  const moreHref = profileHref(person);
  const shown = works.slice(0, 3);
  return (
    <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]">
      <article className="flex min-w-0 flex-col rounded-md border border-zinc-200 p-4">
        <div className="flex items-center gap-3">
          <Avatar person={person} size={56} />
          <div className="min-w-0">
            <PersonName person={person} className="text-base font-semibold" />
            {handleOf(person) && <p className="truncate text-xs text-zinc-500">{handleOf(person)}</p>}
          </div>
        </div>
        <ul className="mt-4 space-y-3 text-sm text-zinc-800">
          {cv && (
            <li className="flex items-start gap-2">
              <DocGlyph />
              <span className="min-w-0">{cv}</span>
            </li>
          )}
          {person.school && (
            <li className="flex items-start gap-2">
              <CapGlyph />
              <span className="min-w-0">{person.school}</span>
            </li>
          )}
          {person.city && (
            <li className="flex items-start gap-2">
              <PinGlyph />
              <span className="min-w-0">{person.city}</span>
            </li>
          )}
        </ul>
        {mutual && (
          <div className="mt-4 flex items-center gap-2">
            <div className="flex -space-x-2">
              {mutual.faces.map((face) => (
                <Face key={face.name} name={face.name} src={face.src} />
              ))}
            </div>
            <p className="min-w-0 text-xs leading-4 text-zinc-600">{mutual.text}</p>
          </div>
        )}
        {userId && userId !== person.id && (
          <div className="mt-4">
            <FollowButton
              targetProfileId={person.id}
              initialFollowing={person.viewerFollows}
              appearance="outline"
              block
              idleLabel={t("feed.walk.connect")}
              surface="feed"
              feedContext={{ tab: lane === "following" ? "following" : "all", position: 0 }}
            />
          </div>
        )}
      </article>
      <div className="flex min-w-0 flex-col">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="truncate text-sm text-zinc-700">
            {fillTemplate(t("feed.walk.worksOf"), { name: person.name })}
          </p>
          {moreHref && (
            <Link href={moreHref} className="shrink-0 text-sm text-zinc-800 hover:underline">
              {t("feed.walk.more")} &gt;
            </Link>
          )}
        </div>
        <div className="mt-auto grid grid-cols-3 gap-3">
          {shown.map((work) => (
            <WorkLink key={work.id} work={work}>
              <SquareImage src={workSrc(work, true)} alt={work.title} sizes="160px" />
            </WorkLink>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkTrio({ works, mode }: { works: WalkWorkView[]; mode: "gallery" | "credits" }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      {works.slice(0, 3).map((work) =>
        mode === "gallery" ? <GalleryTile key={work.id} work={work} /> : <CreditTile key={work.id} work={work} />
      )}
    </div>
  );
}

function GalleryTile({ work }: { work: WalkWorkView }) {
  const caption = [work.title, work.year].filter(Boolean).join(" . ");
  return (
    <WorkLink work={work}>
      <SquareImage src={workSrc(work, false)} alt={work.title || work.artistName} sizes="240px" />
      <div className="mt-2 space-y-0.5 text-sm text-zinc-900">
        {work.artistName && <p className="truncate font-medium">{work.artistName}</p>}
        {caption && <p className="truncate">{caption}</p>}
        {work.medium && <p className="truncate text-zinc-700">{work.medium}</p>}
      </div>
    </WorkLink>
  );
}

function CreditTile({ work }: { work: WalkWorkView }) {
  const { t } = useT();
  const rows = creditRows(work, t);
  return (
    <div className="min-w-0">
      <WorkLink work={work}>
        <SquareImage src={workSrc(work, false)} alt={work.title || work.artistName} sizes="240px" />
      </WorkLink>
      <div className="mt-2 flex items-baseline justify-between gap-2 text-sm text-zinc-900">
        <p className="min-w-0 truncate font-medium">{work.title}</p>
        {work.year && <p className="shrink-0">{work.year}</p>}
      </div>
      {rows.length > 0 && (
        <div className="mt-2 flex gap-1">
          <Brace rows={rows.length} />
          <ul className="min-w-0 flex-1">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center gap-2 py-1">
                <MiniFace name={row.credit.name} src={avatarSrc(row.credit.avatarUrl)} />
                <div className="min-w-0">
                  <CreditName credit={row.credit} />
                  <p className="truncate text-[11px] text-zinc-500">{row.role}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ExhibitionCard({ exhibition }: { exhibition: WalkExhibitionView }) {
  const { t } = useT();
  const src = exhibition.coverPath ? getArtworkImageUrl(exhibition.coverPath, "thumb") : null;
  const start = dotDate(exhibition.startDate);
  const end = dotDate(exhibition.endDate);
  const dates = start && end ? `${start} - ${end}` : start ?? end;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(140px,200px)_minmax(0,1fr)]">
      <Link
        href={`/e/${exhibition.id}`}
        onClick={() => setExhibitionBack()}
        className="block focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300"
      >
        <SquareImage src={src} alt="" sizes="200px" />
      </Link>
      <div className="flex min-w-0 flex-col">
        <Link
          href={`/e/${exhibition.id}`}
          onClick={() => setExhibitionBack()}
          className="text-base font-medium leading-snug text-zinc-900 hover:underline sm:text-lg"
        >
          {exhibition.title}
        </Link>
        <div className="mt-3 space-y-2">
          {exhibition.curator && (
            <CreditPill label={t("role.curator")} credit={exhibition.curator} />
          )}
          {exhibition.gallery && (
            <CreditPill label={t("feed.walk.role.gallery")} credit={exhibition.gallery} />
          )}
        </div>
        <div className="mt-auto flex items-end justify-between gap-3 pt-6">
          <Link
            href={`/e/${exhibition.id}`}
            onClick={() => setExhibitionBack()}
            className="text-sm text-zinc-800 hover:underline"
          >
            {t("feed.walk.viewMore")} &gt;
          </Link>
          {dates && <p className="text-sm tabular-nums text-zinc-800">{dates}</p>}
        </div>
      </div>
    </div>
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
          <div className="flex flex-col items-center text-center">
            <Avatar person={person} size={72} />
            <p className="mt-3 w-full truncate text-sm font-semibold text-zinc-900">{person.name}</p>
            {handleOf(person) && <p className="w-full truncate text-xs text-zinc-500">{handleOf(person)}</p>}
            {role && (
              <span className="mt-3 rounded-sm border border-zinc-300 px-3 py-1 text-xs text-zinc-800">{role}</span>
            )}
          </div>
        );
        return (
          <li key={person.id} className="min-w-0 rounded-md border border-zinc-200 px-3 py-5">
            {href ? (
              <Link href={href} className="block focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CreditPill({ label, credit }: { label: string; credit: WalkCredit }) {
  const href = creditHref(credit);
  const pill = (
    <span className="inline-flex max-w-full truncate rounded-full bg-zinc-100 px-2.5 py-0.5 text-sm text-zinc-800">
      {credit.name}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-zinc-800">
      <span className="shrink-0">{label}</span>
      {href ? (
        <Link href={href} className="min-w-0 hover:underline">
          {pill}
        </Link>
      ) : (
        pill
      )}
    </div>
  );
}

function WorkLink({ work, children }: { work: WalkWorkView; children: ReactNode }) {
  return (
    <Link
      href={`/artwork/${work.id}`}
      onClick={() => setArtworkBack()}
      className="block min-w-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300"
    >
      {children}
    </Link>
  );
}

function SquareImage({ src, alt, sizes }: { src: string | null; alt: string; sizes: string }) {
  return (
    <div className="relative aspect-square overflow-hidden bg-zinc-200">
      {src ? <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" /> : null}
    </div>
  );
}

function PersonName({ person, className }: { person: WalkPersonView; className: string }) {
  const href = profileHref(person);
  if (!href) return <p className={`truncate text-zinc-900 ${className}`}>{person.name}</p>;
  return (
    <Link href={href} className={`block truncate text-zinc-900 hover:underline ${className}`}>
      {person.name}
    </Link>
  );
}

function CreditName({ credit }: { credit: WalkCredit }) {
  const href = creditHref(credit);
  if (!href) return <p className="truncate text-sm font-medium text-zinc-900">{credit.name}</p>;
  return (
    <Link href={href} className="block truncate text-sm font-medium text-zinc-900 hover:underline">
      {credit.name}
    </Link>
  );
}

function Avatar({ person, size }: { person: WalkPersonView; size: number }) {
  const src = avatarSrc(person.avatarUrl);
  return (
    <div
      className="shrink-0 overflow-hidden rounded-full bg-zinc-200"
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image src={src} alt="" width={size} height={size} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm font-medium text-zinc-500">
          {person.name.slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  );
}

function Face({ name, src }: { name: string; src: string | null }) {
  const resolved = avatarSrc(src);
  return (
    <div className="h-6 w-6 overflow-hidden rounded-full border border-white bg-zinc-200">
      {resolved ? (
        <Image src={resolved} alt="" width={24} height={24} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  );
}

function MiniFace({ name, src }: { name: string; src: string | null }) {
  return (
    <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-zinc-200">
      {src ? (
        <Image src={src} alt="" width={28} height={28} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  );
}

function Brace({ rows }: { rows: number }) {
  const height = Math.max(rows * 40, 48);
  return (
    <svg width="12" height={height} viewBox={`0 0 12 ${height}`} aria-hidden className="shrink-0 text-zinc-300">
      <path
        d={`M9 2 H 3 V ${height - 2} H 9`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function moduleTitleKey(module: FeedModule): string {
  switch (module.type) {
    case "artwork_gallery":
      return "feed.walk.module.gallery";
    case "exhibition_card":
      return "feed.walk.module.exhibition";
    case "related_network":
      return "feed.walk.module.network";
    case "related_artwork":
      return "feed.walk.module.related";
    case "curators_view":
      return "feed.walk.module.curator";
    case "artist_card":
      return artistHighlight(module.key) ? "feed.walk.module.artistHighlight" : "feed.walk.module.artist";
  }
}

function artistHighlight(key: string): boolean {
  const [scenario, slot] = key.split(":");
  if (slot === "engaged" || slot === "interested") return true;
  return scenario === "local" && slot === "artist";
}

function PersonGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0 text-zinc-500">
      <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="7" cy="5.2" r="1.6" fill="currentColor" />
      <path d="M3.8 11.2c.6-1.6 1.8-2.3 3.2-2.3s2.6.7 3.2 2.3" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function DocGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="mt-0.5 shrink-0 text-zinc-700">
      <path d="M4 2.5h5.2L12 5.2V13.5H4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 2.6V5.4H11.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CapGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="mt-0.5 shrink-0 text-zinc-700">
      <path d="M2 7 L8 4.2 14 7 8 9.8z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 8.2v2.4c0 .8 1.4 1.8 3 1.8s3-1 3-1.8V8.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function PinGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="mt-0.5 shrink-0 text-zinc-700">
      <path d="M8 14s4.2-3.6 4.2-6.4A4.2 4.2 0 0 0 8 3.4a4.2 4.2 0 0 0-4.2 4.2C3.8 10.4 8 14 8 14z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="7.6" r="1.2" fill="currentColor" />
    </svg>
  );
}

function creditRows(
  work: WalkWorkView,
  t: (key: string) => string
): { key: string; credit: WalkCredit; role: string }[] {
  const rows: { key: string; credit: WalkCredit; role: string }[] = [];
  if (work.artistName) {
    rows.push({
      key: "artist",
      credit: {
        id: work.artistId,
        name: work.artistName,
        username: work.artistUsername,
        avatarUrl: work.artistAvatarUrl,
      },
      role: t("role.artist"),
    });
  }
  if (work.curator) rows.push({ key: "curator", credit: work.curator, role: t("feed.walk.credit.curated") });
  if (work.gallery) rows.push({ key: "gallery", credit: work.gallery, role: t("feed.walk.credit.gallery") });
  return rows;
}

function cvLine(person: WalkPersonView): string | null {
  if (!person.oneLine) return null;
  if (person.school && person.oneLine === person.school) return null;
  if (person.school && person.oneLine.endsWith(person.school)) {
    const program = person.oneLine.slice(0, -person.school.length).replace(/,\s*$/, "").trim();
    return program || null;
  }
  return person.oneLine;
}

function mutualBlock(
  person: WalkPersonView,
  t: (key: string) => string
): { text: string; faces: { name: string; src: string | null }[] } | null {
  const names = person.mutualNames;
  if (!names || names.length === 0) return null;
  const avatars = person.mutualAvatars ?? [];
  const text =
    names.length === 1
      ? fillTemplate(t("feed.walk.mutualOne"), { name: names[0]! })
      : fillTemplate(t("feed.walk.mutualCount"), { name: names[0]!, n: String(names.length - 1) });
  return {
    text,
    faces: names.slice(0, 3).map((name, index) => ({ name, src: avatars[index] ?? null })),
  };
}

function profileHref(person: WalkPersonView): string | null {
  if (!person.username || !hasPublicLinkableUsername({ username: person.username })) return null;
  return `/u/${person.username}`;
}

function creditHref(credit: WalkCredit): string | null {
  if (!credit.username || !hasPublicLinkableUsername({ username: credit.username })) return null;
  return `/u/${credit.username}`;
}

function handleOf(person: WalkPersonView): string | null {
  if (!person.username || !hasPublicLinkableUsername({ username: person.username })) return null;
  return `@${person.username}`;
}

function workSrc(work: WalkWorkView, compact: boolean): string | null {
  if (!work.imagePath) return null;
  return getArtworkImageUrl(work.imagePath, compact ? "thumb" : "thumb");
}

function avatarSrc(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return getArtworkImageUrl(url, "avatar");
}

function dotDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function roleLabel(role: WalkRole, t: (key: string) => string): string | null {
  if (role === "gallery") return t("feed.walk.role.gallery");
  if (role === "artist" || role === "curator" || role === "collector") {
    const label = t(`role.${role}`);
    return label === `role.${role}` ? null : label;
  }
  return null;
}
