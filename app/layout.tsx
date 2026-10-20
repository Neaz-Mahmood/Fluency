import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Fluency",
    template: "%s · Fluency",
  },
  description: "Practice spoken English in a back-and-forth conversation.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6 sm:px-8">
            <Link href="/" className="group flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded bg-[#03256c] text-white shadow-[0_2px_8px_-2px_rgba(3,37,108,0.25)] transition-colors group-hover:bg-[#2541b2]">
                <span className="size-2 rounded-full bg-[#06bee1] shadow-[0_0_8px_#06bee1]" />
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-xl font-bold tracking-tight text-[#03256c]">
                  Fluency
                </span>
                <span className="hidden rounded-full border border-[#06bee1]/35 bg-[#06bee1]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-[#03256c] uppercase sm:inline-block">
                  Oceanic
                </span>
              </div>
            </Link>
            <nav className="flex items-center gap-6">
              <Link
                href="/practice"
                className="rounded px-3 py-1.5 text-sm font-medium text-[#556b82] transition-colors hover:bg-[#f4f7fb] hover:text-[#03256c]"
              >
                Practice
              </Link>
              <Link
                href="/settings"
                className="rounded px-3 py-1.5 text-sm font-medium text-[#556b82] transition-colors hover:bg-[#f4f7fb] hover:text-[#03256c]"
              >
                Settings
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto flex w-full min-h-0 max-w-5xl flex-1 flex-col px-6 py-8 sm:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
