"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/brand";

const TABS = [
  { href: "/", label: "冷蔵庫" },
  { href: "/meal", label: "献立" },
  { href: "/shopping", label: "買い物" },
  { href: "/recipes", label: "レシピ" },
];

export default function Nav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3.5">
        <Link href="/" className="group flex items-baseline gap-0.5">
          <span className="wordmark text-xl font-bold tracking-wide text-ink">
            {APP_NAME}
          </span>
          <span className="text-xl leading-none text-accent">.</span>
        </Link>

        <nav className="flex items-center gap-0.5">
          {TABS.map((t) => {
            const active = isActive(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-full px-3 py-1.5 text-[13px] font-medium tracking-wide transition ${
                  active
                    ? "bg-ink text-paper"
                    : "text-ink-soft hover:bg-brand-soft hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
