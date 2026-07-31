"use client";

// クライアント：Service Worker登録＋プッシュ購読。
// ※ iOSは「ホーム画面に追加したPWA」かつ通知許可済みのときのみ届く（Safariタブ不可）。
// ※ ネイティブアプリ版（Capacitor/WKWebView）は Web Push を受け取れない。
//    許可ダイアログだけ出て一生届かない、という状態になるので何もしない。

import { getUid } from "@/lib/syncStore";
import { isNativeApp } from "@/lib/native";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** 通知を有効化（許可要求→SW登録→購読→サーバー送信）。成功でtrue */
export async function enablePush(): Promise<boolean> {
  try {
    if (isNativeApp()) return false; // ネイティブは Web Push 非対応（許可も求めない）
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      return false;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return false;

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const res = await fetch("/api/push/key");
      const { key } = await res.json();
      if (!key) return false;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
    }
    const subJson = sub.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...subJson, u: getUid() }),
    });
    return true;
  } catch {
    return false;
  }
}

/** すでに許可済みなら静かに購読を確保（許可ダイアログは出さない） */
export async function ensurePushIfGranted(): Promise<void> {
  try {
    if (isNativeApp()) return; // ネイティブは Web Push 非対応
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }
    await enablePush();
  } catch {
    /* noop */
  }
}
