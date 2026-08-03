"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "./locale";

/**
 * Locale that the server determined for this request (from the
 * `ab_locale` cookie, falling back to Accept-Language / Vercel geo).
 *
 * Consumed by `useT()` as the SSR-stable seed for its local state so
 * server and client renders start with the same locale — this closes
 * the hydration mismatch that used to fire React error #418 whenever a
 * Korean visitor hit a page for the first time.
 *
 * Value is `null` only if the tree is (incorrectly) rendered outside
 * the provider; `useT()` degrades gracefully in that case.
 */
export const LocaleContext = createContext<Locale | null>(null);

export function useLocaleFromContext(): Locale | null {
  return useContext(LocaleContext);
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={initialLocale}>
      {children}
    </LocaleContext.Provider>
  );
}
