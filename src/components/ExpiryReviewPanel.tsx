"use client";

// 既に冷蔵庫に入っている食材の「カテゴリ・賞味期限」を見直すパネル。
// 推定ロジックを直しても、過去に登録済みの食材は古い期限のまま残るため、
// ズレているものだけを挙げて、ワンタップで直せるようにする。
// （例：「しょうゆ」がカテゴリ“その他”・78日で登録されていた）

import { useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import {
  daysUntil,
  estimateExpiry,
  zoneForCategory,
  type FridgeItem,
} from "@/lib/food";
import { guessItem } from "@/lib/guess";
import { estimateExpiryDays } from "@/lib/expiryAI";

interface Props {
  items: FridgeItem[];
  onApply: (updated: FridgeItem[]) => void;
}

interface Candidate {
  item: FridgeItem;
  next: FridgeItem;
  diffDays: number;
  categoryChanged: boolean;
  needsAI: boolean;
}

// これ未満のズレは指摘しない（毎回パネルが出ると邪魔なので）
const DIFF_THRESHOLD = 3;

export default function ExpiryReviewPanel({ items, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDays, setAiDays] = useState<Record<string, number>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);

  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    for (const item of items) {
      if (dismissed.includes(item.id)) continue;
      const opened = !!item.openedOn;
      const g = guessItem(item.name, item.purchasedOn, opened);
      const days = aiDays[item.name];
      const expiresOn =
        days != null ? estimateExpiry(item.purchasedOn, days) : g.expiresOn;
      const diffDays = Math.abs(daysUntil(expiresOn, item.expiresOn));
      const categoryChanged = g.category !== item.category;
      if (diffDays < DIFF_THRESHOLD && !categoryChanged) continue;
      out.push({
        item,
        next: {
          ...item,
          category: g.category,
          zone: zoneForCategory(g.category),
          expiresOn,
        },
        diffDays,
        categoryChanged,
        needsAI: g.needsAI && days == null,
      });
    }
    return out;
  }, [items, aiDays, dismissed]);

  if (candidates.length === 0) return null;

  const unknown = candidates.filter((c) => c.needsAI).map((c) => c.item.name);

  async function refineWithAI() {
    if (unknown.length === 0 || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await estimateExpiryDays(unknown.map((name) => ({ name })));
      setAiDays((prev) => {
        const next = { ...prev };
        for (const [name, est] of Object.entries(res)) next[name] = est.days;
        return next;
      });
    } finally {
      setAiLoading(false);
    }
  }

  function applyAll() {
    onApply(candidates.map((c) => c.next));
  }

  function applyOne(c: Candidate) {
    onApply([c.next]);
  }

  return (
    <section className="mb-5 rounded-3xl border border-amber-200 bg-amber-50/70 p-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-800">
          <Wand2 size={16} strokeWidth={2} />
          期限の見直し候補 {candidates.length}件
        </span>
        <span className="text-xs text-amber-700">{open ? "閉じる" : "見る"}</span>
      </button>

      {open && (
        <>
          <p className="mt-2 text-[11px] leading-relaxed text-amber-800">
            推定ロジックの更新で、登録済みの食材と目安がズレています。反映すると期限とカテゴリを直します（個別に無視もできます）。
          </p>

          <ul className="mt-2 flex flex-col gap-1.5">
            {candidates.map((c) => (
              <li
                key={c.item.id}
                className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{c.item.name}</span>
                  <span className="block text-[11px] text-ink-soft">
                    {c.item.expiresOn} → <strong>{c.next.expiresOn}</strong>
                    {c.categoryChanged && `　${c.item.category}→${c.next.category}`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => applyOne(c)}
                  className="shrink-0 rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-brand-dark"
                >
                  反映
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed((p) => [...p, c.item.id])}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-ink-soft transition hover:bg-paper"
                >
                  無視
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyAll}
              className="rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-dark"
            >
              すべて反映（{candidates.length}件）
            </button>
            {unknown.length > 0 && (
              <button
                type="button"
                onClick={refineWithAI}
                disabled={aiLoading}
                className="rounded-xl border border-brand/40 bg-brand-soft px-4 py-2 text-xs font-semibold text-brand-dark transition hover:border-brand disabled:opacity-60"
              >
                {aiLoading
                  ? "AIが日持ちを調べています…"
                  : `AIで精査（${unknown.length}件）`}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
