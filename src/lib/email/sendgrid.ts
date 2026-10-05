export type SendgridSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; unconfigured: true }
  | { ok: false; unconfigured: false; status: number };

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

/**
 * Send one HTML message through SendGrid.
 * Missing SENDGRID_API_KEY or INVITE_FROM_EMAIL is a hard failure:
 * callers must not tell the user the mail went out.
 */
export async function sendTheoHtmlEmail(args: {
  toEmail: string;
  subject: string;
  html: string;
}): Promise<SendgridSendResult> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const fromRaw = process.env.INVITE_FROM_EMAIL?.trim();
  if (!apiKey || !fromRaw) return { ok: false, unconfigured: true };

  const from = parseFromHeader(fromRaw);
  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: args.toEmail }], subject: args.subject }],
      from: from.name ? { email: from.email, name: from.name } : { email: from.email },
      content: [{ type: "text/html", value: args.html }],
    }),
  });

  if (!resp.ok) {
    console.error("SendGrid invite", resp.status);
    return { ok: false, unconfigured: false, status: resp.status };
  }

  const messageId = resp.headers.get("x-message-id")?.trim() || null;
  return { ok: true, messageId };
}
