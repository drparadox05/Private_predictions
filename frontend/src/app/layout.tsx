import type { Metadata } from "next";
import { Inter, Orbitron } from "next/font/google";
import { Toaster } from "sonner";
import type { ReactNode } from "react";

import { BackgroundEffects } from "@/components/background-effects";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter"
});

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron"
});

export const metadata: Metadata = {
  title: "ShadowMarket",
  description: "Privacy-first prediction markets with encrypted order flow and Chainlink-backed settlement."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${orbitron.variable}`}>
      <body className="font-[var(--font-inter)] text-foreground antialiased">
        <Providers>
          <div className="relative min-h-screen overflow-hidden">
            <BackgroundEffects />
            <div className="relative z-10 flex min-h-screen flex-col">
              <SiteHeader />
              <main className="flex-1">{children}</main>
              <SiteFooter />
            </div>
          </div>
          <Toaster position="top-right" theme="dark" richColors closeButton />
        </Providers>
      </body>
    </html>
  );
}
