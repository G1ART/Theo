"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n/useT";
import {
  clearOAuthAttempt,
  consumeOAuthAttempt,
  consumeOAuthAttemptForMount,
  messageKeyForOAuthCode,
  oauthKindFromParam,
  resetOAuthAttemptMountCache,
  type OAuthAttempt,
} from "@/lib/auth/oauthSignup";

/** Notice when Google sent the browser back, or the person left Google
 *  and landed on the form again. Email-link failures do not come here. */
export function useOAuthReturnNotice(): string | null {
  const params = useSearchParams();
  const { t } = useT();
  const queryKind = oauthKindFromParam(params.get("oauth"));
  // The server render cannot see sessionStorage. Read it after mount,
  // or a return from Google hydrates as if the attempt never happened.
  const [stored, setStored] = useState<OAuthAttempt | null>(null);

  useEffect(() => {
    if (queryKind) {
      clearOAuthAttempt();
      return;
    }
    const attempt = consumeOAuthAttemptForMount();
    if (attempt) setStored(attempt);
    const id = window.setTimeout(() => resetOAuthAttemptMountCache(), 0);
    return () => window.clearTimeout(id);
  }, [queryKind]);

  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted || queryKind) return;
      const attempt = consumeOAuthAttempt();
      if (attempt) setStored(attempt);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [queryKind]);

  const kind = queryKind ?? (stored ? "unfinished" : null);
  if (!kind) return null;
  return t(messageKeyForOAuthCode(kind));
}
