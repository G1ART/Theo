import { notFound } from "next/navigation";
import {
  lookupPublicProfileByUsername,
  type ProfilePublic,
} from "@/lib/supabase/profiles";
import {
  listPublicArtworksByArtistId,
  listPublicArtworksListedByProfileId,
  getProfileArtworkOrders,
  applyProfileOrdering,
} from "@/lib/supabase/artworks";
import {
  listExhibitionsForProfile,
  getProfileExhibitionOrders,
  type ExhibitionWithCredits,
} from "@/lib/supabase/exhibitions";
import { UserProfileContent } from "@/components/UserProfileContent";
import { PrivateProfileShell } from "./PrivateProfileShell";

type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ mode?: string; tab?: string | string[] }>;
};

export default async function ProfilePage({ params, searchParams }: Props) {
  const { username: paramUsername } = await params;
  const sp = await searchParams;
  const mode = typeof sp.mode === "string" ? sp.mode : Array.isArray(sp.mode) ? sp.mode[0] : undefined;
  const rawTab = sp.tab;
  const tabParam =
    typeof rawTab === "string" ? rawTab : Array.isArray(rawTab) ? rawTab[0] : undefined;

  const {
    data: profile,
    privateCard,
    isPrivate,
    notFound: profileNotFound,
    error,
  } = await lookupPublicProfileByUsername(paramUsername);

  if (error || profileNotFound) {
    notFound();
  }

  let p: ProfilePublic;

  if (isPrivate) {
    // Private account v2 (PR1):
    //   - The shell now receives a `privateCard` slice (avatar / display_name
    //     / main_role / roles / bio + viewer_follow_status) so we can render
    //     a real profile card with a Follow / Requested button instead of
    //     the legacy dead-end notice.
    //   - The owner-preview branch (PrivateProfileShell loads `getMyProfileAsPublic`
    //     and falls into UserProfileContent) is preserved unchanged.
    return (
      <PrivateProfileShell
        paramUsername={paramUsername}
        initialReorderMode={mode === "reorder"}
        initialTabParam={tabParam ?? null}
        privateCard={privateCard}
      />
    );
  } else if (!profile) {
    notFound();
  } else {
    p = profile as ProfilePublic;
  }

  const [
    { data: artworksAsArtist },
    { data: artworksAsLister },
    { data: exhibitions },
  ] = await Promise.all([
    listPublicArtworksByArtistId(p.id, { limit: null }),
    listPublicArtworksListedByProfileId(p.id, { limit: null }),
    listExhibitionsForProfile(p.id),
  ]);

  const seen = new Set<string>();
  const artworks: Awaited<ReturnType<typeof listPublicArtworksByArtistId>>["data"] = [];
  for (const a of artworksAsArtist ?? []) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      artworks.push(a);
    }
  }
  for (const a of artworksAsLister ?? []) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      artworks.push(a);
    }
  }

  // Apply profile-specific ordering
  const artworkIds = artworks.map((a) => a.id);
  const { data: profileOrderMap } = await getProfileArtworkOrders(p.id, artworkIds);
  const orderedArtworks = applyProfileOrdering(artworks, profileOrderMap ?? new Map());

  // Profile-specific manual exhibition order (used as the default sort
  // when the owner has saved one; otherwise the toggle hides "Custom order").
  const exList = (exhibitions ?? []) as ExhibitionWithCredits[];
  const exhibitionOrderResult = await getProfileExhibitionOrders(
    p.id,
    exList.map((e) => e.id)
  );
  const exhibitionOrderEntries = Array.from(
    (exhibitionOrderResult.data ?? new Map<string, number>()).entries()
  );

  return (
    <UserProfileContent
      profile={p}
      artworks={orderedArtworks ?? []}
      exhibitions={exList}
      exhibitionOrderEntries={exhibitionOrderEntries}
      initialReorderMode={mode === "reorder"}
      initialTabParam={tabParam ?? null}
    />
  );
}
