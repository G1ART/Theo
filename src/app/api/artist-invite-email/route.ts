import { NextResponse } from "next/server";
import { isIrDemo } from "@/lib/irDemo/config";
import { appOrigin } from "@/lib/appOrigin";
import { escapeHtml, renderTheoEmail, theoEmailButton } from "@/lib/email/theoEmail";
import { sendTheoHtmlEmail } from "@/lib/email/sendgrid";
import { shouldSendOnboardingEmail, type OnboardingEmailState } from "@/lib/invites/deliveryPolicy";
import { getServiceClient } from "@/lib/supabase/serviceClient";
import { requireUserFromRequest } from "@/lib/websiteImport/supabaseServer";

type InvitePayload = {
  toEmail?: string;
  artistName?: string | null;
  inviterName?: string | null;
  inviterRole?: "gallery" | "curator" | "both" | "other" | null;
  exhibitionTitle?: string | null;
  externalArtistId?: string | null;
  resend?: boolean;
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
    (payload.toEmail ?? "").trim(),
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

const ONBOARDING_STATES = new Set<OnboardingEmailState>(["none", "unsent", "sent", "claimed"]);

function asOnboardingState(value: unknown): OnboardingEmailState {
  const text = typeof value === "string" ? value : "";
  return ONBOARDING_STATES.has(text as OnboardingEmailState) ? (text as OnboardingEmailState) : "none";
}

async function markOnboardingSent(toEmail: string, messageId: string | null) {
  const admin = getServiceClient();
  if (!admin) {
    console.error("record_external_artist_invite_email: service role missing");
    return;
  }
  const { error } = await admin.rpc("record_external_artist_invite_email", {
    p_email: toEmail,
    p_message_id: messageId,
  });
  if (error) console.error("record_external_artist_invite_email", error.message);
}

export async function POST(req: Request) {
  try {
    if (isIrDemo()) {
      return NextResponse.json({ ok: true, emailed: false, skipped: "ir_demo" });
    }

    const auth = await requireUserFromRequest(req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as InvitePayload | null;
    if (!body) {
      return NextResponse.json({ ok: false, emailed: false, error: "invalid" }, { status: 400 });
    }
    const explicitResend = body.resend === true;
    const externalArtistId = body.externalArtistId?.trim() || "";

    let toEmail = "";
    let artistName = body.artistName ?? null;
    let state: OnboardingEmailState = "none";

    if (externalArtistId) {
      const { data, error } = await auth.supabase.rpc("prepare_external_artist_invite_email", {
        p_external_artist_id: externalArtistId,
        p_resend: explicitResend,
      });
      if (error) {
        console.error("prepare_external_artist_invite_email", error.message);
        return NextResponse.json({ ok: false, emailed: false, error: "send_failed" }, { status: 502 });
      }
      const prepared = (data ?? {}) as {
        ok?: boolean;
        code?: string;
        dispatch?: boolean;
        already_sent?: boolean;
        to_email?: string;
        artist_name?: string | null;
      };
      if (!prepared.ok) {
        const code = prepared.code === "missing_email"
          || prepared.code === "permission_denied"
          || prepared.code === "not_found"
          || prepared.code === "already_onboarded"
          ? prepared.code
          : "not_found";
        const status = code === "permission_denied" ? 403 : code === "missing_email" ? 422 : 404;
        if (code === "already_onboarded") {
          return NextResponse.json({ ok: true, emailed: false, alreadySent: true });
        }
        return NextResponse.json({ ok: false, emailed: false, error: code }, { status });
      }
      if (!prepared.dispatch || prepared.already_sent) {
        return NextResponse.json({ ok: true, emailed: false, alreadySent: true });
      }
      toEmail = prepared.to_email?.trim() ?? "";
      artistName = artistName ?? prepared.artist_name ?? null;
    } else {
      toEmail = body.toEmail?.trim() ?? "";
      if (!toEmail) {
        return NextResponse.json({ ok: false, emailed: false, error: "toEmail is required" }, { status: 400 });
      }
      const { data: stateRaw } = await auth.supabase.rpc("external_artist_invite_email_state", {
        p_email: toEmail,
      });
      state = asOnboardingState(stateRaw);
      if (!shouldSendOnboardingEmail({ state, explicitResend })) {
        return NextResponse.json({ ok: true, emailed: false, alreadySent: true });
      }
    }

    if (!toEmail) {
      return NextResponse.json({ ok: false, emailed: false, error: "missing_email" }, { status: 422 });
    }

    const inviter = body.inviterName?.trim() || "a gallery / curator";
    const subject = `Invitation from ${inviter} on Theo / Theo에서 ${inviter}님이 초대합니다`;
    const html = buildEmailHtml({
      toEmail,
      artistName,
      inviterName: body.inviterName,
      inviterRole: body.inviterRole,
      exhibitionTitle: body.exhibitionTitle,
    });

    const sent = await sendTheoHtmlEmail({ toEmail, subject, html });
    if (!sent.ok && sent.unconfigured) {
      return NextResponse.json({ ok: false, emailed: false, error: "email_unconfigured" }, { status: 503 });
    }
    if (!sent.ok) {
      return NextResponse.json({ ok: false, emailed: false, error: "send_failed" }, { status: 502 });
    }

    await markOnboardingSent(toEmail, sent.messageId);
    return NextResponse.json({ ok: true, emailed: true, alreadySent: false });
  } catch (err) {
    console.error("artist-invite-email error", err);
    return NextResponse.json({ ok: false, emailed: false, error: "unexpected" }, { status: 500 });
  }
}

