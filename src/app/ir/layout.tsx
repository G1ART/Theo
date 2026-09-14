import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Theo — demo",
  robots: { index: false, follow: false },
};

export default function IrLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
