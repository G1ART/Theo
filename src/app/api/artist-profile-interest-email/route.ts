import { NextResponse } from "next/server";
import { requireUserFromRequest } from "@/lib/websiteImport/supabaseServer";
import { isIrDemo } from "@/lib/irDemo/config";
import { appOrigin } from "@/lib/appOrigin";
import { escapeHtml, renderTheoEmail, theoEmailButton } from "@/lib/email/theoEmail";

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
  const artist = escapeHtml(row.display_name?.trim() || "Artist");
  const origin = appOrigin();
  const onboardingUrl = `${origin}/onboarding?email=${encodeURIComponent(row.invite_email)}`;
  const unsubscribeUrl = `${origin}/unsubscribe/profile-interest-email/${row.unsubscribe_token}`;
  const countLineEn =
    row.distinct_viewer_count > 1
      ? `${row.distinct_viewer_count} people have`
      : "Someone has";
  const countLineKo = row.distinct_viewer_count > 1 ? "여러 명이" : "한 사람이";
  const foot = `<p style="margin:20px 0 0;font-size:12px;color:#71717a;">이 메일은 갤러리 또는 큐레이터가 이 주소로 프로필 관심 알림을 켜 두었기 때문에 발송되었습니다. <a href="${unsubscribeUrl}" style="color:#71717a;">수신거부</a><br/>You're receiving this because profile-interest notifications were turned on for this address. <a href="${unsubscribeUrl}" style="color:#71717a;">Unsubscribe</a></p>`;

  return renderTheoEmail({
    koHtml: `<h1 style="margin:0 0 12px;font-size:20px;">${artist} 님께</h1>
<p style="margin:0 0 12px;">Theo에서 ${countLineKo} 작품에 관심을 보이고 있습니다.</p>
<p style="margin:0 0 20px;">가입하면 프로필을 직접 관리하고, 작품이 어떻게 소개되는지 확인하고, 관심을 보인 사람과 연결될 수 있습니다.</p>
<p style="margin:0 0 20px;">${theoEmailButton(onboardingUrl, "Theo 가입하기")}</p>
<p style="margin:0;">감사합니다.<br/>Theo</p>`,
    enHtml: `<h1 style="margin:0 0 12px;font-size:20px;">Dear ${artist},</h1>
<p style="margin:0 0 12px;">${countLineEn} shown interest in your work on Theo.</p>
<p style="margin:0 0 20px;">Join Theo to claim your profile, see how the work is presented, and connect with the people asking about it.</p>
<p style="margin:0 0 20px;">${theoEmailButton(onboardingUrl, "Join Theo")}</p>
<p style="margin:0;">Warm regards,<br/>Theo</p>
${foot}`,
  });
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
    if (isIrDemo()) {
      return NextResponse.json({ ok: true, skipped: "ir_demo" });
    }
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
