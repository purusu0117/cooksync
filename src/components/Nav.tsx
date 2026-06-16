"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import {
  Home,
  BookOpen,
  Refrigerator,
  ShoppingCart,
  User,
  type LucideIcon,
} from "lucide-react";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "ホーム", icon: Home },
  { href: "/recipes", label: "レシピ", icon: BookOpen },
  { href: "/fridge", label: "冷蔵庫", icon: Refrigerator },
  { href: "/shopping", label: "買い物リスト", icon: ShoppingCart },
  { href: "/mypage", label: "マイページ", icon: User },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  // iOSのソフトキーボードが開くと fixed要素が画面中央に張り付くので、
  // キーボード中はナビを下にしまう（visualViewportの高さで検知）。
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      // 表示領域がレイアウト高より150px以上小さい＝キーボード等で縮んでいる
      setKeyboardOpen(window.innerHeight - vv.height > 150);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // レシピ内のページ（一覧/詳細）に来たら、最後に開いた場所を覚える
  useEffect(() => {
    if (pathname.startsWith("/recipes")) {
      try {
        localStorage.setItem("cooksync:lastRecipe", pathname);
      } catch {
        /* noop */
      }
    }
  }, [pathname]);

  // ランディングページ(/lp)ではアプリのタブを出さない
  if (pathname.startsWith("/lp")) return null;

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  // レシピタブは「直前に開いていたレシピ位置」に戻す（一覧へは詳細の戻るボタンで）
  function handleTabClick(href: string, e: MouseEvent) {
    if (href !== "/recipes") return;
    e.preventDefault();
    let dest = "/recipes";
    try {
      dest = localStorage.getItem("cooksync:lastRecipe") || "/recipes";
    } catch {
      /* noop */
    }
    router.push(dest);
  }

  return (
    <nav
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md transition-transform duration-200 ${
        keyboardOpen ? "translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="mx-auto flex w-full max-w-2xl items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => {
          const active = isActive(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              onClick={(e) => handleTabClick(t.href, e)}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition ${
                active ? "text-brand-dark" : "text-ink-soft hover:text-brand"
              }`}
            >
              <Icon
                size={22}
                strokeWidth={active ? 2.4 : 1.8}
                className="transition"
              />
              <span className="leading-none">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
