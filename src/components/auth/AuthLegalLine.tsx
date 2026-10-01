"use client";

import { useT } from "@/lib/i18n/useT";

/**
 * Passive consent line under signup Step 1. Copy stays in
 * `auth.signupV2.step2.legalTemplate` so the existing Korean sentence
 * is not rewritten.
 */
export function AuthLegalLine() {
  const { t } = useT();
  const template = t("auth.signupV2.step2.legalTemplate");
  const termsLabel = t("auth.signupV2.step2.termsLabel");
  const privacyLabel = t("auth.signupV2.step2.privacyLabel");
  const parts = template.split(/(\{terms\}|\{privacy\})/).filter((p) => p.length > 0);

  return (
    <p className="text-center text-[11px] leading-relaxed text-zinc-500">
      {parts.map((part, i) => {
        if (part === "{terms}") {
          return (
            <a
              key={i}
              href="/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900"
            >
              {termsLabel}
            </a>
          );
        }
        if (part === "{privacy}") {
          return (
            <a
              key={i}
              href="/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-zinc-400 underline-offset-2 hover:text-zinc-900"
            >
              {privacyLabel}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}
