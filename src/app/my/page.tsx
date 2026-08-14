"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
import {
  getMyProfile,
  getMyStats,
  getStatsForProfile,
  getMyPendingClaimsCount,
  type MyStats,
} from "@/lib/supabase/me";
import { getMyPriceInquiryCount } from "@/lib/supabase/priceInquiries";
import type { Profile as FullProfile } from "@/lib/supabase/profiles";
import { getProfileById } from "@/lib/supabase/profiles";
import { supabase } from "@/lib/supabase/client";
import { useActingAs } from "@/context/ActingAsContext";
import {
  listExhibitionsForProfile,
  listMyExhibitions,
  type ExhibitionWithCredits,
} from "@/lib/supabase/exhibitions";
import { listMyExternalArtists } from "@/lib/provenance/externalArtists";
import { OrphanInvitesBanner } from "@/components/onboarding/OrphanInvitesBanner";
import { DelegationBriefPanel } from "@/components/delegation/DelegationBriefPanel";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { AppShell } from "@/components/shell/AppShell";
import {
  WorkspaceOperationGrid,
  type WorkspaceTile,
} from "@/components/studio/WorkspaceOperationGrid";
import { claimFounder, isStaffAtLeast } from "@/lib/ops/staff";

// TODO 2026-08 (Phase B redesign): the original studio surface still
// exports StudioHero / StudioPortfolioPanel / StudioMaterialsPanel /
// StudioIntelligenceSurface / FirstValuePathPanel / DelegationBriefPanel
// via `@/components/studio`. Those components are intentionally NOT
// mounted here anymore — the Workspace hub is deliberately quieter —
// but we kept the imports available (in the barrel) so the follow-up
// cycle can wire them into other surfaces (e.g. a richer profile page)
// without another discoverability sweep.

type Profile = FullProfile;

/**
 * Workspace hub — `/my` (Aug-2026 redesign).
 *
 * The old "studio" surface (hero + portfolio + materials + intelligence)
 * is intentionally replaced with a compact 5-tile hub matching the new
 * wireframe. Each tile is a jump-off into a workspace domain:
 *
 *   • Drafts       → /my/library?visibility=draft
 *   • Inquiries    → /my/inquiries
 *   • Ownership    → /my/claims
 *   • My Exhibitions → /my/exhibitions
 *   • Provenance   → /my/orphan-invites
 *
 * The orphan-invites banner + acting-as delegation brief remain (both
 * are gentle context nudges, not content), and unaffected discovery
 * banners fall through as before.
 */
