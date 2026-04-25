import type { Metadata } from "next";
import { Syne, Outfit, JetBrains_Mono } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "ARIA — Adaptive Risk Intelligence for Polypharmacy Assessment",
  description:
    "An AI agent system that reasons about drug interactions through temporal cascade modeling, pharmacokinetic reasoning, patient phenotype risk scoring, and deprescribing optimization.",
  keywords: [
    "polypharmacy",
    "drug interactions",
    "clinical AI",
    "pharmacovigilance",
    "deprescribing",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${outfit.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-screen bg-background text-text font-body antialiased noise-overlay">
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  );
}
