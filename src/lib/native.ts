"use client";

// クライアント専用：Capacitor ネイティブシェル（iOSアプリ版）で動いているかの判定。
// CookSync のネイティブ版は remote URL 方式（WKWebView が本番Webをそのまま読み込む）なので、
// 同じJSがブラウザ版とアプリ版の両方で動く。挙動を分けたいところだけここで判定する。
//
// 判定は @capacitor/core の Capacitor.isNativePlatform() を使い、
// 取れなかった場合はネイティブブリッジが注入する window.Capacitor にフォールバックする
// （remote URL 方式だと注入される window.Capacitor の中身が最小限のことがあるため）。
import { Capacitor } from "@capacitor/core";

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

/** ネイティブアプリ（iOSのCapacitorシェル）内で動いているか。ブラウザ/PWAでは常にfalse */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (Capacitor.isNativePlatform()) return true;
  } catch {
    /* 次のフォールバックへ */
  }
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  try {
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}
