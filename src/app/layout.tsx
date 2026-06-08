import type { Metadata } from "next";
import { Quicksand, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

// ロゴ/欧文＝Quicksand（丸い幾何サンセリフ）／日本語＝Zen角ゴ
const display = Quicksand({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const sans = Zen_Kaku_Gothic_New({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: `${APP_NAME}｜${APP_TAGLINE}`,
  description:
    "冷蔵庫の在庫と賞味期限を見える化し、期限が近い食材から献立を提案、買い物リストまで一気通貫で管理する個人用キッチンアプリ。",
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
      <body className="flex min-h-full flex-col">
        <main className="flex-1 pb-24">{children}</main>
        <Nav />
      </body>
    </html>
  );
}
