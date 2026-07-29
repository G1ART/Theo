import { NextResponse } from "next/server";
import { requireUserFromRequest } from "@/lib/websiteImport/supabaseServer";

/**
 * QA 2026-07-29 (PART E.1) — opt-in "someone's interested in your profile"
 * email to external (invited, not-yet-onboarded) artists.
 *
 * Called (fire-and-forget) by the viewer's client from two places:
 *   - `UnonboardedArtistInterestPopover` — explicit "let them know" click.
 *   - `ExhibitionArtistSectionHeader` — passive signal on mount (once per
 *     session per artist, via sessionStorage dedupe on the client).
 *
 * All eligibility logic (opt-in flag, already-claimed skip, rate limiting,
 * passive aggregation threshold) lives in the
 * `record_external_artist_profile_interest_click` SECURITY DEFINER RPC
 * (`20260729120000_external_artist_profile_interest.sql`) — this route's
 * only job is to turn a non-null dispatch row into an actual email via
 * SendGrid, mirroring `src/app/api/price-inquiry-artist-email/route.ts`.
 *
 * Failure policy: this must never block or surface an error to the
 * viewer's flow. Missing SendGrid config, RPC errors, or SendGrid send
 * failures are all logged server-side and answered with 200.
 */

const APP_URL = "https://abstract-mvp-dxfn.vercel.app";

type DispatchRow = {
  external_artist_id: string;
  invite_email: string;
  display_name: string | null;
  trigger_kind_out: "explicit" | "aggregated";
  distinct_viewer_count: number;
  unsubscribe_token: string;
};

type RequestBody = {
  externalArtistId?: string;
  triggerKind?: "explicit" | "passive";
  context?: { exhibitionId?: string | null; artworkId?: string | null };
};

function parseFromHeader(raw: string) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*)<(.+@.+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "") || undefined;
    const email = match[2].trim();
    return { email, name };
  }
  return { email: trimmed, name: undefined as string | undefined };
}

function buildEmailHtml(row: DispatchRow) {
  const artist = row.display_name?.trim() || "Artist";
  const onboardingUrl = `${APP_URL}/onboarding`;
  const unsubscribeUrl = `${APP_URL}/unsubscribe/profile-interest-email/${row.unsubscribe_token}`;
  const countLineEn =
    row.distinct_viewer_count > 1
      ? `${row.distinct_viewer_count} people have`
      : "Someone has";
  const countLineKo = row.distinct_viewer_count > 1 ? "여러 명이" : "한 사람이";

  return `
  <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #111827;">
    <p style="font-size:14px; color:#4b5563; margin-bottom:24px;">EN / KO below</p>

    <h1 style="font-size:18px; font-weight:600; margin-bottom:12px;">Dear ${artist},</h1>

    <p>${countLineEn} shown interest in your work on <strong>Theo</strong>, an artist-centric platform for sharing works and building exhibitions with curators, galleries, and collectors.</p>

    <p>Join Theo to claim your profile, see how your work is being presented, and connect directly with the people asking about it.</p>

    <p style="margin:24px 0;">
      <a href="${onboardingUrl}"
         style="display:inline-block; padding:10px 18px; border-radius:9999px; background:#111827; color:#ffffff; text-decoration:none; font-size:14px;">
        Join Theo
      </a>
    </p>

    <p>Warm regards,<br/>The Theo team</p>

    <hr style="margin:32px 0; border:none; border-top:1px solid #e5e7eb;" />

    <h1 style="font-size:18px; font-weight:600; margin-bottom:12px;">${artist} 님께,</h1>

    <p>Theo에서 ${countLineKo} 회원님의 작품에 관심을 보이고 있습니다. Theo는 큐레이터·갤러리·컬렉터와 함께 작품과 전시를 소개하는 아티스트 중심 플랫폼입니다.</p>

    <p>Theo에 가입하시면 프로필을 직접 관리하고, 작품이 어떻게 소개되는지 확인하고, 관심을 보인 분들과 직접 연결되실 수 있습니다.</p>

    <p style="margin:24px 0;">
      <a href="${onboardingUrl}"
         style="display:inline-block; padding:10px 18px; border-radius:9999px; background:#111827; color:#ffffff; text-decoration:none; font-size:14px;">
        Theo 가입하기
      </a>
    </p>

    <p>감사합니다.<br/>Theo 드림</p>

    <hr style="margin:32px 0; border:none; border-top:1px solid #e5e7eb;" />

    <p style="font-size:12px; color:#9ca3af;">
      You're receiving this because a gallery/curator enabled profile-interest notifications for this address on Theo.
      <a href="${unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a> at any time.
      <br/>
      이 메일은 갤러리/큐레이터가 이 주소로 프로필 관심 알림을 활성화했기 때문에 발송되었습니다.
      언제든지 <a href="${unsubscribeUrl}" style="color:#6b7280;">수신거부</a>할 수 있습니다.
    </p>
  </div>
  `;
}

