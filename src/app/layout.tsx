import type { Metadata } from "next";
import { Inter, Rajdhani } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap", fallback: ["system-ui", "sans-serif"] });
const rajdhani = Rajdhani({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-rajdhani", display: "swap", fallback: ["Impact", "sans-serif"] });

export const metadata: Metadata = {
  title: "CircZles Player Hub V2",
  description: "Competitive CircZles solving, missions, rewards, leaderboards, and player progression.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${inter.variable} ${rajdhani.variable}`}>{children}</body></html>;
}
