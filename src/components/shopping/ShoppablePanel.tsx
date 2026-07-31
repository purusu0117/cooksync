"use client";

// 「足りない food をまとめて注文する」導線。買い物リストとレシピ詳細の両方から使う。
//
// 広告バナーにしない、が全部の判断の軸：
//   - 出るのは**足りているものが無いときだけ**。買うものが0件なら丸ごと消える。
//   - 買い物リストをコピーしてから開ける。外部サイトで1件ずつ思い出す作業が残ると、
//     機能ではなく単なるリンク広告になる。
//   - 提携先が1件も設定されていなければ何も描かない（src/lib/affiliate.ts）。
//
// 文言は「動作＋対象＋結果」。行き先だけ書いた「〜へ」は使わない。

import { useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import {
  AD_DISCLOSURE,
  needsAdLabel,
  partnerLinks,
  type PartnerId,
  type Placement,
} from "@/lib/affiliate";

interface Props {
  placement: Placement;
  /** 見出しに出す件数。0 のときは丸ごと出さない。 */
  count: number;
  /** 見出し。動作＋対象＋結果で書く。 */
  title: string;
  /** 見出しの下の1行説明。 */
  description: string;
  /** コピーボタンに載せるテキスト（空ならボタンを出さない）。 */
  copyText?: string;
}

/**
 * 押されたことをサーバーに1件だけ知らせる。**遷移を1msも遅らせない**のが条件なので、
 * sendBeacon（ページを離れても送られる）を第一候補にし、無ければ keepalive の fetch。
 * どちらも失敗しても握りつぶす（計測できないことより、店に飛べないことの方が問題）。
 */
function reportClick(partner: PartnerId, placement: Placement): void {
  const body = JSON.stringify({ partner, placement });
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/affiliate/click", blob)) return;
    }
    void fetch("/api/affiliate/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 計測の失敗で送客を止めない */
  }
}

export default function ShoppablePanel({
  placement,
  count,
  title,
  description,
  copyText,
}: Props) {
  const [copied, setCopied] = useState(false);
  const links = partnerLinks();

  // 提携先が未設定（＝まだASPに登録していない）／買うものが無いときは何も出さない。
  if (links.length === 0 || count === 0) return null;

  async function copyList() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* クリップボードが使えない環境では何も起きない（リンク自体は使える） */
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        {needsAdLabel(links) && (
          <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-ink-soft">
            PR
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">{description}</p>

      {copyText && (
        <button
          type="button"
          onClick={() => void copyList()}
          className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-paper px-4 text-xs font-semibold text-ink transition hover:bg-brand-soft active:scale-95"
        >
          {copied ? (
            <Check size={16} strokeWidth={2.5} className="text-brand" />
          ) : (
            <Copy size={16} strokeWidth={2} />
          )}
          {copied ? "コピーしました" : `買うもの${count}件をコピーする`}
        </button>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.id}>
            <a
              href={l.url}
              target="_blank"
              // sponsored＝成果報酬リンクであることの機械可読な表明。
              // noopener はネイティブ版（WKWebView）でも新規タブ側から元画面を触らせないため。
              rel={
                l.sponsored
                  ? "noopener noreferrer sponsored"
                  : "noopener noreferrer"
              }
              onClick={() => reportClick(l.id, placement)}
              className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-2.5 transition hover:border-brand hover:bg-brand-soft active:scale-[0.99]"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">
                  {l.name}で注文する
                </span>
                <span className="block text-xs leading-snug text-ink-soft">
                  {l.summary}
                </span>
              </span>
              <ExternalLink
                size={18}
                strokeWidth={2}
                className="shrink-0 text-ink-soft"
                aria-hidden
              />
            </a>
          </li>
        ))}
      </ul>

      {needsAdLabel(links) && (
        <p className="mt-3 text-xs leading-relaxed text-ink-soft">
          {AD_DISCLOSURE}
        </p>
      )}
    </section>
  );
}
