import { NextResponse } from "next/server";
import { requireUserFromRequest } from "@/lib/websiteImport/supabaseServer";
import { isIrDemo } from "@/lib/irDemo/config";
import { appOrigin } from "@/lib/appOrigin";
import { escapeHtml, renderTheoEmail, theoEmailButton } from "@/lib/email/theoEmail";

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
  const artist = escapeHtml(row.display_name?.trim() || "Artist");
  const artworkTitle = escapeHtml(row.artwork_title?.trim() || "your work");
  const inviter = escapeHtml(row.inviter_display_name?.trim() || "A gallery/curator");
  const origin = appOrigin();
  const onboardingUrl = `${origin}/onboarding?email=${encodeURIComponent(row.invite_email)}`;
  const unsubscribeUrl = `${origin}/unsubscribe/inquiry-email/${row.unsubscribe_token}`;
  const foot = `<p style="margin:20px 0 0;font-size:12px;color:#71717a;">이 메일은 갤러리 또는 큐레이터가 이 주소로 문의 알림을 켜 두었기 때문에 발송되었습니다. <a href="${unsubscribeUrl}" style="color:#71717a;">수신거부</a><br/>You're receiving this because inquiry notifications were turned on for this address. <a href="${unsubscribeUrl}" style="color:#71717a;">Unsubscribe</a></p>`;

  return renderTheoEmail({
    koHtml: `<h1 style="margin:0 0 12px;font-size:20px;">${artist} 님께</h1>
<p style="margin:0 0 12px;">누군가 Theo에서 작품 <strong>“${artworkTitle}”</strong>의 가격을 문의했습니다.</p>
<p style="margin:0 0 20px;"><strong>${inviter}</strong> 님이 작품을 올리며 이 주소로 알림을 받도록 설정했습니다. 가입하면 문의에 답하고 작품을 직접 관리할 수 있습니다.</p>
<p style="margin:0 0 20px;">${theoEmailButton(onboardingUrl, "Theo 가입하기")}</p>
<p style="margin:0;">감사합니다.<br/>Theo</p>`,
    enHtml: `<h1 style="margin:0 0 12px;font-size:20px;">Dear ${artist},</h1>
<p style="margin:0 0 12px;">Someone is asking about <strong>“${artworkTitle}”</strong> on Theo.</p>
<p style="margin:0 0 20px;"><strong>${inviter}</strong> uploaded the work and turned on inquiry notifications for this address. Join Theo to reply and manage the work yourself.</p>
<p style="margin:0 0 20px;">${theoEmailButton(onboardingUrl, "Join Theo")}</p>
<p style="margin:0;">Warm regards,<br/>Theo</p>
${foot}`,
  });
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
    if (isIrDemo()) {
      return NextResponse.json({ ok: true, sent: 0, skipped: "ir_demo" });
    }
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
