import { NextResponse } from "next/server";
import { handleAiRoute } from "@/lib/ai/route";
import {
  buildDelegationBriefContext,
  type DelegationBriefInput,
} from "@/lib/ai/contexts";
import {
  DELEGATION_BRIEF_SCHEMA,
  DELEGATION_BRIEF_SYSTEM,
} from "@/lib/ai/prompts";
import type { DelegationBriefResult } from "@/lib/ai/types";
import {
  parseDelegationBriefBody,
  type DelegationBriefBody,
} from "@/lib/ai/validation";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const REQUIRED_PERMISSION = "manage_works";

/**
 * Deterministic, model-free fallback for the brief. Emits priorities
 * derived from the actual server-side counts so the operator still has
 * a working checklist when the LLM is unavailable. Numbers are never
 * invented — every entry references a count we measured in this same
 * request and links to the right surface inside Theo.
 */
function buildDelegationBriefFallback(
  ctx: DelegationBriefInput,
): DelegationBriefResult {
  const isKo = ctx.locale === "ko";
  const priorities: DelegationBriefResult["priorities"] = [];
  const watchItems: string[] = [];

  const unanswered = ctx.unansweredInquiryCount ?? 0;
  const oldestDays = ctx.oldestUnansweredInquiryDays ?? 0;
  const drafts = ctx.incompleteDraftCount ?? 0;
  const exhGaps = ctx.exhibitionGapsCount ?? 0;
  const readiness = ctx.profileReadinessPercent ?? 100;

  if (unanswered > 0) {
    priorities.push({
      id: "inquiries",
      title: isKo
        ? `미답변 문의 ${unanswered}건 답하기`
        : `Reply to ${unanswered} open inquir${unanswered === 1 ? "y" : "ies"}`,
      reason: isKo
        ? "응답이 늦어질수록 협업 가능성이 멀어져요."
        : "Each unanswered inquiry cools off quickly.",
      href: "/my/inquiries",
    });
    if (oldestDays >= 7) {
      watchItems.push(
        isKo
          ? `가장 오래된 미답변 문의가 ${oldestDays}일 지났어요.`
          : `Oldest open inquiry is ${oldestDays} days old.`,
      );
    }
  }

  if (drafts > 0) {
    priorities.push({
      id: "drafts",
      title: isKo
        ? `미공개 작품 ${drafts}점 정리`
        : `Polish ${drafts} unpublished work${drafts === 1 ? "" : "s"}`,
      reason: isKo
        ? "이미지·메타데이터를 다듬어 공개 후보로 옮길 수 있어요."
        : "Each can be moved to public after image and metadata cleanup.",
      href: "/my",
    });
  }

  if (exhGaps > 0) {
    priorities.push({
      id: "exhibitions",
      title: isKo
        ? `전시 ${exhGaps}건 커버 이미지 보완`
        : `Add covers to ${exhGaps} exhibition${exhGaps === 1 ? "" : "s"}`,
      reason: isKo
        ? "전시 카드의 첫인상은 대표 이미지로 결정돼요."
        : "Cover images carry the first impression of an exhibition card.",
      href: "/my/exhibitions",
    });
  }

  if (readiness < 70) {
    priorities.push({
      id: "profile",
      title: isKo
        ? `프로필 완성도 정리 (${readiness}%)`
        : `Tighten profile readiness (${readiness}%)`,
      reason: isKo
        ? "공개 프로필의 짧은 소개·작가의 말·테마/매체를 보완하면 도움이 됩니다."
        : "A tighter bio, statement, and themes/mediums help discoverability.",
      href: "/profile/edit",
    });
  }

  if (ctx.profileIsPublic === false) {
    watchItems.push(
      isKo
        ? "공개 프로필이 비공개 상태예요."
        : "Public profile is currently hidden.",
    );
  }

  return { priorities: priorities.slice(0, 4), watchItems: watchItems.slice(0, 3) };
}

/**
 * Mirrors `userMayActAs` in the website-import session route. The brief
 * is account-level (multiple projects worth of signal) so we require an
 * active account/inventory delegation, not a project-scope grant.
 */
async function userMayActAs(
  client: SupabaseClient,
  callerId: string,
  targetProfileId: string,
): Promise<boolean> {
  if (callerId === targetProfileId) return true;
  const { data, error } = await client
    .from("delegations")
    .select("permissions")
    .eq("delegator_profile_id", targetProfileId)
    .eq("delegate_profile_id", callerId)
    .eq("status", "active")
    .in("scope_type", ["account", "inventory"]);
  if (error || !Array.isArray(data)) return false;
  for (const d of data as { permissions: string[] | null }[]) {
    if (Array.isArray(d.permissions) && d.permissions.includes(REQUIRED_PERMISSION)) {
      return true;
    }
  }
  return false;
}

/**
 * P1-C — Delegation Brief route.
 *
 * Returns prioritised next-actions for an operator acting as another
 * profile (typical case: gallery manager covering for an artist on
 * holiday). Context is the *principal's* aggregate counts only — never
 * the operator's own. Cross-profile leak is prevented by the explicit
 * `userMayActAs` guard plus by querying every counts table with
 * `actingAsProfileId` (not `userId`).
 *
 * Counts are best-effort: each schema-specific block is wrapped so a
 * missing column / table reports 0 instead of breaking the brief.
 */