function WorkspaceContent() {
  const { t } = useT();
  const { actingAsProfileId } = useActingAs();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<MyStats | null>(null);
  const [priceInquiryCount, setPriceInquiryCount] = useState<number | null>(null);
  const [pendingClaimsCount, setPendingClaimsCount] = useState<number | null>(null);
  const [exhibitions, setExhibitions] = useState<ExhibitionWithCredits[]>([]);
  const [externalArtistsCount, setExternalArtistsCount] = useState<number | null>(null);
  const [draftExhibitionsCount, setDraftExhibitionsCount] = useState<number | null>(null);
  const [isStaff, setIsStaff] = useState(false);

  const fetchData = useCallback(async () => {
    const effectiveProfileId = actingAsProfileId ?? null;

    const [profileRes, statsRes] = await Promise.all([
      effectiveProfileId ? getProfileById(effectiveProfileId) : getMyProfile(),
      effectiveProfileId ? getStatsForProfile(effectiveProfileId) : getMyStats(),
    ]);
    setProfile((profileRes.data as Profile | null) ?? null);
    setStats(statsRes.data ?? null);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) return;

    const [inquiryCountRes, claimsCountRes, exRes, externalRes] = await Promise.all([
      getMyPriceInquiryCount(effectiveProfileId ?? undefined),
      getMyPendingClaimsCount(effectiveProfileId ?? undefined),
      effectiveProfileId
        ? listExhibitionsForProfile(effectiveProfileId)
        : listMyExhibitions(),
      // Provenance count is scoped to the operator; when acting as a
      // principal we skip the fetch (the RPC filters by inviter =
      // caller, so it would return 0 anyway).
      effectiveProfileId
        ? Promise.resolve({ data: [], error: null })
        : listMyExternalArtists(),
    ]);
    setPriceInquiryCount(inquiryCountRes.data ?? 0);
    setPendingClaimsCount(claimsCountRes.data ?? 0);
    const exList = exRes.data ?? [];
    setExhibitions(exList);
    // Best-effort draft count — the exhibition record uses `visibility`
    // ('public' | 'unlisted' | 'draft') as source of truth for whether
    // it has been published. We treat anything non-public as a draft
    // for the purposes of this tile.
    setDraftExhibitionsCount(
      exList.filter((e) => {
        const visibility = (e as { visibility?: string | null }).visibility;
        return visibility !== "public";
      }).length
    );
    setExternalArtistsCount(externalRes.data?.length ?? 0);
  }, [actingAsProfileId]);

  useEffect(() => {
    // fetchData ultimately triggers setters; the pattern is
    // deliberate (initial load on mount) and matches every other
    // page-level fetch in this codebase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Founder email can self-grant here so Henry sees the block
      // without first visiting /my/ops/staff.
      await claimFounder();
      const ok = await isStaffAtLeast("moderator");
      if (!cancelled) setIsStaff(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onFocus() {
      void fetchData();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchData]);

  // Drafts = artworks not yet public + non-public exhibitions.
  const artworkDraftsCount = useMemo(() => {
    if (!stats) return null;
    return Math.max(0, (stats.artworksCount ?? 0) - (stats.postsCount ?? 0));
  }, [stats]);
  const totalDrafts = useMemo(() => {
    if (artworkDraftsCount == null && draftExhibitionsCount == null) return null;
    return (artworkDraftsCount ?? 0) + (draftExhibitionsCount ?? 0);
  }, [artworkDraftsCount, draftExhibitionsCount]);

  const tiles = useMemo<WorkspaceTile[]>(() => {
    return [
      {
        key: "drafts",
        labelKey: "workspace.tile.drafts.title",
        subtitleKey: "workspace.tile.drafts.subtitle",
        href: "/my/library?visibility=draft",
        value: totalDrafts,
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 6h16M4 12h16M4 18h10"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        ),
      },
      {
        key: "inquiries",
        labelKey: "workspace.tile.inquiries.title",
        subtitleKey: "workspace.tile.inquiries.subtitle",
        href: "/my/inquiries",
        value: priceInquiryCount,
        badge:
          priceInquiryCount && priceInquiryCount > 0
            ? String(priceInquiryCount)
            : null,
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 6a2 2 0 0 1 2-2h9l5 5v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M8 12h8M8 16h5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        ),
      },
      {
        key: "ownership",
        labelKey: "workspace.tile.ownership.title",
        subtitleKey: "workspace.tile.ownership.subtitle",
        href: "/my/claims",
        value: pendingClaimsCount,
        badge:
          pendingClaimsCount && pendingClaimsCount > 0
            ? String(pendingClaimsCount)
            : null,
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 3l8 4v6c0 4.5-3.5 7.5-8 8-4.5-.5-8-3.5-8-8V7l8-4Z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="m9 12 2 2 4-4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
      {
        key: "my_exhibitions",
        labelKey: "workspace.tile.myExhibitions.title",
        subtitleKey: "workspace.tile.myExhibitions.subtitle",
        href: "/my/exhibitions",
        value: exhibitions.length,
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect
              x="3"
              y="4"
              width="18"
              height="14"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="m6 15 4-5 3 3 2-2 3 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
      {
        key: "provenance",
        labelKey: "workspace.tile.provenance.title",
        subtitleKey: "workspace.tile.provenance.subtitle",
        href: "/my/orphan-invites",
        value: externalArtistsCount,
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M3 20c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <path
              d="M15 20c.5-2 2-3 3.5-3s3 1 3.5 3"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        ),
      },
    ];
  }, [totalDrafts, priceInquiryCount, pendingClaimsCount, exhibitions.length, externalArtistsCount]);

  return (
    <PageShell variant="studio">
      <PageHeader
        variant="plain"
        title={t("workspace.hub.title")}
        lead={t("workspace.hub.subtitle")}
      />

      {isStaff && (
        <Link
          href="/my/ops"
          className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-4 text-white hover:bg-zinc-800"
        >
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">
              {t("workspace.ops.kicker")}
            </p>
            <p className="mt-1 text-sm font-semibold">{t("workspace.ops.title")}</p>
            <p className="mt-0.5 text-xs text-zinc-400">
              {t("workspace.ops.subtitle")}
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium text-zinc-300">
            {t("workspace.ops.open")} →
          </span>
        </Link>
      )}

      <WorkspaceOperationGrid tiles={tiles} />

      {profile && actingAsProfileId && (
        <div className="mt-6">
          <DelegationBriefPanel
            actingAsProfileId={actingAsProfileId}
            principalName={profile.display_name ?? profile.username ?? null}
          />
        </div>
      )}

      {/* Provenance nudge — surface any name-only invitations that may
          belong to the operator, so they can consolidate their catalog
          under a single profile. Renders nothing if there are no
          candidates. */}
      {!actingAsProfileId && (
        <div className="mt-6">
          <OrphanInvitesBanner />
        </div>
      )}
    </PageShell>
  );
}

export default function MyPage() {
  return (
    <AuthGate>
      <AppShell>
        <WorkspaceContent />
      </AppShell>
    </AuthGate>
  );
}
