/**
 * Shared shell for Theo mail. Korean block first, then English.
 * Callers escape any name or title before interpolating it.
 */

export const THEO_LOGO_URL = "https://withtheo.art/theo-logo.png";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function theoEmailButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;padding:12px 22px;border-radius:9999px;background:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">${label}</a>`;
}

export function renderTheoEmail(parts: { koHtml: string; enHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="ko">
<body style="margin:0;padding:0;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
          <tr>
            <td style="padding:28px 28px 0;">
              <img src="${THEO_LOGO_URL}" width="128" alt="Theo" style="display:block;width:128px;height:auto;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.65;color:#18181b;">
              ${parts.koHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px;">
              <div style="border-top:1px solid #e4e4e7;font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.65;color:#18181b;">
              ${parts.enHtml}
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:1.5;color:#71717a;">
          <a href="https://withtheo.art" style="color:#71717a;text-decoration:none;">Theo</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