export async function POST(req: Request) {
  return handleAiRoute<DelegationBriefBody, DelegationBriefResult>(req, {
    feature: "delegation_brief",
    validateBody: (raw) => {
      const r = parseDelegationBriefBody(raw);
      return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
    },
    async buildPromptInput({ body, userId, supabase }) {
      const allowed = await userMayActAs(supabase, userId, body.actingAsProfileId);
      if (!allowed) {
        return NextResponse.json(
          { degraded: true, reason: "unauthorized" },
          { status: 403 },
        );
      }

      const { data: principal } = await supabase
        .from("profiles")
        .select(
          "display_name, username, is_public, bio, themes, mediums, " +
            "avatar_url, cover_image_url, artist_statement",
        )
        .eq("id", body.actingAsProfileId)
        .maybeSingle();

      // Drafts: artworks owned by principal that aren't public.
      let draftCount = 0;
      try {
        const { count } = await supabase
          .from("artworks")
          .select("id", { count: "exact", head: true })
          .eq("artist_id", body.actingAsProfileId)
          .neq("visibility", "public");
        draftCount = count ?? 0;
      } catch {
        // schema variant; leave at 0
      }

      // Unanswered inquiries: price_inquiries joined via claims to find
      // the artist. We avoid the join here by counting only those whose
      // claim subject matches the principal. If the schema isn't
      // present, soft-fail to 0.
      let unansweredCount = 0;
      let oldestUnansweredDays = 0;
      try {
        const { data: rawIds } = await supabase
          .from("claims")
          .select("work_id")
          .eq("subject_profile_id", body.actingAsProfileId)
          .eq("claim_type", "CREATED")
          .not("work_id", "is", null)
          .limit(2000);
        const workIds = Array.isArray(rawIds)
          ? (rawIds as Array<{ work_id: string | null }>)
              .map((r) => r.work_id)
              .filter((v): v is string => typeof v === "string" && v.length > 0)
          : [];
        if (workIds.length > 0) {
          const { data: inqRows } = await supabase
            .from("price_inquiries")
            .select("created_at, replied_at")
            .in("artwork_id", workIds)
            .is("replied_at", null)
            .order("created_at", { ascending: true })
            .limit(50);
          if (Array.isArray(inqRows)) {
            unansweredCount = inqRows.length;
            const oldest = inqRows[0] as { created_at?: string } | undefined;
            if (oldest?.created_at) {
              const d = new Date(oldest.created_at).getTime();
              if (Number.isFinite(d)) {
                oldestUnansweredDays = Math.max(
                  0,
                  Math.floor((Date.now() - d) / (1000 * 60 * 60 * 24)),
                );
              }
            }
          }
        }
      } catch {
        // schema variant; leave at 0
      }

      // Exhibitions: principal as curator or host, recent / upcoming.
      let upcomingExhibitionCount = 0;
      let exhibitionGaps = 0;
      try {
        const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
        const { data: exhRows } = await supabase
          .from("projects")
          .select("id, start_date, end_date, cover_image_paths")
          .eq("project_type", "exhibition")
          .or(
            `curator_id.eq.${body.actingAsProfileId},host_profile_id.eq.${body.actingAsProfileId}`,
          )
          .gte("start_date", cutoff)
          .order("start_date", { ascending: true })
          .limit(50);
        if (Array.isArray(exhRows)) {
          upcomingExhibitionCount = exhRows.length;
          for (const row of exhRows as Array<{ cover_image_paths: string[] | null }>) {
            const hasCover =
              Array.isArray(row.cover_image_paths) && row.cover_image_paths.length > 0;
            if (!hasCover) exhibitionGaps += 1;
          }
        }
      } catch {
        // schema variant; leave at 0
      }

      // Profile readiness heuristic. Transparent: 6 checks, equal weight.
      let readiness = 0;
      if (principal) {
        const p = principal as unknown as {
          bio: string | null;
          themes: string[] | null;
          mediums: string[] | null;
          avatar_url: string | null;
          cover_image_url: string | null;
          artist_statement: string | null;
        };
        const checks = [
          typeof p.bio === "string" && p.bio.trim().length > 40,
          Array.isArray(p.themes) && p.themes.length > 0,
          Array.isArray(p.mediums) && p.mediums.length > 0,
          typeof p.avatar_url === "string" && !!p.avatar_url,
          typeof p.cover_image_url === "string" && !!p.cover_image_url,
          typeof p.artist_statement === "string" && (p.artist_statement ?? "").trim().length > 80,
        ];
        const passed = checks.filter(Boolean).length;
        readiness = Math.round((passed / checks.length) * 100);
      }

      const principalMeta = principal as unknown as {
        display_name?: string | null;
        username?: string | null;
        is_public?: boolean | null;
      } | null;
      const ctx: DelegationBriefInput = {
        locale: body.locale,
        principalDisplayName: principalMeta?.display_name ?? null,
        principalUsername: principalMeta?.username ?? null,
        incompleteDraftCount: draftCount,
        unansweredInquiryCount: unansweredCount,
        oldestUnansweredInquiryDays: oldestUnansweredDays,
        exhibitionGapsCount: exhibitionGaps,
        upcomingExhibitionsCount: upcomingExhibitionCount,
        profileReadinessPercent: readiness,
        profileIsPublic: principalMeta?.is_public === true,
      };

      return {
        system: DELEGATION_BRIEF_SYSTEM,
        user: buildDelegationBriefContext(ctx),
        schemaHint: DELEGATION_BRIEF_SCHEMA,
        fallback: () => buildDelegationBriefFallback(ctx),
      };
    },
  });
}
