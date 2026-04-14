"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/", label: "Home" },
  { href: "/product-flow", label: "Product Flow" },
  { href: "/merchant-flow", label: "Merchant Flow" },
];

export default function HamburgerMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
      <Link
        href="/"
        className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
      >
        VLAD
      </Link>
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Toggle menu"
        className="flex h-9 w-9 flex-col items-center justify-center gap-1.5 rounded-lg border border-black/10 bg-white shadow-sm dark:border-white/15 dark:bg-zinc-950"
      >
        <span className="block h-0.5 w-5 bg-zinc-800 dark:bg-zinc-200" />
        <span className="block h-0.5 w-5 bg-zinc-800 dark:bg-zinc-200" />
        <span className="block h-0.5 w-5 bg-zinc-800 dark:bg-zinc-200" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0"
            onClick={() => setOpen(false)}
          />
          <nav className="absolute left-0 top-11 min-w-36 rounded-xl border border-black/10 bg-white py-1 shadow-md dark:border-white/15 dark:bg-zinc-950">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`block px-4 py-2 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                  pathname === href
                    ? "font-medium text-black dark:text-zinc-50"
                    : "text-zinc-600 dark:text-zinc-400"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
