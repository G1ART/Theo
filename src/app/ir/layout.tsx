import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Theo — private preview",
  robots: { index: false, follow: false },
};

export default function IrLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
