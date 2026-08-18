"use client";

/**
 * Sprint C.M / 2026-08-03 — Invitations aggregate panel.
 *
 * The 2026-08-03 wireframe for the Connections page shows a single big
 * "Invitations" card at the top with per-row Decline / Accept actions.
 * That aggregate is a union of two independent inboxes:
 *   1. Pending follow requests (from the `follows` table where
 *      status='pending' and following_id = auth.uid()).
 *   2. Pending relationship access requests (from `access_requests`
 *      where status='pending' and owner_profile_id = principal).
 *
 * Both sources are read here and merged into a single time-ordered
 * list so the operator sees "everything asking for a decision" in one
 * place, matching designer intent ("팔로워 invitation은 아무래도 커넥
 * 션쪽에 있는것이 더 이해가 잘 가는거같아서 이쪽으로 다시 추가했
 * 습니다").
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";
import { formatDisplayName } from "@/lib/identity/format";
import { pickLocalizedBio } from "@/lib/i18n/pickLocalized";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import {
  acceptFollowRequest,
  declineFollowRequest,
  listIncomingFollowRequests,
  type FollowProfileRow,
} from "@/lib/supabase/follows";
import {
  listAccessRequestsForOwnerEnriched,
  type AccessRequestRowEnriched,
} from "@/lib/supabase/relationshipAccess";
import { resolveAccessRequestWithScope } from "@/lib/access/resolveV2Adapter";

type InvitationItem =
  | {
      kind: "follow_request";
      key: string;
      createdAt: string;
      followerId: string;
      profile: FollowProfileRow | null;
    }
  | {
      kind: "access_request";
      key: string;
      createdAt: string;
      row: AccessRequestRowEnriched;
    };

type Props = {
  ownerProfileId: string | null;
};

function avatarUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.startsWith("http")) return v;
  return getArtworkImageUrl(v, "avatar");
}

export function InvitationsPanel({ ownerProfileId }: Props) {
  const { t, locale } = useT();
  const [followRows, setFollowRows] = useState<
    Array<{
      follower_id: string;
      created_at: string;
      profile: FollowProfileRow | null;
    }>
  >([]);
  const [accessRows, setAccessRows] = useState<AccessRequestRowEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (ownerId: string) => {
    setLoading(true);
    const [f, a] = await Promise.all([
      listIncomingFollowRequests({ limit: 50 }),
      listAccessRequestsForOwnerEnriched({
        ownerProfileId: ownerId,
        status: "pending",
        limit: 50,
      }),
    ]);
    setFollowRows(f.data ?? []);
    setAccessRows(a.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ownerProfileId) return;
    const h = requestAnimationFrame(() => {
      void refresh(ownerProfileId);
    });
    return () => cancelAnimationFrame(h);
  }, [ownerProfileId, refresh]);

  const items: InvitationItem[] = useMemo(() => {
    const out: InvitationItem[] = [];
    for (const f of followRows) {
      out.push({
        kind: "follow_request",
        key: `fr:${f.follower_id}`,
        createdAt: f.created_at,
        followerId: f.follower_id,
        profile: f.profile ?? null,
      });
    }
    for (const r of accessRows) {
      out.push({
        kind: "access_request",
        key: `ar:${r.id}`,
        createdAt: r.created_at,
        row: r,
      });
    }
    out.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    return out;
  }, [followRows, accessRows]);

  const handleFollowAction = useCallback(
    async (item: Extract<InvitationItem, { kind: "follow_request" }>, action: "accept" | "decline") => {
      setPendingId(item.key);
      setError(null);
      const res = action === "accept"
        ? await acceptFollowRequest(item.followerId)
        : await declineFollowRequest(item.followerId);
      setPendingId(null);
      if (res.error) {
        setError(t("messages.request.actionFailed"));
        return;
      }
      setFollowRows((prev) => prev.filter((r) => r.follower_id !== item.followerId));
    },
    [t],
  );

  const handleAccessAction = useCallback(
    async (item: Extract<InvitationItem, { kind: "access_request" }>, action: "approve" | "decline") => {
      setPendingId(item.key);
      setError(null);
      const { data, error: err } = await resolveAccessRequestWithScope({
        request: item.row,
        scope: action === "approve" ? "all" : "decline",
      });
      setPendingId(null);
      if (err || !data) {
        setError(t("messages.request.actionFailed"));
        return;
      }
      setAccessRows((prev) => prev.filter((r) => r.id !== item.row.id));
    },
    [t],
  );

  if (!ownerProfileId) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white">
      <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">
          {t("connections.invitations.title")}
        </h2>
        {items.length > 0 && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] tabular-nums text-zinc-600">
            {items.length}
          </span>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="mx-5 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="px-5 py-6 text-sm text-zinc-500">…</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-zinc-500">
          {t("connections.invitations.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {items.map((item) => {
            const busy = pendingId === item.key;
            if (item.kind === "follow_request") {
              const p = item.profile;
              const name =
                (p ? formatDisplayName(p, t, locale) : null) ||
                p?.username ||
                "—";
              const src = avatarUrl(p?.avatar_url);
              const bio = p ? pickLocalizedBio(p, locale) || p.bio : null;
              return (
                <li
                  key={item.key}
                  className="flex items-center gap-4 px-5 py-3"
                >
                  <Avatar src={src} fallback={name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-zinc-900">
                        {name}
                      </span>
                      {p?.username && (
                        <span className="truncate text-xs text-zinc-500">
                          @{p.username}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                      {t("connections.invitations.followRequest")}
                      {bio ? ` · ${bio}` : ""}
                    </p>
                  </div>
                  <ActionPair
                    disabled={busy}
                    onDecline={() => void handleFollowAction(item, "decline")}
                    onAccept={() => void handleFollowAction(item, "accept")}
                    tDecline={t("messages.request.decline")}
                    tAccept={t("messages.request.accept")}
                  />
                </li>
              );
            }
            const r = item.row;
            const p = r.requester;
            const name =
              (p ? formatDisplayName(p, t, locale) : null) ||
              p?.username ||
              "—";
            const src = avatarUrl(p?.avatar_url ?? null);
            return (
              <li key={item.key} className="flex items-center gap-4 px-5 py-3">
                <Avatar src={src} fallback={name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-zinc-900">
                      {name}
                    </span>
                    {p?.username && (
                      <span className="truncate text-xs text-zinc-500">
                        @{p.username}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                    {t("connections.invitations.accessRequest")}
                    {" · "}
                    {t(`visibility.field.${r.field_key}` as MessageKey)}
                  </p>
                </div>
                <ActionPair
                  disabled={busy}
                  onDecline={() => void handleAccessAction(item, "decline")}
                  onAccept={() => void handleAccessAction(item, "approve")}
                  tDecline={t("messages.request.decline")}
                  tAccept={t("messages.request.accept")}
                />
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 0 && (
        <footer className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
          <Link
            href="/my/network?tab=requests"
            className="underline-offset-2 hover:text-zinc-900 hover:underline"
          >
            {t("connections.tabs.detail")} →
          </Link>
        </footer>
      )}
    </section>
  );
}

function Avatar({ src, fallback }: { src: string | null; fallback: string }) {
  if (src) {
    return (
      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-zinc-200">
        <Image
          src={src}
          alt=""
          width={40}
          height={40}
          className="h-full w-full object-cover"
          unoptimized
        />
      </span>
    );
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-600">
      {(fallback || "?").charAt(0).toUpperCase()}
    </span>
  );
}

function ActionPair({
  disabled,
  onDecline,
  onAccept,
  tDecline,
  tAccept,
}: {
  disabled: boolean;
  onDecline: () => void;
  onAccept: () => void;
  tDecline: string;
  tAccept: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={onDecline}
        disabled={disabled}
        className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        {tDecline}
      </button>
      <button
        type="button"
        onClick={onAccept}
        disabled={disabled}
        className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {tAccept}
      </button>
    </div>
  );
}
