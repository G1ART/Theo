"use client";

/**
 * "내 공간에서 보기 / See in my space" CTA embedded on
 * `/artwork/[id]`. Handles the three canonical states:
 *
 *   0 spaces  → 3-step onboarding sheet:
 *               ① upload a room photo
 *               ② name the space
 *               ③ auto-place this artwork on the default wall
 *               (reuses `CreateSpaceDialog` for ①+②, then routes to
 *               the editor with `?focus={placementId}`).
 *   ≥1 spaces → picker sheet with the user's spaces. Selecting one
 *               inserts a placement + navigates.
 *   not signed in → route to sign-in with `?see_in_space=1` so the
 *               same CTA auto-fires after sign-in.
 *
 * Only rendered when the parent has already confirmed the artwork is
 * `flat_2d` — 3D and time-based works are hidden entirely per the
 * brief (a "3D 시뮬은 곧" hint lives inside the artwork picker sheet,
 * not here — this component is the entry point).
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import type { EntitlementDecision } from "@/lib/entitlements";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import {
  listMySpaces,
  SimulationEntitlementError,
  upsertPlacements,
} from "@/lib/supabase/spaces";
import type { SceneSpace } from "@/lib/simulation/scene";
import { CreateSpaceDialog } from "./CreateSpaceDialog";
import { SimulationPaywallCard } from "./SimulationPaywallCard";
import { spacePhotoUrl } from "./spacePhotoUrl";
import { onboardingUrlWithNext } from "@/lib/identity/routing";

const FALLBACK_WALL_WIDTH_CM = 400;
const FALLBACK_WALL_HEIGHT_CM = 260;
const EYE_LEVEL_CM = 150;

type ArtworkForCta = {
  id: string;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
};

type Props = {
  artwork: ArtworkForCta;
  userId: string | null;
  sessionChecked: boolean;
};

export function SeeInMySpaceCta({ artwork, userId, sessionChecked }: Props) {
  const { t } = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const featureAccess = useFeatureAccess("simulation.2d");
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [spaces, setSpaces] = useState<SceneSpace[]>([]);
  const [spacesLoaded, setSpacesLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const autoOpen = searchParams.get("see_in_space") === "1";
  const overCap: boolean =
    featureAccess.decision !== null && featureAccess.decision.allowed === false;

  const loadSpaces = useCallback(async () => {
    if (!userId) return;
    const { data } = await listMySpaces();
    setSpaces(data);
    setSpacesLoaded(true);
  }, [userId]);

  useEffect(() => {
    if (open || autoOpen) void loadSpaces();
  }, [open, autoOpen, loadSpaces]);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(h);
  }, [toast]);

  // Auto-fire the CTA after a signed-in return from the auth gate.
  useEffect(() => {
    if (!autoOpen || !userId || !sessionChecked) return;
    setOpen(true);
  }, [autoOpen, userId, sessionChecked]);

  const decision: EntitlementDecision | null = featureAccess.decision;

  const attachPlacementAndRoute = useCallback(
    async (space: SceneSpace) => {
      setBusy(true);
      try {
        const surface = space.surfaces[0];
        const surfaceId = surface?.id ?? null;
        const wallW = surface?.widthCm ?? FALLBACK_WALL_WIDTH_CM;
        const wallH = surface?.heightCm ?? FALLBACK_WALL_HEIGHT_CM;
        const yCm = Math.min(
          EYE_LEVEL_CM,
          wallH - (artwork.heightCm ?? 60) / 2,
        );
        const zOrder = space.placements.length;
        const { error } = await upsertPlacements(space.id, [
          {
            spaceId: space.id,
            surfaceId,
            artworkId: artwork.id,
            xCm: wallW / 2,
            yCm,
            zCm: 0,
            rotXDeg: 0,
            rotYDeg: 0,
            rotZDeg: 0,
            widthCm: artwork.widthCm,
            heightCm: artwork.heightCm,
            depthCm: artwork.depthCm,
            zOrder,
          },
        ]);
        if (error) {
          setBusy(false);
          setToast(t("simulation.errors.generic"));
          return;
        }
        // Route to the editor. `focus` is a best-effort id: because we
        // upsert without a client-side id, we can't cheaply resolve the
        // new placement id; the editor picks the latest placement as
        // the "just-added" one via its default select behaviour.
        router.push(`/my/spaces/${space.id}?focus=latest`);
      } catch (err) {
        setBusy(false);
        if (err instanceof SimulationEntitlementError) {
          setToast(t("simulation.errors.entitlement"));
        } else {
          setToast(t("simulation.errors.generic"));
        }
      }
    },
    [artwork, router, t],
  );

  const handleCreatedZeroFlow = useCallback(
    async (created: { id: string }) => {
      setBusy(true);
      try {
        // The freshly-created space has no placements yet — attach the
        // artwork before we route so the editor lands on the new
        // placement immediately.
        const { data: refreshed } = await listMySpaces();
        const target = refreshed.find((s) => s.id === created.id);
        if (target) {
          await attachPlacementAndRoute(target);
        } else {
          router.push(`/my/spaces/${created.id}`);
        }
      } finally {
        setBusy(false);
        setCreateOpen(false);
        setOpen(false);
      }
    },
    [attachPlacementAndRoute, router],
  );

  const nextPath = `/artwork/${artwork.id}?see_in_space=1`;

  const ctaVisible = useMemo(() => {
    if (!sessionChecked) return false;
    return true;
  }, [sessionChecked]);

  if (!ctaVisible) return null;

  // Anonymous — route to sign-up gate with the auto-fire query.
  if (!userId) {
    return (
      <Link
        href={onboardingUrlWithNext({ nextPath })}
        className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
      >
        {t("simulation.artworkCta.title")}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
      >
        {t("simulation.artworkCta.title")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("simulation.artworkCta.title")}
            className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">
                {t("simulation.artworkCta.title")}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-zinc-400 hover:text-zinc-600"
                aria-label={t("simulation.picker.close")}
              >
                ×
              </button>
            </div>

            {!spacesLoaded ? (
              <p className="py-6 text-center text-sm text-zinc-500">
                {t("common.loading")}
              </p>
            ) : spaces.length === 0 ? (
              <>
                <p className="text-sm text-zinc-600">
                  {t("simulation.artworkCta.subtitleZero")}
                </p>
                {overCap ? (
                  <div className="mt-3">
                    <SimulationPaywallCard decision={decision} />
                  </div>
                ) : (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setCreateOpen(true)}
                      className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                    >
                      {t("simulation.artworkCta.newSpace")}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="mb-2 text-sm text-zinc-600">
                  {t("simulation.artworkCta.subtitle")}
                </p>
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                  {spaces.map((space) => {
                    const url = spacePhotoUrl(space.photoStoragePath);
                    return (
                      <li key={space.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void attachPlacementAndRoute(space)}
                          className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white p-2 text-left transition-shadow hover:shadow-sm disabled:opacity-50"
                        >
                          <div className="h-12 w-16 shrink-0 overflow-hidden rounded bg-zinc-100">
                            {url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={url}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                          </div>
                          <span className="min-w-0 flex-1 truncate text-sm text-zinc-800">
                            {space.title ||
                              t("simulation.editor.titlePlaceholder")}
                          </span>
                          <span className="text-xs text-zinc-400">
                            {t("simulation.artworkCta.open")} →
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {!overCap && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setCreateOpen(true)}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      {t("simulation.artworkCta.newSpace")}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <CreateSpaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreatedZeroFlow}
        paywalled={overCap}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}
