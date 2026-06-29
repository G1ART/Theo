import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthBootstrap } from "@/components/AuthBootstrap";
import { Header } from "@/components/Header";
import { HtmlLangSync } from "@/components/HtmlLangSync";
import { MigrationGuard } from "@/components/MigrationGuard";
import { ProfileBootstrap } from "@/components/ProfileBootstrap";
import { RandomIdBanner } from "@/components/RandomIdBanner";
import { ActingAsProvider } from "@/context/ActingAsContext";
import { TourProvider } from "@/components/tour";
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

export const metadata: Metadata = {
  title: "Theo — Artist-centric community",
  description: "Share works, connect with artists and collectors.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        translate="no"
      >
        <HtmlLangSync />
        <AuthBootstrap />
        <MigrationGuard />
        <ProfileBootstrap />
        <ActingAsProvider>
          <TourProvider>
            <Header />
            <RandomIdBanner />
            {children}
          </TourProvider>
        </ActingAsProvider>
      </body>
    </html>
  );
}
