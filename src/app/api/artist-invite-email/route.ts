import { NextResponse } from "next/server";
import { isIrDemo } from "@/lib/irDemo/config";
import { appOrigin } from "@/lib/appOrigin";

type InvitePayload = {
  toEmail: string;
  artistName?: string | null;
  inviterName?: string | null;
  inviterRole?: "gallery" | "curator" | "both" | "other" | null;
  exhibitionTitle?: string | null;
};

function buildRoleLabel(role: InvitePayload["inviterRole"]) {
  switch (role) {
    case "gallery":
      return "gallery";
    case "curator":
      return "curator";
    case "both":
      return "gallery / curator";
    default:
      return "gallery / curator";
  }
}

function buildRoleLabelKo(role: InvitePayload["inviterRole"]) {
  switch (role) {
    case "gallery":
      return "갤러리";
    case "curator":
      return "큐레이터";
    case "both":
      return "갤러리/큐레이터";
    default:
      return "갤러리/큐레이터";
  }
}

function buildEmailHtml(payload: InvitePayload) {
  const artist = payload.artistName?.trim() || "Artist";
  const inviter = payload.inviterName?.trim() || "a gallery / curator";
  const inviterRole = buildRoleLabel(payload.inviterRole);
  const inviterRoleKo = buildRoleLabelKo(payload.inviterRole);
  const exhibition = payload.exhibitionTitle?.trim() || null;

  const exhibitionLineEn = exhibition
    ? `They are preparing the exhibition “${exhibition}” and would like to present your work there with your participation and consent.`
    : "";
  const exhibitionLineKo = exhibition
    ? `현재 “${exhibition}” 전시를 준비하며, 작가님의 동의와 함께 작품을 소개하고자 합니다.`
    : "";

  const inviterIntroEn = `A ${inviterRole} ${inviter} has added your work to their program on Theo and would like to invite you to join the platform.`;
  const inviterIntroKo = `${inviterRoleKo} ${inviter} 님이 Theo에서 ${artist} 님의 작품을 전시 프로그램에 포함하며, 함께 플랫폼에 참여해 주시기를 정중히 초청드립니다.`;

  const onboardingUrl = `${appOrigin()}/onboarding?email=${encodeURIComponent(
    payload.toEmail.trim(),
  )}`;

  return `
  <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #111827;">
    <p style="font-size:14px; color:#4b5563; margin-bottom:24px;">EN / KO below</p>

    <h1 style="font-size:18px; font-weight:600; margin-bottom:12px;">Dear ${artist},</h1>

    <p>You are being invited to join <strong>Theo</strong>, an artist‑centric platform for sharing works and building exhibitions with curators, galleries, and collectors.</p>

    <p>${inviterIntroEn}</p>
    ${exhibitionLineEn ? `<p>${exhibitionLineEn}</p>` : ""}

    <p>By joining Theo with this email address, you’ll be able to:</p>
    <ul>
      <li>review how your work is presented and update details yourself</li>
      <li>connect directly with curators and galleries who show your work</li>
      <li>keep a growing record of your exhibitions and provenance in one place</li>
    </ul>

    <p>To get started, create your account with <strong>this same email address</strong> using the button below. After you choose a password, open the activation email (check spam) before signing in.</p>

    <p style="margin:24px 0;">
      <a href="${onboardingUrl}"
         style="display:inline-block; padding:10px 18px; border-radius:9999px; background:#111827; color:#ffffff; text-decoration:none; font-size:14px;">
        Join Theo
      </a>
    </p>

    <p>Warm regards,<br/>The Theo team</p>

    <hr style="margin:32px 0; border:none; border-top:1px solid #e5e7eb;" />

    <h1 style="font-size:18px; font-weight:600; margin-bottom:12px;">${artist} 님께,</h1>

    <p>아티스트를 중심에 두고 전시와 커뮤니티를 만들어 가는 플랫폼 <strong>Theo</strong> 에</p>
    <p>${inviterIntroKo}</p>
    ${exhibitionLineKo ? `<p>${exhibitionLineKo}</p>` : ""}

    <p>Theo에 가입하시면:</p>
    <ul>
      <li>작품이 어떻게 소개되는지 직접 확인하고, 필요한 내용을 스스로 수정하실 수 있고</li>
      <li>작품을 전시·소개하는 큐레이터와 갤러리와 직접 연결되고</li>
      <li>전시 이력과 프로비넌스(소장·전시 기록)를 한 곳에 쌓아두실 수 있습니다.</li>
    </ul>

    <p>아래 버튼으로 <strong>이 이메일 주소 그대로</strong> 계정을 만들어 주세요.<br/>
    비밀번호를 정한 뒤 도착하는 활성화 메일(스팸함도 확인해 주세요)을 열어야 로그인됩니다.<br/>
    이미 올라간 작품과 전시는 그 계정으로 연결됩니다.</p>

    <p style="margin:24px 0;">
      <a href="${onboardingUrl}"
         style="display:inline-block; padding:10px 18px; border-radius:9999px; background:#111827; color:#ffffff; text-decoration:none; font-size:14px;">
        Theo 가입하기
      </a>
    </p>

    <p>감사합니다.<br/>Theo 드림</p>
  </div>
  `;
}

function parseFromHeader(raw: string) {
  // 지원: "Name <email@domain>" 또는 그냥 "email@domain"
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*)<(.+@.+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "") || undefined;
    const email = match[2].trim();
    return { email, name };
  }
  return { email: trimmed, name: undefined as string | undefined };
}

export async function POST(req: Request) {
  try {
    if (isIrDemo()) {
      return NextResponse.json({ ok: true, skipped: "ir_demo" });
    }
    const body = (await req.json()) as InvitePayload;

    if (!body.toEmail || typeof body.toEmail !== "string") {
      return NextResponse.json({ error: "toEmail is required" }, { status: 400 });
    }

    const apiKey = process.env.SENDGRID_API_KEY;
    const fromRaw = process.env.INVITE_FROM_EMAIL;

    if (!apiKey || !fromRaw) {
      console.error("Missing SENDGRID_API_KEY or INVITE_FROM_EMAIL");
      return NextResponse.json({ error: "Email configuration missing" }, { status: 500 });
    }

    const inviter = body.inviterName?.trim() || "a gallery / curator";

    const subjectEn = `Invitation from ${inviter} on Theo`;
    const subjectKo = `Theo에서 ${inviter}님이 초대합니다`;

    const html = buildEmailHtml(body);
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
            to: [{ email: body.toEmail }],
            subject: `${subjectEn} / ${subjectKo}`,
          },
        ],
        from: from.name ? { email: from.email, name: from.name } : { email: from.email },
        content: [{ type: "text/html", value: html }],
      }),
    });

    if (!resp.ok) {
    const text = await resp.text();
    console.error("SendGrid error", resp.status, text);
    return NextResponse.json(
      {
        error: "Failed to send invite email",
        sendgridStatus: resp.status,
        sendgridBody: text,
      },
      { status: 500 }
    );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("artist-invite-email error", err);
    const anyErr = err as any;
    return NextResponse.json(
      {
        error: "Unexpected error",
        message: anyErr?.message ? String(anyErr.message) : String(anyErr),
        stack: anyErr?.stack ?? null,
      },
      { status: 500 }
    );
  }
}

