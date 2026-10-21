"use client";

// クライアント：通知の有効化。呼び出し側は環境を意識しなくてよいよう、ここで振り分ける。
//  - Web（ブラウザ/PWA）… Service Worker登録＋Web Push購読。
//    ※ iOSは「ホーム画面に追加したPWA」かつ通知許可済みのときのみ届く（Safariタブ不可）。
//  - ネイティブアプリ（Capacitor/WKWebView）… Web Push は受け取れないので APNs で登録する
//    （nativePush.ts）。以前はここで何もせず、アプリ版だけ通知が届かなかった。

import { getUid } from "@/lib/syncStore";
import { isNativeApp } from "@/lib/native";
import { enableNativePush, nativePushPermission } from "@/lib/nativePush";
// 型だけを借りる（`import type` はビルド時に消えるので、サーバー用モジュールは束ねられない）
import type { ExpirySettings } from "@/lib/expiryNotify";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** ArrayBuffer(applicationServerKey) を base64url に戻して、サーバーの鍵と比べられる形にする */
function toBase64Url(buf: ArrayBuffer): string {
  let s = "";
  const arr = new Uint8Array(buf);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 通知を有効化（許可要求→SW登録→購読→サーバー送信）。成功でtrue */
export async function enablePush(): Promise<boolean> {
  try {
    if (isNativeApp()) return await enableNativePush({ ask: true }); // ネイティブはAPNs
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

    // 鍵は**毎回**サーバーに聞く。以前は購読が既にあれば聞かずに済ませていたが、
    // サーバーの VAPID 鍵が変わっていると古い購読は永久に届かない
    // （送信側が 400 VapidPkHashMismatch になる。2026-08-09 に実測で確認）。
    // 端末側からは成功しているように見えるので、ここで気づくしかない。
    const res = await fetch("/api/push/key", { cache: "no-store" });
    const { key } = (await res.json()) as { key?: string };
    if (!key) return false;

    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const cur = sub.options?.applicationServerKey;
      if (!cur || toBase64Url(cur as ArrayBuffer) !== key) {
        // 鍵が変わっている＝この購読はもう届かない。捨てて取り直す。
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
    }
    if (!sub) {
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

/**
 * 「いま画面を見ていない大翔に、確実に気づいてもらう」ための最後の砦。
 *
 * Web Push は購読・VAPID鍵・OSの通知許可のどれか1つでも欠けると黙って届かない。
 * ところが**許可さえ出ていれば、購読が無くてもページから直接通知は出せる**。
 * ジョブの完了をポーリングで掴んでいるのはページ自身なので、こちらの方が確実。
 * （Web Push は「アプリを閉じていても届く」担当。両方あって初めて漏れがなくなる）
 */
export async function notifyLocally(
  title: string,
  body: string,
  url = "/",
): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    if (Notification.permission !== "granted") return false;
    // Service Worker 経由だと、通知をタップしたときに画面を開き直せる（sw.js が面倒を見る）
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, {
          body,
          icon: "/icon-192.jpg",
          badge: "/icon-192.jpg",
          data: { url },
          tag: "cooksync",
        });
        return true;
      }
    }
    new Notification(title, { body, icon: "/icon-192.jpg" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 完了通知が**実際に届く状態か**。届かないなら理由を日本語で返す。
 * 「探索したのに通知が来ない」を黙って起こさないため、画面に出すのに使う。
 */
export async function pushReadiness(): Promise<{ ok: boolean; reason: string }> {
  const state = await pushPermissionState();
  if (state === "granted") return { ok: true, reason: "" };
  if (state === "denied") {
    return {
      ok: false,
      reason: "完了通知はオフです（ブラウザで通知が拒否されています）。アドレスバーの🔒から許可すると届きます。",
    };
  }
  if (state === "unsupported") {
    return { ok: false, reason: "この環境では完了通知を出せません。" };
  }
  return { ok: false, reason: "完了通知はまだ許可されていません。" };
}

/**
 * いまの通知の許可状態。**ダイアログは出さない**（起動時に勝手に許可を求めない）。
 *  granted=許可済み / denied=拒否済み（端末の設定からしか戻せない）
 *  prompt=まだ聞いていない / unsupported=この環境では通知が使えない
 */
export async function pushPermissionState(): Promise<
  "granted" | "denied" | "prompt" | "unsupported"
> {
  try {
    if (isNativeApp()) return await nativePushPermission();
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    const p = Notification.permission;
    return p === "granted" ? "granted" : p === "denied" ? "denied" : "prompt";
  } catch {
    return "unsupported";
  }
}

export interface ExpiryNotifyConfig {
  settings: Pick<ExpirySettings, "enabled" | "leadDays" | "hour">;
  /** 画面に出す選択肢。**サーバーが持つ値をそのまま使う**（画面とサーバーでズレないように） */
  choices: { leadDays: number[]; hours: number[] };
}

/** 期限通知の設定を読む（未設定ならサーバーが既定値を返す） */
export async function fetchExpirySettings(): Promise<ExpiryNotifyConfig | null> {
  try {
    const res = await fetch(`/api/notify-expiry?u=${encodeURIComponent(getUid())}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<ExpiryNotifyConfig>;
    if (!data.settings) return null;
    return {
      settings: {
        enabled: !!data.settings.enabled,
        leadDays: Array.isArray(data.settings.leadDays) ? data.settings.leadDays : [1, 3],
        hour: typeof data.settings.hour === "number" ? data.settings.hour : 18,
      },
      choices: {
        leadDays: data.choices?.leadDays ?? [1, 2, 3, 5, 7],
        hours: data.choices?.hours ?? [7, 8, 9, 12, 15, 17, 18, 19, 20, 21],
      },
    };
  } catch {
    return null;
  }
}

/** 期限通知の設定を保存する。宛先はサーバーが決めるので `u` は手掛かりでしかない */
export async function saveExpirySettings(
  s: Pick<ExpirySettings, "enabled" | "leadDays" | "hour">,
): Promise<boolean> {
  try {
    const res = await fetch("/api/notify-expiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...s,
        u: getUid(),
        // 「何時に送るか」はこの端末の時計基準。日本なら -540
        tzOffsetMinutes: new Date().getTimezoneOffset(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** すでに許可済みなら静かに購読を確保（許可ダイアログは出さない） */
export async function ensurePushIfGranted(): Promise<void> {
  try {
    if (isNativeApp()) {
      // ネイティブは許可済みのときだけ静かに端末トークンを取り直す（ダイアログは出さない）
      await enableNativePush({ ask: false });
      return;
    }
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
