"use client";

// アプリシェル構造では window ではなく main がスクロールコンテナなので、
// Next.js の自動スクロール復帰が効かない。ページを移ったら先頭に戻す。

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** スクロールする要素のid（layout.tsx の main と共有） */
export const SCROLL_ROOT_ID = "app-scroll";

/** そのスクロールコンテナを取得する（各画面から使える） */
export function getScrollRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(SCROLL_ROOT_ID);
}

export default function ScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    getScrollRoot()?.scrollTo({ top: 0 });
  }, [pathname]);

  return null;
}
