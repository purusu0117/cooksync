"use client";

// 枠を使い切った瞬間に出すシート。**ここが最も転換する場所**（価値を1回以上感じた直後）。
//
// ただし出し方を間違えると、無料ユーザーにとっては「使い切るたびに広告が出るアプリ」になる。
// 出す条件は src/lib/premium.ts の shouldShowQuotaPaywall に集約してあり、
//   ・すでにプレミアムの人には出さない
//   ・拒否理由が "user"（本人の枠切れ）以外では出さない
//     （IP上限・全体の混雑・月間予算はこちら側の都合で、課金しても解決しない＝売るのは嘘）
//   ・同じ週に2回出さない
// をすべて満たしたときだけ true になる。
//
// ⚠️ **本文は「いつ戻るか」から始める。** 先に課金を出すと「払わないと使えない」と読める。
//    無料のままでも続けられることを言い切ってから、待たない選択肢として出す。
//
// 使い方（他の画面から）:
//   const paywall = useQuotaPaywall();
//   // 429 を受け取ったところで
//   paywall.open({ reason: quota?.reason, premium: usage.premium });
//   // 画面のどこかに
//   <QuotaPaywall state={paywall.state} onClose={paywall.close} />

import { useCallback, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { AI_LABEL, weekKey, type AiKind } from "@/lib/aiLimits";
import { PREMIUM_LIMITS } from "@/lib/aiLimits";
import { quotaPaywallBody, shouldShowQuotaPaywall } from "@/lib/premium";
import { resetHint } from "@/lib/usage";

/** 「この週はもう出した」を覚えておく場所。**追加のキー**（既存のキーは触らない）。 */
export const PAYWALL_SHOWN_KEY = "cooksync:paywall:shown-week";

function readShownWeek(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(PAYWALL_SHOWN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeShownWeek(week: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAYWALL_SHOWN_KEY, week);
  } catch {
    /* 保存できなくても致命傷ではない（最悪もう一度出るだけ） */
  }
}

export interface OpenInput {
  kind: AiKind;
  reason?: "user" | "ip" | "global" | "budget";
  premium: boolean;
}

export interface QuotaPaywallState {
  open: boolean;
  kind: AiKind;
}

/** 出す/出さないの判定と「週1回まで」の記憶をまとめて持つ。 */
export function useQuotaPaywall() {
  const [state, setState] = useState<QuotaPaywallState>({ open: false, kind: "research" });

  const open = useCallback((input: OpenInput): boolean => {
    const currentWeek = weekKey();
    const allowed = shouldShowQuotaPaywall({
      reason: input.reason,
      premium: input.premium,
      lastShownWeek: readShownWeek(),
      currentWeek,
    });
    if (!allowed) return false;
    writeShownWeek(currentWeek);
    setState({ open: true, kind: input.kind });
    return true;
  }, []);

  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  return { state, open, close };
}

export default function QuotaPaywall({
  state,
  onClose,
}: {
  state: QuotaPaywallState;
  onClose: () => void;
}) {
  if (!state.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="プレミアムのご案内"
        className="w-full max-w-md rounded-3xl border border-line bg-surface p-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-bold text-ink">
            {AI_LABEL[state.kind]}を今週ぶん使い切りました
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="-m-2 shrink-0 rounded-xl p-2 text-ink-soft transition hover:bg-paper"
          >
            <X size={18} />
          </button>
        </div>

        {/* まず「いつ戻るか」。無料のままでも続けられることを先に言い切る */}
        <p className="mt-2 text-sm leading-relaxed text-ink">{quotaPaywallBody(resetHint())}</p>

        <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2.5 text-xs leading-relaxed text-brand-dark">
          プレミアムなら {AI_LABEL[state.kind]} が週{PREMIUM_LIMITS[state.kind]}回まで。
        </p>

        <Link
          href="/premium"
          onClick={onClose}
          className="mt-4 flex min-h-[52px] items-center justify-center gap-1.5 rounded-2xl bg-brand text-[15px] font-bold text-white active:scale-[.98]"
        >
          <Sparkles size={16} />
          プレミアムを見る
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="mt-1.5 min-h-[44px] w-full rounded-2xl text-xs font-medium text-ink-soft"
        >
          このまま無料で使う
        </button>
      </div>
    </div>
  );
}
