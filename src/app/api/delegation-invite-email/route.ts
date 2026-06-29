import { NextResponse } from "next/server";

type Payload = {
  toEmail: string;
  inviterName?: string | null;
  scopeType: "account" | "project" | "inventory";
  projectTitle?: string | null;
  inviteToken: string;
};

function buildHtml(payload: Payload, acceptUrl: string) {
  const inviter = payload.inviterName?.trim() || "Someone";
  const scope =
    payload.scopeType === "account"
      ? "account management"
      : payload.scopeType === "project"
        ? "an exhibition"
        : "inventory";
  const projectLine =
    payload.scopeType === "project" && payload.projectTitle
      ? ` (“${payload.projectTitle}”)`
      : "";

  return `
  <div style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #111827;">
    <p><strong>${inviter}</strong> invited you to help manage ${scope}${projectLine} on Theo.</p>
    <p>After signing in or creating an account with this email, you can review the delegation scope and accept or decline.</p>
    <p style="margin:8px 0 24px; color:#6b7280; font-size:12px;">
      Signing up alone does not activate access — you'll explicitly review and accept on the next screen.
    </p>
    <p style="margin:24px 0;">
      <a href="${acceptUrl}"
         style="display:inline-block; padding:10px 18px; border-radius:9999px; background:#111827; color:#fff; text-decoration:none; font-size:14px;">
        Review the invitation
      </a>
    </p>
    <p style="color:#6b7280; font-size:12px;">If you didn’t expect this, you can ignore this email — nothing will happen.</p>
    <p>— Theo</p>
  </div>
  `;
}

function buildHtmlKo(payload: Payload, acceptUrl: string) {
  const inviter = payload.inviterName?.trim() || "누군가";
  const scope =
    payload.scopeType === "account"
      ? "계정 관리"
      : payload.scopeType === "project"
        ? "전시"
        : "인벤토리";
  const projectLine =
    payload.scopeType === "project" && payload.projectTitle
      ? ` (「${payload.projectTitle}」)`
      : "";

  return `
  <div style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #111827;">
    <p><strong>${inviter}</strong>님이 Theo에서 ${scope}${projectLine} 관리 권한을 함께 다뤄달라고 초대했어요.</p>
    <p>이 이메일 주소로 가입하거나 로그인하면 위임 내용을 확인하고 수락할 수 있어요.</p>
    <p style="margin:8px 0 24px; color:#6b7280; font-size:12px;">
      가입만으로는 권한이 활성화되지 않아요. 다음 화면에서 직접 확인 후 수락해야 활성화됩니다.
    </p>
    <p style="margin:24px 0;">
      <a href="${acceptUrl}"
         style="display:inline-block; padding:10px 18px; border-radius:9999px; background:#111827; color:#fff; text-decoration:none; font-size:14px;">
        초대 내용 확인하기
      </a>
    </p>
    <p style="color:#6b7280; font-size:12px;">예상치 못한 메일이라면 무시하셔도 됩니다 — 아무 일도 일어나지 않아요.</p>
    <p>— Theo</p>
  </div>
  `;
}

const FALLBACK_APP_BASE = "https://abstract-mvp-dxfn.vercel.app";

/**
 * Returns the app base URL used in invite links.
 *
 * Hard rules:
 *  - must be absolute http(s) URL
 *  - hostname must not be the Vercel marketing site (`vercel.com`)
 *  - production deploys must be https
 *
 * Any violation falls back to `FALLBACK_APP_BASE` so misconfigured envs
 * never ship users to a marketing page or a non-clickable link.
 */
function getAppBase(): string {
  const raw =
    (typeof process.env.NEXT_PUBLIC_APP_URL === "string" && process.env.NEXT_PUBLIC_APP_URL.trim()) ||
    (process.env.VERCEL_URL ? `https://${String(process.env.VERCEL_URL).trim()}` : null) ||
    FALLBACK_APP_BASE;
  const base = raw.startsWith("http") ? raw : `https://${raw}`;
  try {
    const parsed = new URL(base);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "vercel.com" || hostname === "www.vercel.com") {
      console.warn("delegation-invite-email: base was vercel.com, using fallback", { raw });
      return FALLBACK_APP_BASE;
    }
    if (parsed.protocol !== "https:" && hostname !== "localhost" && !hostname.startsWith("127.")) {
      console.warn("delegation-invite-email: non-https base rejected, using fallback", { raw });
      return FALLBACK_APP_BASE;
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return FALLBACK_APP_BASE;
  }
}

export async function POST(req: Request) {
  try {
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

    const html = buildHtml(body, acceptUrl) + "<hr/>" + buildHtmlKo(body, acceptUrl);

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
