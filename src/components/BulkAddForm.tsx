"use client";

import { useState } from "react";
import { todayISO, zoneForCategory, type FridgeItem } from "@/lib/food";
import { guessItem } from "@/lib/guess";

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
  const parsed = parseLines(text);

  function addAll() {
    if (parsed.length === 0) return;
    const today = todayISO();
    const items: FridgeItem[] = parsed.map((p) => {
      const g = guessItem(p.name, today);
      return {
        id: crypto.randomUUID(),
        name: p.name,
        quantity: p.quantity,
        category: g.category,
        zone: zoneForCategory(g.category),
        purchasedOn: today,
        expiresOn: g.expiresOn,
        createdAt: Date.now(),
      };
    });
    onAddMany(items);
    setText("");
  }

  return (
    <div className="rounded-3xl border border-line bg-surface p-4 shadow-sm">
      <p className="mb-2 text-xs text-ink-soft">
        🤖 冷蔵庫の中身を<strong>1行に1つ</strong>貼り付けると、カテゴリと賞味期限を自動推定して一括追加します（購入日は今日扱い・あとで個別に修正可）。
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={"例：\n玉ねぎ 1個\n鶏もも肉 1枚\n牛乳 1本\n卵 6個\n醤油"}
        className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft"
      />

      {parsed.length > 0 && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded-xl bg-paper p-2">
          <p className="mb-1 px-1 text-[11px] font-semibold text-ink-soft">
            プレビュー（{parsed.length}件・推定結果）
          </p>
          <ul className="flex flex-col gap-1">
            {parsed.map((p, i) => {
              const g = guessItem(p.name, todayISO());
              return (
                <li key={i} className="flex items-center gap-2 px-1 text-xs">
                  <span className="font-medium text-ink">{p.name}</span>
                  {p.quantity && <span className="text-ink-soft">{p.quantity}</span>}
                  <span className="ml-auto rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] text-brand-dark">
                    {g.category}
                  </span>
                  <span className="text-[10px] text-ink-soft">〜{g.expiresOn}</span>
                </li>
              );
            })}
          </ul>
        </div>
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
