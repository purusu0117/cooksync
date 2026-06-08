"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type FoodItem,
  type Freshness,
  freshnessOf,
  sortByExpiry,
} from "@/lib/food";
import { loadItems, saveItems } from "@/lib/storage";
import AddItemForm from "./AddItemForm";
import FoodCard from "./FoodCard";

const SUMMARY: { key: Freshness; emoji: string; label: string }[] = [
  { key: "expired", emoji: "🔴", label: "期限切れ" },
  { key: "soon", emoji: "🟡", label: "期限が近い" },
  { key: "fresh", emoji: "🟢", label: "余裕あり" },
];

export default function FridgeApp() {
  const [items, setItems] = useState<FoodItem[]>([]);
  const [mounted, setMounted] = useState(false);

  // localStorage はクライアントでしか触れないので、マウント後に読み込む
  useEffect(() => {
    setItems(loadItems());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) saveItems(items);
  }, [items, mounted]);

  const sorted = useMemo(() => sortByExpiry(items), [items]);
  const counts = useMemo(() => {
    const c: Record<Freshness, number> = { expired: 0, soon: 0, fresh: 0 };
    for (const it of items) c[freshnessOf(it.expiresOn)] += 1;
    return c;
  }, [items]);

  function addItem(item: FoodItem) {
    setItems((prev) => [...prev, item]);
  }

  function deleteItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">🧊 冷蔵庫メモ</h1>
        <p className="mt-1 text-sm text-zinc-500">
          賞味期限を🔴🟡🟢で見える化。期限が近い順に並びます。
        </p>
      </header>

      {/* 状態サマリー */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {SUMMARY.map((s) => (
          <div
            key={s.key}
            className="rounded-xl border border-zinc-200 bg-white p-3 text-center shadow-sm"
          >
            <p className="text-lg">{s.emoji}</p>
            <p className="text-2xl font-bold text-zinc-900">
              {mounted ? counts[s.key] : "–"}
            </p>
            <p className="text-xs text-zinc-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <AddItemForm onAdd={addItem} />
      </div>

      {/* 食材リスト */}
      {!mounted ? null : sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 bg-white/50 py-12 text-center text-sm text-zinc-400">
          まだ食材がありません。上のフォームから追加してみましょう。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((item) => (
            <FoodCard key={item.id} item={item} onDelete={deleteItem} />
          ))}
        </ul>
      )}
    </div>
  );
}
