"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import BugReportModal from "./BugReportModal";
import FeatureRequestModal from "./FeatureRequestModal";
import { useNavigationGuard } from "@/app/contexts/NavigationGuardContext";

const links = [
  { href: "/", label: "Home" },
  { href: "/product-flow", label: "Product Flow" },
  { href: "/merchant-flow", label: "Merchant Flow" },
  { href: "/merge-export", label: "Merge & Export" },
];

export default function HamburgerMenu() {
  const [open, setOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [featureOpen, setFeatureOpen] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();
  const { tryNavigate } = useNavigationGuard();

  return (
    <>
      <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
        <button
          onClick={() => setOpen((prev) => !prev)}
          aria-label="Toggle menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-foreground shadow-sm"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="3" y1="5" x2="17" y2="5" />
            <line x1="3" y1="10" x2="17" y2="10" />
            <line x1="3" y1="15" x2="17" y2="15" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => tryNavigate("/")}
          className="text-lg font-bold tracking-tight text-foreground"
        >
          VLAD
        </button>

        {open && (
          <>
            <div
              className="fixed inset-0"
              onClick={() => setOpen(false)}
            />
            <nav className="absolute left-0 top-11 min-w-36 rounded-xl border border-border bg-surface py-1 shadow-md">
              {session && (
                <>
                  <div className="px-4 py-1 text-[0.65625rem] text-muted truncate">
                    {session.user?.email}
                  </div>
                  <button
                    onClick={() => { setOpen(false); signOut(); }}
                    className="block w-full px-4 py-1.5 text-left text-xs text-muted transition-colors hover:bg-background hover:text-foreground"
                  >
                    Sign out
                  </button>
                  <div className="my-1 border-t border-border" />
                </>
              )}

              {links.map(({ href, label }) => (
                <button
                  key={href}
                  type="button"
                  onClick={() => { setOpen(false); tryNavigate(href); }}
                  className={`block w-full px-4 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-background ${
                    pathname === href ? "font-medium" : ""
                  }`}
                >
                  {label}
                </button>
              ))}

              <div className="my-1 border-t border-border" />

              <button
                type="button"
                onClick={() => { setOpen(false); tryNavigate("/tutorial"); }}
                className={`block w-full px-4 py-1.5 text-left text-xs transition-colors hover:bg-background ${
                  pathname === "/tutorial"
                    ? "font-medium text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Tutorial
              </button>
              <button
                onClick={() => { setOpen(false); setBugOpen(true); }}
                className="block w-full px-4 py-1.5 text-left text-xs text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                Bug Report
              </button>
              <button
                onClick={() => { setOpen(false); setFeatureOpen(true); }}
                className="block w-full px-4 py-1.5 text-left text-xs text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                Feature Request
              </button>
              <a
                href="https://redo-tech.slack.com/archives/C0AU9L8FHNJ"
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
                className="block w-full px-4 py-1.5 text-left text-xs text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                Slack
              </a>
            </nav>
          </>
        )}
      </div>

      {bugOpen && <BugReportModal onClose={() => setBugOpen(false)} />}
      {featureOpen && <FeatureRequestModal onClose={() => setFeatureOpen(false)} />}
    </>
  );
}
