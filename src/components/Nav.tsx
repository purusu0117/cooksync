"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "冷蔵庫", emoji: "🧊" },
  { href: "/meal", label: "献立", emoji: "🍳" },
  { href: "/shopping", label: "買い物", emoji: "🛒" },
  { href: "/recipes", label: "レシピ", emoji: "🍴" },
];

export default function Nav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand text-base text-white shadow-sm">
            🧊
          </span>
          <span className="text-sm font-bold tracking-tight text-ink">
            パントリー
            <span className="text-brand">.</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {TABS.map((t) => {
            const active = isActive(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "bg-brand text-white shadow-sm"
                    : "text-ink-soft hover:bg-brand-soft hover:text-brand-dark"
                }`}
              >
                <span aria-hidden>{t.emoji}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
