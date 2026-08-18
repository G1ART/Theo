"use client";

/**
 * `/my/spaces` — Chunk C list surface for Display / Hang Simulation.
 *
 * Space-first model (per 2026-08-17 (14) architectural reversal):
 * a "space" is a top-level workspace concept sibling to Saved. The
 * user uploads ONE room photo per space; every artwork detail page
 * then hangs into that space in one tap.
 *
 * Entitlement UX:
 *   • `simulation.2d` is a lifetime-count feature. The resolver
 *     compares the caller's plan cap against
 *     `simulation.space.created` events (Chunk A seed).
 *   • When `decision.allowed` is false, the "+ 새 공간" button is
 *     disabled and a `SimulationPaywallCard` renders in its place.
 *   • When quota is non-null we show `used/limit 공간 사용 중`
 *     using `decision.quota.used` and `decision.quota.limit`.
 *
 * We intentionally use the client `useFeatureAccess` hook rather than
 * fetching entitlements SSR — the whole surface is auth-gated by
 * `AuthGate` and the resolver already handles acting-as scoping,
 * which the server component path would need to duplicate.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { EmptyState } from "@/components/ds/EmptyState";
import { useT } from "@/lib/i18n/useT";
import { listMySpaces } from "@/lib/supabase/spaces";
import type { SceneSpace } from "@/lib/simulation/scene";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { CreateSpaceDialog } from "@/components/simulation/CreateSpaceDialog";
import { SimulationPaywallCard } from "@/components/simulation/SimulationPaywallCard";
import { spacePhotoUrl } from "@/components/simulation/spacePhotoUrl";

function formatRelative(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return locale === "ko" ? "방금" : "just now";
  if (minutes < 60) return locale === "ko" ? `${minutes}분 전` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return locale === "ko" ? `${hours}시간 전` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return locale === "ko" ? `${days}일 전` : `${days}d ago`;
  return date.toLocaleDateString();
}

function SpacesContent() {
  const { t, locale } = useT();
  const router = useRouter();
  const featureAccess = useFeatureAccess("simulation.2d");
  const decision = featureAccess.decision;
  const [spaces, setSpaces] = useState<SceneSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await listMySpaces();
    setSpaces(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // React 19's set-state-in-effect rule flags any effect that
    // ultimately triggers setState — refresh() does so via
    // setLoading + setSpaces. This IS the recommended pattern for
    // "sync page state with server on mount / dep change" (matches
    // /my/shortlists precedent, HANDOFF 2026-08-17 (13)).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  const overCap = decision != null && decision.allowed === false;

  const counterText = (() => {
    const quota = decision?.quota;
    if (!quota) {
      if (decision && decision.allowed && spaces.length > 0) {
        return t("simulation.list.counterUnlimited").replace(
          "{used}",
          String(spaces.length),
        );
      }
      return null;
    }
    // `quota.limit === Infinity` in gallery_workspace; render only when finite.
    if (!Number.isFinite(quota.limit)) {
      return t("simulation.list.counterUnlimited").replace(
        "{used}",
        String(quota.used),
      );
    }
    return t("simulation.list.counter")
      .replace("{used}", String(quota.used))
      .replace("{limit}", String(quota.limit));
  })();

  const handleOpenCreate = useCallback(() => {
    if (overCap) return;
    setCreateOpen(true);
  }, [overCap]);

  const handleCreated = useCallback(
    async ({ id }: { id: string }) => {
      setCreateOpen(false);
      // Refresh the entitlement decision so a fresh
      // `simulation.space.created` event advances the counter before
      // the user might click "+ 새 공간" again.
      featureAccess.refresh();
      router.push(`/my/spaces/${id}`);
    },
    [featureAccess, router],
  );

  const handleCopyShare = useCallback(
    (id: string, token: string) => {
      const url = `${window.location.origin}/space/${token}`;
      void navigator.clipboard.writeText(url).then(
        () => {
          setCopiedId(id);
          setToast(t("simulation.list.share.copied"));
          setTimeout(
            () => setCopiedId((curr) => (curr === id ? null : curr)),
            1800,
          );
        },
        () => {
          setToast(t("simulation.errors.generic"));
        },
      );
    },
    [t],
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            {t("simulation.list.title")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {t("simulation.list.subtitle")}
          </p>
          {counterText && (
            <p className="mt-2 text-xs text-zinc-500">{counterText}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          disabled={overCap || featureAccess.loading}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {t("simulation.list.createCta")}
        </button>
      </header>

      {overCap && (
        <div className="mb-6">
          <SimulationPaywallCard decision={decision} />
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-zinc-500">{t("common.loading")}</p>
      ) : spaces.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t("simulation.list.empty.title")}
            description={t("simulation.list.empty.body")}
            action={
              overCap
                ? null
                : {
                    label: t("simulation.list.createCta"),
                    onClick: handleOpenCreate,
                  }
            }
          />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {spaces.map((space) => {
            const photo = spacePhotoUrl(space.photoStoragePath);
            const relative = formatRelative(space.updatedAt, locale);
            const title = space.title?.trim() ||
              t("simulation.editor.titlePlaceholder");
            return (
              <li
                key={space.id}
                className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white transition-shadow hover:shadow-sm"
              >
                <Link
                  href={`/my/spaces/${space.id}`}
                  className="block aspect-[4/3] bg-zinc-100"
                >
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photo}
                      alt={t("simulation.list.thumbAlt").replace(
                        "{title}",
                        title,
                      )}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
                      {t("simulation.editor.needsPhoto")}
                    </div>
                  )}
                </Link>
                <div className="flex items-start justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <Link
                      href={`/my/spaces/${space.id}`}
                      className="block truncate text-sm font-medium text-zinc-900 hover:underline"
                    >
                      {title}
                    </Link>
                    {relative && (
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {t("simulation.list.updatedRelative").replace(
                          "{when}",
                          relative,
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopyShare(space.id, space.shareToken)}
                      className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                      title={t("simulation.list.share.copy")}
                      aria-label={t("simulation.list.share.copy")}
                    >
                      {copiedId === space.id
                        ? t("simulation.list.share.copied")
                        : t("simulation.list.share.copy")}
                    </button>
                    <Link
                      href={`/my/spaces/${space.id}`}
                      className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                    >
                      {t("simulation.list.edit")}
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CreateSpaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
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
    </main>
  );
}

export default function SpacesPage() {
  return (
    <AuthGate>
      <SpacesContent />
    </AuthGate>
  );
}
