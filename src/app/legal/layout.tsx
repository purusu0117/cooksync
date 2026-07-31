import Link from "next/link";
import { LEGAL } from "@/lib/legal";

// 法務・サポートページ共通レイアウト。
// **ログイン不要の公開ページ**（App Store審査担当者やクローラも閲覧するため）。
// AppGate の PUBLIC_PREFIX に /legal を入れてあるので、未ログインでも /mypage に飛ばされない。
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-full w-full max-w-md px-4 py-8">
      <p className="text-center text-xs text-ink-soft">{LEGAL.serviceName}</p>
      <div className="mt-4 rounded-3xl border border-line bg-surface p-6 shadow-sm">
        {children}
      </div>
      <nav className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-ink-soft">
        <Link href="/legal/support" className="underline underline-offset-4">
          サポート・FAQ
        </Link>
        <Link href="/legal/privacy" className="underline underline-offset-4">
          プライバシーポリシー
        </Link>
        <Link href="/legal/terms" className="underline underline-offset-4">
          利用規約
        </Link>
        <Link href="/mypage" className="underline underline-offset-4">
          アプリへ戻る
        </Link>
      </nav>
    </div>
  );
}
