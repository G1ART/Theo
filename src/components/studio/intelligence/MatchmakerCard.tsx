"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { SectionFrame } from "@/components/ds/SectionFrame";
import { SectionTitle } from "@/components/ds/SectionTitle";
import { useT } from "@/lib/i18n/useT";
import { aiApi } from "@/lib/ai/browser";
import { markAiAccepted } from "@/lib/ai/accept";
import {
  AiDisclosureNote,
  AiStateBlock,
  AiStatusChip,
} from "@/components/ai/primitives";
import { getPeopleRecommendations } from "@/lib/supabase/recommendations";
import { formatIdentityPair } from "@/lib/identity/format";
import { IntroMessageAssist } from "@/components/ai/IntroMessageAssist";
import type { PeopleRec } from "@/lib/supabase/peopleRecs";
import type { MatchmakerRationale, MatchmakerSuggestedAction } from "@/lib/ai/types";
import type { MessageKey } from "@/lib/i18n/messages";

type Props = {
  me: {
    themes?: string[] | null;
    mediums?: string[] | null;
    city?: string | null;
    artworks?: Array<{ id: string; title: string | null }> | null;
  };
  /**
   * id → title for the viewer's own artworks. Used to render the
   * "mention works" chips without hitting the DB again.
   */
  myArtworkTitles?: Record<string, string>;
};

const ACTION_LABEL: Record<MatchmakerSuggestedAction, MessageKey> = {
  follow: "ai.matchmaker.action.follow",
  intro_note: "ai.matchmaker.action.intro_note",
  exhibition_share: "ai.matchmaker.action.exhibition_share",
  save_for_later: "ai.matchmaker.action.save_for_later",
};

