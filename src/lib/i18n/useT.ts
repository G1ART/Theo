"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type Locale, getCookieLocale, setCookieLocale } from "./locale";
import { useLocaleFromContext } from "./LocaleContext";
import { messages } from "./messages";

/**
 * Access the current locale plus a translator `t()`.
 *
 * SSR / hydration safety
 *   The initial state seed is the locale that the root layout resolved
 *   from the request cookie (via `LocaleProvider`). Both the server
 *   render and the client's initial render therefore start with the
 *   same locale — no more React #418 text mismatches on Korean first-
 *   loads. If for any reason the provider is missing we degrade to
 *   `"en"` (never to `document.cookie`, which would reintroduce the
 *   asymmetry).
 *
 *   All lookups inside `t()` read only from state — never from the
 *   cookie mid-render — so a translation string is stable within a
 *   single render pass.
 *
 *   `useEffect` still resyncs from the cookie after mount so a locale
 *   changed in another tab (or by `setLocale()` elsewhere) propagates
 *   in without a manual reload.
 */
export function useT() {
  const router = useRouter();
  const seed = useLocaleFromContext();
  const [locale, setLocaleState] = useState<Locale>(seed ?? "en");

  useEffect(() => {
    const c = getCookieLocale();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (c && c !== locale) setLocaleState(c);
  }, [locale]);

  const t = useCallback(
    (key: string): string => {
      const m = messages[locale];
      const fallback = messages["en"];
      return (
        (m as Record<string, string>)[key] ??
        (fallback as Record<string, string>)[key] ??
        key
      );
    },
    [locale],
  );

  const setLocale = useCallback(
    (newLocale: Locale) => {
      setCookieLocale(newLocale);
      setLocaleState(newLocale);
      router.refresh();
    },
    [router],
  );

  return { locale, setLocale, t };
}
