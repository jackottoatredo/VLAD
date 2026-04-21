"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";

const links = [
  { href: "/", label: "Home" },
  { href: "/product-flow", label: "Product Flow" },
  { href: "/merchant-flow", label: "Merchant Flow" },
  { href: "/merge-export", label: "Merge & Export" },
];

export default function HamburgerMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
      <Link
        href="/"
        className="text-lg font-bold tracking-tight text-foreground"
      >
        VLAD
      </Link>
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
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`block px-4 py-2 text-sm transition-colors hover:bg-background ${
                  pathname === href
                    ? "font-medium text-foreground"
                    : "text-muted"
                }`}
              >
                {label}
              </Link>
            ))}

            {session && (
              <>
                <div className="mx-3 my-1 border-t border-border" />
                <div className="px-4 py-1.5 text-xs text-muted truncate">
                  {session.user?.email}
                </div>
                <button
                  onClick={() => { setOpen(false); signOut(); }}
                  className="block w-full px-4 py-2 text-left text-sm text-muted transition-colors hover:bg-background hover:text-foreground"
                >
                  Sign out
                </button>
              </>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
