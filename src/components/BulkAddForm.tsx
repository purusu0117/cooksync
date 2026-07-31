"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { estimateExpiry, todayISO, zoneForCategory, type FridgeItem } from "@/lib/food";
import { guessItem } from "@/lib/guess";
import { estimateExpiryDays } from "@/lib/expiryAI";
import { packOf } from "@/lib/packaging";

interface Props {
  onAddMany: (items: FridgeItem[]) => void;
}

interface ParsedLine {
  name: string;
  quantity: string;
}

function parseLines(text: string): ParsedLine[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      // 「玉ねぎ 1個」→ name=玉ねぎ, quantity=1個。スペースが無ければ全部name。
      const m = l.match(/^(\S+)[\s　]+(.*)$/);
      if (m) return { name: m[1], quantity: m[2].trim() };
      return { name: l, quantity: "" };
    });
}

export default function BulkAddForm({ onAddMany }: Props) {
  const [text, setText] = useState("");
  // AIが調べ直した日持ち（食材名→日数）。プレビューと追加の両方に反映する。
  const [aiDays, setAiDays] = useState<Record<string, number>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const parsed = parseLines(text);
  const today = todayISO();

  // 辞書に無い＝カテゴリ既定でしのいでいる食材（AIに聞く価値がある）
  const unknown = parsed
    .filter((p) => guessItem(p.name, today).needsAI && aiDays[p.name] == null)
    .map((p) => p.name);

  function expiryOf(name: string): string {
    const days = aiDays[name];
    if (days != null) return estimateExpiry(today, days);
    return guessItem(name, today).expiresOn;
  }

  async function refineAll() {
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

  function addAll() {
    if (parsed.length === 0) return;
    const items: FridgeItem[] = parsed.map((p) => {
      const g = guessItem(p.name, today);
      // 数量が空でも、パック売りの食材は「1パック」等を既定にしておく（あとで修正可）
      const pack = packOf(p.name);
      return {
        id: crypto.randomUUID(),
        name: p.name,
        quantity: p.quantity || (pack ? `1${pack.unit}` : ""),
        category: g.category,
        zone: zoneForCategory(g.category),
        purchasedOn: today,
        expiresOn: expiryOf(p.name),
        createdAt: Date.now(),
      };
    });
    onAddMany(items);
    setText("");
    setAiDays({});
  }

  return (
    <div className="rounded-3xl border border-line bg-surface p-4 shadow-sm">
      <p className="mb-2 text-xs text-ink-soft">
        <Bot size={13} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
        冷蔵庫の中身を<strong>1行に1つ</strong>貼り付けると、カテゴリと賞味期限を自動推定して一括追加します（購入日は今日扱い・あとで個別に修正可）。
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={"例：\n玉ねぎ 1個\n鶏もも肉 1枚\n牛乳 1本\n卵 1パック\n醤油"}
        className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft"
      />

      {parsed.length > 0 && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded-xl bg-paper p-2">
          <p className="mb-1 px-1 text-[11px] font-semibold text-ink-soft">
            プレビュー（{parsed.length}件・推定結果）
          </p>
          <ul className="flex flex-col gap-1">
            {parsed.map((p, i) => {
              const g = guessItem(p.name, today);
              const pack = packOf(p.name);
              return (
                <li key={i} className="flex items-center gap-2 px-1 text-xs">
                  <span className="font-medium text-ink">{p.name}</span>
                  <span className="text-ink-soft">
                    {p.quantity || (pack ? `1${pack.unit}` : "")}
                  </span>
                  <span className="ml-auto rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] text-brand-dark">
                    {g.category}
                  </span>
                  <span className="text-[10px] text-ink-soft">
                    〜{expiryOf(p.name)}
                    {aiDays[p.name] != null && (
                      <Bot size={11} strokeWidth={2} className="ml-0.5 inline-block align-[-0.15em] text-brand-dark" />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {unknown.length > 0 && (
        <button
          type="button"
          onClick={refineAll}
          disabled={aiLoading}
          className="mt-3 w-full rounded-xl border border-brand/30 bg-brand-soft py-2 text-xs font-semibold text-brand-dark transition hover:border-brand disabled:opacity-60"
        >
          {aiLoading
            ? "AIが日持ちを調べています…"
            : `AIで期限を精査（辞書に無い ${unknown.length}件）`}
        </button>
      )}

      <button
        type="button"
        onClick={addAll}
        disabled={parsed.length === 0}
        className="mt-3 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft"
      >
        {parsed.length > 0 ? `${parsed.length}件をまとめて追加` : "まとめて追加"}
      </button>
    </div>
  );
}
