import { NextResponse } from "next/server";
import { requireUserFromRequest } from "@/lib/websiteImport/supabaseServer";

/**
 * QA 2026-07-29 (Part A) — opt-in price-inquiry email to external artists.
 *
 * Called (fire-and-forget) by the inquirer's client right after a price
 * inquiry is created. All of the actual eligibility logic (opt-in flag,
 * already-claimed skip, 30-day rate limit, per-inquiry dedupe) lives in
 * the `request_price_inquiry_email_dispatch` SECURITY DEFINER RPC
 * (`20260729100000_external_artist_inquiry_email.sql`) — this route's
 * only job is to turn the rows that RPC returns into actual emails via
 * SendGrid, mirroring `src/app/api/artist-invite-email/route.ts`.
 *
 * Failure policy: this must never block or surface an error to the
 * inquirer's flow. Missing SendGrid config, RPC errors, or SendGrid
 * send failures are all logged server-side and answered with 200.
 */

const APP_URL = "https://abstract-mvp-dxfn.vercel.app";

type DispatchRow = {
  external_artist_id: string;
  invite_email: string;
  display_name: string | null;
  inviter_display_name: string | null;
  artwork_title: string | null;
  unsubscribe_token: string;
  inquiry_id: string;
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
  const artworkTitle = row.artwork_title?.trim() || "your work";
  const inviter = row.inviter_display_name?.trim() || "A gallery/curator";
  const onboardingUrl = `${APP_URL}/onboarding`;
  const unsubscribeUrl = `${APP_URL}/unsubscribe/inquiry-email/${row.unsubscribe_token}`;

  return `
  <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #111827;">
    <p style="font-size:14px; color:#4b5563; margin-bottom:24px;">EN / KO below</p>

    <h1 style="font-size:18px; font-weight:600; margin-bottom:12px;">Dear ${artist},</h1>

    <p>Someone is asking about your work <strong>“${artworkTitle}”</strong> on <strong>Theo</strong>, an artist-centric platform for sharing works and building exhibitions with curators, galleries, and collectors.</p>

    <p>This message was sent to you because <strong>${inviter}</strong> uploaded your work on Theo and enabled inquiry notifications for this email address. Join Theo to reply to the inquiry directly and manage your works.</p>

    <p style="margin:24px 0;">
      <a href="${onboardingUrl}"
         style="display:inline-block; padding:10px 18px; border-radius:9999px; background:#111827; color:#ffffff; text-decoration:none; font-size:14px;">
        Join Theo
      </a>
    </p>

    <p>Warm regards,<br/>The Theo team</p>

    <hr style="margin:32px 0; border:none; border-top:1px solid #e5e7eb;" />

    <h1 style="font-size:18px; font-weight:600; margin-bottom:12px;">${artist} 님께,</h1>

    <p>누군가 Theo에서 회원님의 작품 <strong>“${artworkTitle}”</strong> 에 대해 가격을 문의했습니다. Theo는 큐레이터·갤러리·컬렉터와 함께 작품과 전시를 소개하는 아티스트 중심 플랫폼입니다.</p>

    <p>이 메일은 <strong>${inviter}</strong> 님이 Theo에 회원님의 작품을 업로드하며 이 이메일 주소로 문의 알림을 받도록 설정했기 때문에 발송되었습니다. Theo에 가입하시면 문의에 직접 답변하고 작품을 스스로 관리하실 수 있습니다.</p>

    <p style="margin:24px 0;">
      <a href="${onboardingUrl}"
         style="display:inline-block; padding:10px 18px; border-radius:9999px; background:#111827; color:#ffffff; text-decoration:none; font-size:14px;">
        Theo 가입하기
      </a>
    </p>

    <p>감사합니다.<br/>Theo 드림</p>

    <hr style="margin:32px 0; border:none; border-top:1px solid #e5e7eb;" />

    <p style="font-size:12px; color:#9ca3af;">
      You're receiving this because a gallery/curator enabled inquiry notifications for this address on Theo.
      <a href="${unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a> at any time.
      <br/>
      이 메일은 갤러리/큐레이터가 이 주소로 문의 알림을 활성화했기 때문에 발송되었습니다.
      언제든지 <a href="${unsubscribeUrl}" style="color:#6b7280;">수신거부</a>할 수 있습니다.
    </p>
  </div>
  `;
}

async function sendOne(row: DispatchRow, apiKey: string, fromRaw: string) {
  const from = parseFromHeader(fromRaw);
  const html = buildEmailHtml(row);
  const artworkTitle = row.artwork_title?.trim() || "your work";
  const subjectEn = `Someone is asking about "${artworkTitle}" on Theo`;
  const subjectKo = `“${artworkTitle}” 작품 가격 문의가 도착했습니다`;

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
    console.error("[price-inquiry-artist-email] SendGrid error", resp.status, text);
    return false;
  }
  return true;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { inquiryId?: string } | null;
    const inquiryId = body?.inquiryId;
    if (!inquiryId || typeof inquiryId !== "string") {
      return NextResponse.json({ error: "inquiryId is required" }, { status: 400 });
    }

    const auth = await requireUserFromRequest(req);
    if (!auth.ok) return auth.response;

    const { data: rows, error: rpcError } = await auth.supabase.rpc(
      "request_price_inquiry_email_dispatch",
      { p_inquiry_id: inquiryId }
    );

    if (rpcError) {
      console.error("[price-inquiry-artist-email] dispatch RPC error", rpcError);
      return NextResponse.json({ ok: false, reason: "dispatch-error" }, { status: 200 });
    }

    const dispatchRows = (rows ?? []) as DispatchRow[];
    if (dispatchRows.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    const apiKey = process.env.SENDGRID_API_KEY;
    const fromRaw = process.env.INVITE_FROM_EMAIL;
    if (!apiKey || !fromRaw) {
      console.warn("[price-inquiry-artist-email] Missing SENDGRID_API_KEY or INVITE_FROM_EMAIL");
      return NextResponse.json({ ok: false, reason: "no-sendgrid" }, { status: 200 });
    }

    let sent = 0;
    for (const row of dispatchRows) {
      if (!row?.invite_email) continue;
      const ok = await sendOne(row, apiKey, fromRaw);
      if (ok) sent += 1;
    }

    return NextResponse.json({ ok: true, sent, candidates: dispatchRows.length });
  } catch (err) {
    // Best-effort only — never let this block the inquirer's flow.
    console.error("[price-inquiry-artist-email] unexpected error", err);
    return NextResponse.json({ ok: false, reason: "unexpected-error" }, { status: 200 });
  }
}
