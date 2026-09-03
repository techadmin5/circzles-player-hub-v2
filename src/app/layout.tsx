import type { Metadata } from "next";
import { Inter, Manrope, Rajdhani } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap", fallback: ["system-ui", "sans-serif"] });
const manrope = Manrope({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-manrope", display: "swap", fallback: ["Inter", "system-ui", "sans-serif"] });
const rajdhani = Rajdhani({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-rajdhani", display: "swap", fallback: ["Impact", "sans-serif"] });

export const metadata: Metadata = {
  title: "CircZles Player Hub",
  description: "Competitive CircZles solving, missions, rewards, leaderboards, and player progression.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${inter.variable} ${manrope.variable} ${rajdhani.variable}`}>{children}</body></html>;
}
