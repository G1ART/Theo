"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArtworkSizeCapsule } from "@/components/artwork/ArtworkSizeCapsule";
import { ArtworkArtistName } from "@/components/artwork/ArtworkArtistName";
import { CroppedArtworkImage } from "@/components/artwork/CroppedArtworkImage";
import { setArtworkBack } from "@/lib/artworkBack";
import { formatIdentityPair, formatUsername } from "@/lib/identity/format";
import { readDisplayAdjust } from "@/lib/image/displayAdjust";
import { pickLocalizedArtworkTitle } from "@/lib/i18n/pickLocalized";
import { useT } from "@/lib/i18n/useT";
import { searchArtworkHrefs } from "@/lib/search/artworkQuery";
import { formatArtworkSizeOverlay } from "@/lib/size/format";
import { useSizeUnitPref } from "@/lib/size/preference";
import {
  getArtworkImageUrl,
  getExternalArtistClaim,
  type ArtworkWithLikes,
} from "@/lib/supabase/artworks";
import { claimedOnboardedArtist, personUnderArtworkTitle } from "@/lib/upload/artworkOwner";

type Props = {
  artwork: ArtworkWithLikes;
};

export function SearchArtworkCard({ artwork }: Props) {
  const router = useRouter();
  const { t, locale } = useT();
  const sizePref = useSizeUnitPref();
  const images = [...(artwork.artwork_images ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const first = images[0];
  const imageUrl = first ? getArtworkImageUrl(first.storage_path, "thumb") : null;
  const stored = artwork.profiles ?? null;
  const credited =
    personUnderArtworkTitle({
      storedArtist: stored,
      uploaderId: artwork.created_by ?? null,
      claimedArtist: claimedOnboardedArtist(artwork.claims, artwork.created_by ?? null),
    }) ?? stored;
  const externalClaim = getExternalArtistClaim(artwork);
  const isExternal = !!externalClaim;
  const externalRow = (externalClaim?.external_artists ?? null) as {
    display_name?: string | null;
    display_name_ko?: string | null;
    display_name_en?: string | null;
  } | null;
  const identity = isExternal
    ? {
        display_name: externalRow?.display_name ?? null,
        display_name_ko: externalRow?.display_name_ko ?? null,
        display_name_en: externalRow?.display_name_en ?? null,
        username: null,
      }
    : credited;
  const { primary: artistName } = formatIdentityPair(identity, t, locale);
  const artistUsername = isExternal ? "" : (credited?.username ?? "");
  const hrefs = searchArtworkHrefs({
    artworkId: artwork.id,
    artistUsername,
    artistIsExternal: isExternal,
  });
  const handle = isExternal ? "" : formatUsername(credited);
  const title = pickLocalizedArtworkTitle(artwork, locale);
  const sizeLabel = formatArtworkSizeOverlay(artwork.size, locale, artwork.size_unit ?? null, sizePref);

  function openArtwork() {
    setArtworkBack();
    router.push(hrefs.artworkHref);
  }

  return (
    <article className="flex h-full flex-col">
      <button
        type="button"
        onClick={openArtwork}
        className="group flex min-w-0 flex-1 flex-col text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300"
      >
        <div className="relative aspect-square w-full overflow-hidden bg-zinc-100">
          {imageUrl ? (
            <CroppedArtworkImage
              src={imageUrl}
              alt={title || ""}
              sizes="(max-width: 640px) 50vw, 320px"
              adjust={readDisplayAdjust(first?.display_adjust)}
              imgClassName="transition-transform duration-300 ease-out group-hover:scale-[1.01]"
            />
          ) : null}
          <ArtworkSizeCapsule label={sizeLabel} />
        </div>
        <h3 className="mt-2 truncate text-sm text-zinc-900">{title}</h3>
        {artwork.year ? <p className="truncate text-xs text-zinc-500">{artwork.year}</p> : null}
      </button>
      <div className="mt-1 flex min-w-0 items-baseline gap-2 text-sm" data-artist-profile={hrefs.artistHref ?? ""}>
        <ArtworkArtistName
          name={artistName}
          isExternal={isExternal}
          artistUsername={artistUsername}
          uploader={stored}
          stopPropagation
          className="truncate font-medium text-zinc-900 hover:underline"
        />
        {hrefs.artistHref && handle && handle !== artistName ? (
          <Link
            href={hrefs.artistHref}
            onClick={(event) => event.stopPropagation()}
            className="truncate text-xs text-zinc-500 hover:underline"
          >
            {handle}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