export function MatchmakerCard({ me, myArtworkTitles }: Props) {
  const { t, locale } = useT();
  const [loading, setLoading] = useState(false);
  const [peers, setPeers] = useState<PeopleRec[]>([]);
  const [rationaleMap, setRationaleMap] = useState<Record<string, MatchmakerRationale>>({});
  const [degradedReason, setDegradedReason] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [aiEventId, setAiEventId] = useState<string | null>(null);
  const [openIntroFor, setOpenIntroFor] = useState<string | null>(null);
  const [savedForLater, setSavedForLater] = useState<Record<string, boolean>>({});

  const trigger = useCallback(async () => {
    setLoading(true);
    setDegradedReason(null);
    setOpenIntroFor(null);
    try {
      const { data } = await getPeopleRecommendations({
        lane: "likes_based",
        limit: 5,
      });
      const top = (data ?? []).slice(0, 5);
      setPeers(top);

      if (top.length === 0) {
        setHasLoaded(true);
        return;
      }

      const candidates = top.map((p) => ({
        profileId: p.id,
        display_name: p.display_name,
        role: p.main_role,
        sharedSignals: p.reason_tags ?? [],
      }));
      const res = await aiApi.matchmakerRationales({
        matchmaker: { me, candidates, locale },
      });
      if (res.degraded) {
        setDegradedReason(res.reason ?? "error");
      }
      setAiEventId(res.aiEventId ?? null);
      const map: Record<string, MatchmakerRationale> = {};
      for (const r of res.rationales ?? []) {
        if (r?.profileId) map[r.profileId] = r;
      }
      setRationaleMap(map);
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [me, locale]);

  const degradedShape = degradedReason
    ? ({
        degraded: true,
        reason: degradedReason as
          | "cap"
          | "no_key"
          | "invalid_input"
          | "timeout"
          | "parse"
          | "error"
          | "unauthorized",
      } as const)
    : null;

  const dismiss = () => {
    setPeers([]);
    setRationaleMap({});
    setDegradedReason(null);
    setHasLoaded(false);
    setAiEventId(null);
    setOpenIntroFor(null);
    setSavedForLater({});
  };

  return (
    <SectionFrame padding="md" noMargin>
      <SectionTitle
        eyebrow={t("ai.matchmaker.card.title")}
        action={
          <div className="flex items-center gap-2">
            {hasLoaded && (
              <button
                type="button"
                onClick={dismiss}
                className="rounded-lg border border-transparent px-2 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800"
              >
                {t("ai.action.dismiss")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void trigger()}
              disabled={loading}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500 disabled:opacity-60"
              title={t("ai.disclosure.tooltip")}
            >
              {loading ? t("ai.common.loading") : t("ai.matchmaker.cta")}
            </button>
          </div>
        }
      >
        {t("ai.matchmaker.card.subtitle")}
      </SectionTitle>

      {!hasLoaded && !loading && (
        <p className="text-xs text-zinc-500">{t("ai.matchmaker.idle")}</p>
      )}

      {hasLoaded && peers.length === 0 && (
        <p className="text-xs text-zinc-500">{t("ai.matchmaker.empty")}</p>
      )}

      <AiStateBlock loading={loading} result={degradedShape} />

      {peers.length > 0 && (
        <ul className="flex flex-col gap-2">
          {peers.map((p) => {
            const identity = formatIdentityPair(
              {
                display_name: p.display_name,
                display_name_ko:
                  (p as { display_name_ko?: string | null }).display_name_ko ??
                  null,
                display_name_en:
                  (p as { display_name_en?: string | null }).display_name_en ??
                  null,
                username: p.username,
              },
              t,
              locale,
            );
            const rationale = rationaleMap[p.id];
            const rationaleText =
              rationale?.rationale || t("ai.matchmaker.rationaleFallback");
            const href = p.username ? `/u/${p.username}` : `/u/${p.id}`;
            const action = rationale?.suggestedAction;
            const suggestedArtworkIds = (rationale?.suggestedArtworkIds ?? [])
              .filter((id) => myArtworkTitles?.[id])
              .slice(0, 3);
            const introOpen = openIntroFor === p.id;
            const savedHere = !!savedForLater[p.id];

            const recipientSummary = {
              display_name: p.display_name,
              role: p.main_role,
              themes: null,
              mediums: null,
              city: null,
              sharedSignals: p.reason_tags ?? [],
            };
            const meForIntro = {
              display_name: null,
              role: null,
              themes: me.themes ?? null,
              mediums: me.mediums ?? null,
              city: me.city ?? null,
              artworks: suggestedArtworkIds.map((id) => ({
                title: myArtworkTitles?.[id] ?? "",
              })),
            };

            return (
              <li
                key={p.id}
                className="rounded-xl border border-zinc-200 bg-white p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={href}
                      onClick={() => {
                        markAiAccepted(aiEventId, {
                          feature: "matchmaker_rationales",
                          via: "link",
                        });
                      }}
                      className="truncate text-sm font-medium text-zinc-900 hover:underline"
                    >
                      {identity.primary}
                    </Link>
                    {identity.secondary && (
                      <p className="truncate text-[11px] text-zinc-500">
                        {identity.secondary}
                      </p>
                    )}
                  </div>
                  {p.main_role && (
                    <AiStatusChip label={p.main_role} tone="neutral" />
                  )}
                </div>
                <p className="mt-2 text-xs text-zinc-600">{rationaleText}</p>

                {action && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {action === "follow" && (
                      <Link
                        href={href}
                        onClick={() => {
                          markAiAccepted(aiEventId, {
                            feature: "matchmaker_rationales",
                            via: "link",
                          });
                        }}
                        className="inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
                      >
                        {t(ACTION_LABEL.follow)}
                      </Link>
                    )}
                    {action === "intro_note" && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenIntroFor((prev) => (prev === p.id ? null : p.id));
                          markAiAccepted(aiEventId, {
                            feature: "matchmaker_rationales",
                            via: "link",
                          });
                        }}
                        className="inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
                      >
                        {t(ACTION_LABEL.intro_note)}
                      </button>
                    )}
                    {action === "exhibition_share" && (
                      <Link
                        href="/my/exhibitions"
                        onClick={() => {
                          markAiAccepted(aiEventId, {
                            feature: "matchmaker_rationales",
                            via: "link",
                          });
                        }}
                        className="inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
                      >
                        {t(ACTION_LABEL.exhibition_share)}
                      </Link>
                    )}
                    {action === "save_for_later" && (
                      <button
                        type="button"
                        onClick={() => {
                          setSavedForLater((prev) => ({
                            ...prev,
                            [p.id]: !prev[p.id],
                          }));
                        }}
                        className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-medium ${
                          savedHere
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500"
                        }`}
                      >
                        {savedHere
                          ? t("ai.matchmaker.action.saved")
                          : t(ACTION_LABEL.save_for_later)}
                      </button>
                    )}
                  </div>
                )}

                {introOpen && action === "intro_note" && (
                  <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                    {suggestedArtworkIds.length > 0 && (
                      <div className="mb-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                          {t("ai.matchmaker.mentionWorks")}
                        </p>
                        <ul className="mt-1 flex flex-wrap gap-1.5">
                          {suggestedArtworkIds.map((id) => (
                            <li key={id}>
                              <Link
                                href={`/artwork/${id}`}
                                className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:border-zinc-500"
                              >
                                {myArtworkTitles?.[id]}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <IntroMessageAssist
                      me={meForIntro}
                      recipient={recipientSummary}
                      variant="inline"
                      autoOpen
                    />
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {t("ai.matchmaker.introHint")}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {peers.length > 0 && (
        <div className="mt-2">
          <AiDisclosureNote />
        </div>
      )}
    </SectionFrame>
  );
}
