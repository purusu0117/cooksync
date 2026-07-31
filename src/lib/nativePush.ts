"use client";

// クライアント専用：ネイティブアプリ（iOS）のプッシュ通知（APNs）登録。
//
// なぜ必要か:
//   Apple の公式回答どおり、WKWebView を使うアプリでは **Web Push は動かない**
//   （https://developer.apple.com/forums/thread/760767）。
//   ＝アプリ版では「タイマー完了」「レシピ探索完了」の通知が1通も届かない。
//   そこでアプリ版だけ、OSのプッシュ（APNs）で受け取るようにする。
//
// 流れ:
//   ①権限を確認/要求 → ②register() → ③'registration' で端末トークンが返る
//   → ④/api/push/device に保存 → サーバーは送信時に APNs へ流す。
//
// Web（ブラウザ/PWA）はこれまで通り Web Push（pushClient.ts）。ここは呼ばれない。

import { getUid } from "@/lib/syncStore";
import { isNativeApp } from "@/lib/native";

let listenersReady = false; // リスナーの二重登録を防ぐ

async function saveToken(token: string): Promise<void> {
  await fetch("/api/push/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform: "ios", u: getUid() }),
  }).catch(() => {
    /* 一時的な通信エラー。次回起動時にまた登録される */
  });
}

/**
 * ネイティブのプッシュ通知を有効化する。
 *  - ask=true  … 未許可ならOSの許可ダイアログを出す
 *  - ask=false … 既に許可済みのときだけ静かに登録し直す（ダイアログは出さない）
 * 成功（＝登録を要求できた）で true。
 */
export async function enableNativePush({ ask }: { ask: boolean }): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.checkPermissions();
    let granted = perm.receive === "granted";
    if (!granted) {
      if (!ask) return false;
      const asked = await PushNotifications.requestPermissions();
      granted = asked.receive === "granted";
    }
    if (!granted) return false;

    if (!listenersReady) {
      listenersReady = true;
      // 端末トークンはイベントで返ってくる（register自体は何度呼んでもよい）
      await PushNotifications.addListener("registration", (token) => {
        void saveToken(token.value);
      });
      await PushNotifications.addListener("registrationError", () => {
        listenersReady = false; // 次回の起動でやり直せるように戻す
      });
      // 通知をタップして開いたとき、通知が指すページへ移動する（Web版のSWと同じ挙動）
      await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const data = action.notification?.data as { url?: string } | undefined;
        const url = typeof data?.url === "string" ? data.url : "";
        if (url.startsWith("/")) window.location.href = url;
      });
    }
    await PushNotifications.register();
    return true;
  } catch {
    // プラグインが無い/古いシェルでは何もしない（他の機能には影響させない）
    return false;
  }
}
