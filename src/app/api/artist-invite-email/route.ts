import { NextResponse } from "next/server";
import { isIrDemo } from "@/lib/irDemo/config";
import { appOrigin } from "@/lib/appOrigin";
import { escapeHtml, renderTheoEmail, theoEmailButton } from "@/lib/email/theoEmail";

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
  const artist = escapeHtml(payload.artistName?.trim() || "Artist");
  const inviter = escapeHtml(payload.inviterName?.trim() || "a gallery / curator");
  const inviterRole = buildRoleLabel(payload.inviterRole);
  const inviterRoleKo = buildRoleLabelKo(payload.inviterRole);
  const exhibition = payload.exhibitionTitle?.trim()
    ? escapeHtml(payload.exhibitionTitle.trim())
    : null;

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

  return renderTheoEmail({
    koHtml: `
    <h1 style="margin:0 0 12px;font-size:20px;">${artist} 님께</h1>
    <p style="margin:0 0 12px;">아티스트를 중심에 두고 전시와 커뮤니티를 만들어 가는 플랫폼 Theo에 초대합니다.</p>
    <p style="margin:0 0 12px;">${inviterIntroKo}</p>
    ${exhibitionLineKo ? `<p style="margin:0 0 12px;">${exhibitionLineKo}</p>` : ""}
    <p style="margin:0 0 8px;">Theo에 가입하시면</p>
    <ul style="margin:0 0 16px;padding-left:18px;">
      <li>작품이 어떻게 소개되는지 직접 확인하고, 필요한 내용을 스스로 수정하실 수 있고</li>
      <li>작품을 전시·소개하는 큐레이터와 갤러리와 직접 연결되고</li>
      <li>전시 이력과 프로비넌스를 한 곳에 쌓아두실 수 있습니다.</li>
    </ul>
    <p style="margin:0 0 20px;">아래 버튼으로 <strong>이 이메일 주소 그대로</strong> 계정을 만들어 주세요. 비밀번호를 정한 뒤 도착하는 활성화 메일을 열어야 로그인됩니다. 이미 올라간 작품과 전시는 그 계정으로 연결됩니다.</p>
    <p style="margin:0 0 20px;">${theoEmailButton(onboardingUrl, "Theo 가입하기")}</p>
    <p style="margin:0;">감사합니다.<br/>Theo</p>
    `,
    enHtml: `
    <h1 style="margin:0 0 12px;font-size:20px;">Dear ${artist},</h1>
    <p style="margin:0 0 12px;">You are invited to join Theo, an artist-centric platform for sharing works and building exhibitions with curators, galleries, and collectors.</p>
    <p style="margin:0 0 12px;">${inviterIntroEn}</p>
    ${exhibitionLineEn ? `<p style="margin:0 0 12px;">${exhibitionLineEn}</p>` : ""}
    <p style="margin:0 0 8px;">By joining Theo with this email address, you can:</p>
    <ul style="margin:0 0 16px;padding-left:18px;">
      <li>review how your work is presented and update details yourself</li>
      <li>connect directly with curators and galleries who show your work</li>
      <li>keep a growing record of your exhibitions and provenance in one place</li>
    </ul>
    <p style="margin:0 0 20px;">Create your account with <strong>this same email address</strong>. After you choose a password, open the activation email before signing in.</p>
    <p style="margin:0 0 20px;">${theoEmailButton(onboardingUrl, "Join Theo")}</p>
    <p style="margin:0;">Warm regards,<br/>Theo</p>
    `,
  });
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

