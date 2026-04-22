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
          type="button"
          onClick={() => tryNavigate("/")}
          className="text-lg font-bold tracking-tight text-foreground"
        >
          VLAD
        </button>
        <button
          onClick={() => setOpen((prev) => !prev)}
          aria-label="Toggle menu"
          className="flex h-9 w-9 flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-surface shadow-sm"
        >
          <span className="block h-0.5 w-5 bg-foreground" />
          <span className="block h-0.5 w-5 bg-foreground" />
          <span className="block h-0.5 w-5 bg-foreground" />
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
                  <div className="px-4 py-1.5 text-xs text-muted truncate">
                    {session.user?.email}
                  </div>
                  <button
                    onClick={() => { setOpen(false); signOut(); }}
                    className="block w-full px-4 py-2 text-left text-sm text-muted transition-colors hover:bg-background hover:text-foreground"
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
                  className={`block w-full px-4 py-2 text-left text-sm transition-colors hover:bg-background ${
                    pathname === href
                      ? "font-medium text-foreground"
                      : "text-muted"
                  }`}
                >
                  {label}
                </button>
              ))}

              <div className="my-1 border-t border-border" />

              <button
                onClick={() => { setOpen(false); setBugOpen(true); }}
                className="block w-full px-4 py-2 text-left text-sm text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                Bug Report
              </button>
              <button
                onClick={() => { setOpen(false); setFeatureOpen(true); }}
                className="block w-full px-4 py-2 text-left text-sm text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                Feature Request
              </button>
            </nav>
          </>
        )}
      </div>

      {bugOpen && <BugReportModal onClose={() => setBugOpen(false)} />}
      {featureOpen && <FeatureRequestModal onClose={() => setFeatureOpen(false)} />}
    </>
  );
}
