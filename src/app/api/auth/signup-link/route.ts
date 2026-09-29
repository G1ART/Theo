import { NextResponse } from "next/server";
import { isIrDemo } from "@/lib/irDemo/config";
import { getServiceClient } from "@/lib/supabase/serviceClient";
import { appOrigin } from "@/lib/appOrigin";
import { renderTheoEmail, theoEmailButton } from "@/lib/email/theoEmail";

/**
 * Send the account-activation link through SendGrid.
 *
 * Supabase's built-in confirmation mail often never arrives (default
 * SMTP rate limits), which left invited artists on "Check your email"
 * with an empty inbox. This route mints a one-time link for an
 * existing, still-unconfirmed user and delivers it on the same mail
 * path as gallery invites.
 *
 * The response is always a generic success when the address is merely
 * unknown, so this endpoint does not become an account oracle beyond
 * what signup already reveals.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function activationHtml(link: string) {
  return renderTheoEmail({
    koHtml: `<h1 style="margin:0 0 12px;font-size:20px;">Theo 계정 만들기를 마무리해 주세요</h1>
<p style="margin:0 0 12px;">이 이메일로 가입이 시작됐습니다. 아래 버튼을 누르면 계정이 활성화되고, 이어서 프로필을 설정할 수 있습니다.</p>
<p style="margin:0 0 20px;">${theoEmailButton(link, "계정 활성화")}</p>
<p style="margin:0;font-size:13px;color:#71717a;">Theo 가입을 시도하지 않으셨다면 이 메일은 무시하셔도 됩니다.</p>`,
    enHtml: `<h1 style="margin:0 0 12px;font-size:20px;">Finish creating your Theo account</h1>
<p style="margin:0 0 12px;">Your account is waiting on this email address. Open the button below to activate it, then continue setting up your profile.</p>
<p style="margin:0 0 20px;">${theoEmailButton(link, "Activate account")}</p>
<p style="margin:0;font-size:13px;color:#71717a;">If you didn't try to join Theo, you can ignore this email.</p>`,
  });
}

export async function POST(req: Request) {
  try {
    if (isIrDemo()) {
      return NextResponse.json({ ok: true, skipped: "ir_demo" });
    }
    const body = (await req.json().catch(() => null)) as { email?: string } | null;
    const email = body?.email?.trim().toLowerCase() ?? "";
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const admin = getServiceClient();
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromRaw = process.env.INVITE_FROM_EMAIL;
    if (!admin || !apiKey || !fromRaw) {
      return NextResponse.json({ error: "email_unconfigured" }, { status: 503 });
    }

    const redirectTo = `${appOrigin()}/auth/callback`;
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    const link = data?.properties?.action_link;
    if (error || !link) {
      const msg = (error?.message ?? "").toLowerCase();
      const missing =
        msg.includes("not found") || msg.includes("user with this email");
      if (missing) return NextResponse.json({ ok: true });
      console.error("signup-link generateLink", error);
      return NextResponse.json({ error: "link_failed" }, { status: 502 });
    }

    const from = parseFromHeader(fromRaw);
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email }],
            subject: "Activate your Theo account / Theo 계정을 활성화해 주세요",
          },
        ],
        from: from.name ? { email: from.email, name: from.name } : { email: from.email },
        content: [{ type: "text/html", value: activationHtml(link) }],
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("signup-link SendGrid error", resp.status, text);
      return NextResponse.json({ error: "send_failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("signup-link error", err);
    return NextResponse.json({ error: "unexpected" }, { status: 500 });
  }
}
