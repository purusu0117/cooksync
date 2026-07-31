// Capacitor ネイティブシェル設定（remote URL 方式）。
// Next.js は SSR/API ありのため web 資産はバンドルせず、
// WebView が本番URL（Vercel）を直接読み込む。webDir はプレースホルダのみ。
//  - CAPACITOR_SERVER_URL     … 読み込み先URLの上書き（既定: 本番Vercel）
//  - CAPACITOR_SERVER_CLEARTEXT=1 … ローカル開発時に http を許可
import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

const serverUrl = process.env.CAPACITOR_SERVER_URL || "https://cooksync-one.vercel.app";

const config: CapacitorConfig = {
  appId: "com.daito.cooksync",
  appName: "CookSync",
  // remote URL 方式のため実質未使用（cap sync が要求するので最小のプレースホルダを置く）
  webDir: "native/www",
  // WebView の下地の色。未設定だと OS 既定＝ダークモードで真っ黒になり、
  // 読み込みが終わるまで（＆圏外で読み込めないとき）「黒い画面」に見えていた。
  // アプリ本体の背景（--color-paper）と同じクリーム色にして、白/黒のフラッシュも消す。
  backgroundColor: "#f0ece1",
  server: {
    url: serverUrl,
    cleartext: process.env.CAPACITOR_SERVER_CLEARTEXT === "1",
    // 読み込みに失敗したときに表示するローカルHTML（webDir からの相対パス）。
    // これが無いと、WKWebView は失敗しても何も描かない＝ただの空画面のままだった。
    // Service Worker が入る前の初回起動や、DNSごと死んでいる状況の最後の砦。
    errorPath: "error.html",
  },
  ios: {
    // WKAppBoundDomains（Info.plist）とセットで初めて WKWebView の Service Worker が有効になる。
    // 片方だけでは効かない。これが CookSync のオフライン対応が
    // 「Web版では動くのにアプリ版だけ効かない」状態だった原因。
    // 副作用として app-bound domain 以外への WebView 内遷移が禁止されるが、
    // Capacitor は元々そういう遷移をキャンセルして Safari で開く実装なので実害はない。
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    PushNotifications: {
      // アプリを開いたままでも通知を表示する（タイマー完了に気づけるように）
      presentationOptions: ["badge", "sound", "alert"],
    },
    Keyboard: {
      // プラグイン無しの WKWebView はキーボードが出ても一切リサイズしないため、
      // 画面下部の入力欄（食材編集の「賞味・消費期限」など）がキーボードの下に隠れて
      // 操作できなくなっていた。Native は WebView 自体を縮めるので dvh/vh が追従し、
      // fixed のモーダルもキーボードの上に収まる。
      resize: KeyboardResize.Native,
    },
  },
};

export default config;
