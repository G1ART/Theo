import { NextResponse } from "next/server";
import { isIrDemo } from "@/lib/irDemo/config";
import { appOrigin } from "@/lib/appOrigin";
import { escapeHtml, renderTheoEmail, theoEmailButton } from "@/lib/email/theoEmail";

type Payload = {
  toEmail: string;
  inviterName?: string | null;
  scopeType: "account" | "project" | "inventory";
  projectTitle?: string | null;
  inviteToken: string;
};

function buildHtml(payload: Payload, acceptUrl: string) {
  const inviter = escapeHtml(payload.inviterName?.trim() || "Someone");
  const inviterKo = escapeHtml(payload.inviterName?.trim() || "누군가");
  const scopeEn =
    payload.scopeType === "account"
      ? "account management"
      : payload.scopeType === "project"
        ? "an exhibition"
        : "inventory";
  const scopeKo =
    payload.scopeType === "account"
      ? "계정 관리"
      : payload.scopeType === "project"
        ? "전시"
        : "인벤토리";
  const project = payload.projectTitle?.trim() ? escapeHtml(payload.projectTitle.trim()) : "";
  const projectEn = payload.scopeType === "project" && project ? ` (“${project}”)` : "";
  const projectKo = payload.scopeType === "project" && project ? ` (「${project}」)` : "";

  return renderTheoEmail({
    koHtml: `<p style="margin:0 0 12px;"><strong>${inviterKo}</strong>님이 Theo에서 ${scopeKo}${projectKo} 관리를 함께 해 달라고 초대했습니다.</p>
<p style="margin:0 0 12px;">이 이메일 주소로 가입하거나 로그인한 뒤, 위임 내용을 확인하고 수락할 수 있습니다.</p>
<p style="margin:0 0 20px;font-size:13px;color:#71717a;">가입만으로는 권한이 켜지지 않습니다. 다음 화면에서 직접 확인한 뒤에 수락해야 합니다.</p>
<p style="margin:0 0 20px;">${theoEmailButton(acceptUrl, "초대 내용 확인하기")}</p>
<p style="margin:0;font-size:13px;color:#71717a;">예상하지 못한 메일이라면 무시하셔도 됩니다.</p>`,
    enHtml: `<p style="margin:0 0 12px;"><strong>${inviter}</strong> invited you to help manage ${scopeEn}${projectEn} on Theo.</p>
<p style="margin:0 0 12px;">After signing in or creating an account with this email, you can review the delegation and accept or decline.</p>
<p style="margin:0 0 20px;font-size:13px;color:#71717a;">Signing up alone does not turn access on. You review and accept on the next screen.</p>
<p style="margin:0 0 20px;">${theoEmailButton(acceptUrl, "Review the invitation")}</p>
<p style="margin:0;font-size:13px;color:#71717a;">If you didn't expect this, you can ignore this email.</p>`,
  });
}

function getAppBase(): string {
  return appOrigin();
}

export async function POST(req: Request) {
  try {
    if (isIrDemo()) {
      return NextResponse.json({ ok: true, skipped: "ir_demo" });
    }
    const body = (await req.json()) as Payload;
    if (!body.toEmail || typeof body.toEmail !== "string") {
      return NextResponse.json({ error: "toEmail required" }, { status: 400 });
    }
    if (!body.inviteToken || typeof body.inviteToken !== "string") {
      return NextResponse.json({ error: "inviteToken required" }, { status: 400 });
    }

    const base = getAppBase();
    const acceptUrl = `${base}/invites/delegation?token=${encodeURIComponent(body.inviteToken)}`;

    const apiKey = process.env.SENDGRID_API_KEY;
    const fromRaw = process.env.INVITE_FROM_EMAIL;
    if (!apiKey || !fromRaw) {
      console.error("Missing SENDGRID_API_KEY or INVITE_FROM_EMAIL");
      return NextResponse.json({ error: "Email configuration missing" }, { status: 500 });
    }

    const inviter = body.inviterName?.trim() || "Someone";
    const subjectEn = `${inviter} invited you to review a delegation on Theo`;
    const subjectKo = `Theo에서 ${inviter}님이 위임 내용을 보내셨어요 — 확인 후 수락해 주세요`;

    const html = buildHtml(body, acceptUrl);

    const fromMatch = fromRaw.trim().match(/^(.*)<(.+@.+)>$/);
    const from = fromMatch
      ? { email: fromMatch[2].trim(), name: fromMatch[1].trim().replace(/^"|"$/g, "") || undefined }
      : { email: fromRaw.trim(), name: undefined as string | undefined };

    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: body.toEmail }], subject: `${subjectEn} / ${subjectKo}` }],
        from: from.name ? { email: from.email, name: from.name } : { email: from.email },
        content: [{ type: "text/html", value: html }],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("SendGrid delegation invite", resp.status, text);
      return NextResponse.json(
        { error: "Failed to send invite email", sendgridStatus: resp.status },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("delegation-invite-email", err);
    return NextResponse.json(
      { error: "Unexpected error", message: (err as Error)?.message },
      { status: 500 }
    );
  }
}