async function sendOne(row: DispatchRow, apiKey: string, fromRaw: string) {
  const from = parseFromHeader(fromRaw);
  const html = buildEmailHtml(row);
  const subjectEn = "Someone's interested in your work on Theo";
  const subjectKo = "누군가 회원님의 작품에 관심을 보이고 있어요";

  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: row.invite_email }],
          subject: `${subjectEn} / ${subjectKo}`,
        },
      ],
      from: from.name ? { email: from.email, name: from.name } : { email: from.email },
      content: [{ type: "text/html", value: html }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("[artist-profile-interest-email] SendGrid error", resp.status, text);
    return false;
  }
  return true;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as RequestBody | null;
    const externalArtistId = body?.externalArtistId;
    const triggerKind = body?.triggerKind;
    if (!externalArtistId || typeof externalArtistId !== "string") {
      return NextResponse.json({ error: "externalArtistId is required" }, { status: 400 });
    }
    if (triggerKind !== "explicit" && triggerKind !== "passive") {
      return NextResponse.json({ error: "triggerKind must be explicit or passive" }, { status: 400 });
    }

    const auth = await requireUserFromRequest(req);
    if (!auth.ok) return auth.response;

    const { data: rows, error: rpcError } = await auth.supabase.rpc(
      "record_external_artist_profile_interest_click",
      {
        p_external_artist_id: externalArtistId,
        p_trigger_kind: triggerKind,
        p_context: JSON.stringify({
          exhibition_id: body?.context?.exhibitionId ?? null,
          artwork_id: body?.context?.artworkId ?? null,
        }),
      }
    );

    if (rpcError) {
      console.error("[artist-profile-interest-email] dispatch RPC error", rpcError);
      return NextResponse.json({ ok: false, reason: "dispatch-error" }, { status: 200 });
    }

    const dispatchRows = (rows ?? []) as DispatchRow[];
    if (dispatchRows.length === 0) {
      return NextResponse.json({ ok: true, dispatched: false });
    }

    const apiKey = process.env.SENDGRID_API_KEY;
    const fromRaw = process.env.INVITE_FROM_EMAIL;
    if (!apiKey || !fromRaw) {
      console.warn("[artist-profile-interest-email] Missing SENDGRID_API_KEY or INVITE_FROM_EMAIL");
      return NextResponse.json({ ok: false, reason: "no-sendgrid" }, { status: 200 });
    }

    let sent = 0;
    for (const row of dispatchRows) {
      if (!row?.invite_email) continue;
      const ok = await sendOne(row, apiKey, fromRaw);
      if (ok) sent += 1;
    }

    return NextResponse.json({ ok: true, dispatched: sent > 0, sent });
  } catch (err) {
    console.error("[artist-profile-interest-email] unexpected error", err);
    return NextResponse.json({ ok: false, reason: "unexpected-error" }, { status: 200 });
  }
}
