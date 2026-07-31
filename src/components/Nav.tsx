"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type MouseEvent } from "react";
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
  // 文字を大きくした分、5タブに収めるため「買い物リスト」→「買い物」に短縮
  { href: "/shopping", label: "買い物", icon: ShoppingCart },
  { href: "/mypage", label: "マイページ", icon: User },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

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

  // ランディングページ(/lp)と法務・サポートページ(/legal)ではアプリのタブを出さない
  // （/legal は未ログインの審査担当者も開くページなので、アプリの導線を見せない）
  if (pathname.startsWith("/lp") || pathname.startsWith("/legal")) return null;

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
    // position:fixed をやめ、アプリシェル（body=flex縦）の最下段に置く。
    // document がスクロールしないので、iOSで画面を引っ張ってもタブは動かない。
    <nav className="shrink-0 border-t border-line bg-surface/95 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-2xl items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => {
          const active = isActive(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              onClick={(e) => handleTabClick(t.href, e)}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[12px] font-medium transition ${
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
