import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { AuthBootstrap } from "@/components/AuthBootstrap";
import { ExistingUserCompletionBanner } from "@/components/auth/ExistingUserCompletionBanner";
import { Header } from "@/components/Header";
import { HtmlLangSync } from "@/components/HtmlLangSync";
import { MigrationGuard } from "@/components/MigrationGuard";
import { ProfileBootstrap } from "@/components/ProfileBootstrap";
import { RandomIdBanner } from "@/components/RandomIdBanner";
import { ActingAsProvider } from "@/context/ActingAsContext";
import { TourProvider } from "@/components/tour";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import {
  LOCALE_COOKIE,
  defaultLocaleFromRequest,
  normalizeLocale,
  type Locale,
} from "@/lib/i18n/locale";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  adjustFontFallback: true,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// SUIT — the Theo brand UI typeface. Covers both Hangul and Latin, so it is
// the primary font for every locale. Self-hosted (next/font/local) with a
// subset of weights (300–800) that the design system actually uses.
const suit = localFont({
  variable: "--font-suit",
  display: "swap",
  src: [
    { path: "./fonts/SUIT-Light.otf", weight: "300", style: "normal" },
    { path: "./fonts/SUIT-Regular.otf", weight: "400", style: "normal" },
    { path: "./fonts/SUIT-Medium.otf", weight: "500", style: "normal" },
    { path: "./fonts/SUIT-SemiBold.otf", weight: "600", style: "normal" },
    { path: "./fonts/SUIT-Bold.otf", weight: "700", style: "normal" },
    { path: "./fonts/SUIT-ExtraBold.otf", weight: "800", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "Theo — Artist-centric community",
  description: "Share works, connect with artists and collectors.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the SSR locale from the request so that server- and
  // client-rendered translations agree during hydration.
  //
  // 1) Explicit user pick lives in the `ab_locale` cookie — trust it.
  // 2) First-visit fallback: Vercel geo + Accept-Language via
  //    `defaultLocaleFromRequest`.
  //
  // Without this seed, `useT()` used to start with `"en"` on the server
  // and jump to `"ko"` on the client (from `document.cookie`), producing
  // React #418 text mismatches that in turn made React 19 regenerate the
  // tree client-side (which reset the TheoLogo reveal timer).
  const cookieStore = await cookies();
  const hdrs = await headers();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value ?? null;
  const initialLocale: Locale = cookieLocale
    ? normalizeLocale(cookieLocale)
    : defaultLocaleFromRequest(hdrs);

  return (
    <html lang={initialLocale}>
      <body
        className={`${suit.variable} ${geistSans.variable} ${geistMono.variable} antialiased`}
        translate="no"
      >
        <LocaleProvider initialLocale={initialLocale}>
          <HtmlLangSync />
          <AuthBootstrap />
          <MigrationGuard />
          <ProfileBootstrap />
          <ActingAsProvider>
            <TourProvider>
              <Header />
              <RandomIdBanner />
              <ExistingUserCompletionBanner />
              {children}
            </TourProvider>
          </ActingAsProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
