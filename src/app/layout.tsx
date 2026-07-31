import type { Metadata, Viewport } from "next";
import { Quicksand, M_PLUS_2 } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import AppGate from "@/components/AppGate";
import Onboarding from "@/components/Onboarding";
import ScrollReset, { SCROLL_ROOT_ID } from "@/components/ScrollReset";
import OfflineReady from "@/components/OfflineReady";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

// ロゴ/欧文＝Quicksand（丸い幾何サンセリフ）／日本語＝M PLUS 2
//
// 日本語を Zen角ゴ から M PLUS 2 に変更（2026-07-31・大翔が3案から選定）。
// 理由は「同じpxでも字面が大きくふところが広い＝小さい文字が読める」こと。
// 丸い骨格が Quicksand と同系統なので、CookSync の柔らかい雰囲気は変わらない。
// 可変フォントなので、小さい文字だけ 500 に太らせる調整ができる。
const display = Quicksand({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const sans = M_PLUS_2({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: `${APP_NAME}｜${APP_TAGLINE}`,
  description:
    "冷蔵庫の在庫と賞味期限を見える化し、期限が近い食材から献立を提案、買い物リストまで一気通貫で管理する個人用キッチンアプリ。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: APP_NAME },
  icons: { icon: "/icon-512.jpg", apple: "/apple-icon.jpg" },
};

export const viewport: Viewport = {
  themeColor: "#2f9e60",
  width: "device-width",
  initialScale: 1,
  // 入力フォーカス時の自動拡大＆ピンチズームを無効化（アプリらしい固定表示）
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${display.variable} ${sans.variable} h-full antialiased`}
    >
      {/*
        アプリシェル構造：body自体はスクロールさせず、中身(main)だけをスクロールさせる。
        document がスクロールしないので、iOSで画面を引っ張ってもボトムタブが動かない
        （position:fixed は iOS のラバーバンドでは一緒に持ち上がってしまうため、
         そもそもタブを通常フローの最下段に置いて“動きようがない”状態にする）。
      */}
      <body className="flex h-dvh flex-col overflow-hidden">
        <div className="app-bg" aria-hidden />
        {/*
          viewportFit:"cover" で画面いっぱいに描いているので、上端は Dynamic Island /
          ステータスバーの真下に潜る。safe-area-inset-top を入れていなかったため、
          各画面の一番上は **見えないうえにタップもできない** 状態だった
          （大翔の実機報告・2026-07-31「上が見えない」「一番上が触れない」）。
          下端だけ Nav で対応していて、上端が抜けていた。
        */}
        <main
          id={SCROLL_ROOT_ID}
          className="flex-1 overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)] pb-6"
        >
          <AppGate>{children}</AppGate>
        </main>
        <Nav />
        <ScrollReset />
        <OfflineReady />
        <Onboarding />
      </body>
    </html>
  );
}
