import { NextResponse } from "next/server";
import { isIrDemo } from "@/lib/irDemo/config";
import { buildDelegationInviteHtml } from "@/lib/email/delegationInviteHtml";
import { sendTheoHtmlEmail } from "@/lib/email/sendgrid";
import {
  decideInviteDelivery,
  shouldDispatchInviteEmail,
} from "@/lib/invites/deliveryPolicy";
import { requireUserFromRequest } from "@/lib/websiteImport/supabaseServer";

type Body = {
  delegationId?: string;
  resend?: boolean;
};

/**
 * Mail a delegation invite the caller already owns.
 * The address and token come from the delegation row, not the request body.
 * A missing mail key returns 503 and does not mark the invite as sent.
 */
export async function POST(req: Request) {
  try {
    if (isIrDemo()) {
      return NextResponse.json({ ok: true, emailed: false, skipped: "ir_demo" });
    }

    const auth = await requireUserFromRequest(req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => null)) as Body | null;
    const delegationId = body?.delegationId?.trim() ?? "";
    if (!delegationId) {
      return NextResponse.json({ ok: false, emailed: false, error: "delegationId required" }, { status: 400 });
    }
    const explicitResend = body?.resend === true;

    const { data: row, error: rowError } = await auth.supabase
      .from("delegations")
      .select(
        "id, status, expires_at, invite_email_sent_at, delegate_email, invite_token, scope_type, project_id",
      )
      .eq("id", delegationId)
      .maybeSingle();

    if (rowError || !row) {
      return NextResponse.json({ ok: false, emailed: false, error: "not_found" }, { status: 404 });
    }

    const decision = decideInviteDelivery({
      status: String(row.status ?? ""),
      emailSentAt: (row.invite_email_sent_at as string | null) ?? null,
      expiresAt: (row.expires_at as string | null) ?? null,
    });

    if (!shouldDispatchInviteEmail(decision, explicitResend)) {
      if (decision.kind === "offer_resend") {
        return NextResponse.json({ ok: true, emailed: false, alreadySent: true });
      }
      return NextResponse.json(
        { ok: false, emailed: false, error: decision.kind === "block_active" ? "blocked" : "not_found" },
        { status: 409 },
      );
    }

    const toEmail = String(row.delegate_email ?? "").trim();
    const inviteToken = String(row.invite_token ?? "").trim();
    if (!toEmail || !inviteToken) {
      return NextResponse.json({ ok: false, emailed: false, error: "missing_email" }, { status: 422 });
    }

    const scopeType = row.scope_type === "project" || row.scope_type === "inventory" ? row.scope_type : "account";
    let projectTitle: string | null = null;
    if (scopeType === "project" && row.project_id) {
      const { data: project } = await auth.supabase
        .from("projects")
        .select("title")
        .eq("id", row.project_id)
        .maybeSingle();
      projectTitle = project?.title ?? null;
    }

    const { data: profile } = await auth.supabase
      .from("profiles")
      .select("display_name, username")
      .eq("id", auth.userId)
      .maybeSingle();
    const inviterName = profile?.display_name?.trim() || profile?.username?.trim() || null;

    const { html, subject } = buildDelegationInviteHtml({
      inviterName,
      scopeType,
      projectTitle,
      inviteToken,
    });

    const sent = await sendTheoHtmlEmail({ toEmail, subject, html });
    if (!sent.ok && sent.unconfigured) {
      return NextResponse.json({ ok: false, emailed: false, error: "email_unconfigured" }, { status: 503 });
    }
    if (!sent.ok) {
      return NextResponse.json({ ok: false, emailed: false, error: "send_failed" }, { status: 502 });
    }

    const { error: markError } = await auth.supabase.rpc("record_delegation_invite_email", {
      p_delegation_id: row.id,
      p_message_id: sent.messageId,
    });
    if (markError) {
      console.error("record_delegation_invite_email", markError.message);
    }

    return NextResponse.json({ ok: true, emailed: true, alreadySent: false });
  } catch (err) {
    console.error("delegation-invite-email", err);
    return NextResponse.json({ ok: false, emailed: false, error: "unexpected" }, { status: 500 });
  }
}
