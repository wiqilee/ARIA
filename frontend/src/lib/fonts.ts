/**
 * ARIA Typography — Font configuration for Next.js.
 *
 * Display: Space Grotesk (headings, logo)
 * Body:    Inter (paragraph, UI text)
 * Mono:    JetBrains Mono (drug names, values, codes)
 */

import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";

export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
});

export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});
