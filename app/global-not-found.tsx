import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Page not found · VLAD Recorder",
  description: "The page you are looking for does not exist.",
};

// Match next-themes (attribute="class", storageKey="theme", defaultTheme="system")
// so the 404 page renders in the user's chosen theme without a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(!t||t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.add(t);}catch(e){}})();`;

export default function GlobalNotFound() {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 font-sans">
          <main className="w-full max-w-md space-y-2 rounded-2xl border border-border bg-surface p-8 text-center shadow-md">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              404
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Page not found
            </h1>
            <p className="text-sm text-muted">
              The page you’re looking for doesn’t exist or has moved.
            </p>
          </main>
        </div>
      </body>
    </html>
  );
}
