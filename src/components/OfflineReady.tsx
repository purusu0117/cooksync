"use client";

// Service Worker を**起動時に必ず**登録する。
//
// ⚠️ これまで sw.js の登録は pushClient.ts の中だけにあり、
//    「通知を許可した人」しか登録されていなかった。
//    つまり大多数のユーザーには Service Worker が無く、**圏外だと真っ白**になっていた
//    （ネイティブ版は WKWebView が Vercel を直接読む remote URL 方式のため）。
//    オフライン対応は通知とは無関係なので、ここで独立して登録する。
//
// 登録に失敗しても何もしない（オフライン対応が無いだけで、本体は動く）。

import { useEffect } from "react";

export default function OfflineReady() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // 初期表示の邪魔をしないよう、描画が落ち着いてから登録する
    const t = setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* 失敗してもアプリ本体は動く */
      });
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  return null;
}
