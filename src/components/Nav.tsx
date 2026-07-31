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
  // iOS Safari/PWAでは fixed は「レイアウトビューポート」基準なので、
  // アドレスバーの伸縮・ラバーバンドスクロールで画面下からズレて“上に来る”ことがある。
  // 実際に見えている領域（visualViewport）の下端との差分を bottom に足して打ち消す。
  const [bottomGap, setBottomGap] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      // 表示領域がレイアウト高より150px以上小さい＝キーボード等で縮んでいる
      const kb = window.innerHeight - vv.height > 150;
      setKeyboardOpen(kb);
      // 可視領域の下端 = vv.offsetTop + vv.height。レイアウト高との差＝下にはみ出た分。
      const gap = window.innerHeight - (vv.height + vv.offsetTop);
      setBottomGap(kb ? 0 : Math.max(0, Math.round(gap)));
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
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
      // translateZ(0)＝合成レイヤーに固定（iOSでのfixedのちらつき/ズレ対策）
      style={{ bottom: bottomGap, willChange: "transform" }}
      className={`fixed inset-x-0 z-30 transform-gpu border-t border-line bg-surface/95 backdrop-blur-md transition-transform duration-200 ${
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
