import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CBE PricePilot",
    template: "%s · CBE PricePilot",
  },
  description:
    "Veille tarifaire, benchmark des concurrents et recommandations de prix pour les revendeurs tunisiens d'informatique et d'électroménager.",
  icons: { icon: "/brand/logo.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${dmSans.variable} bg-[#eef3f5] text-[#071c22] antialiased`}>{children}</body>
    </html>
  );
}
