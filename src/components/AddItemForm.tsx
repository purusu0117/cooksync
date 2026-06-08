"use client";

import { useState } from "react";
import {
  CATEGORIES,
  type Category,
  type FoodItem,
  todayISO,
} from "@/lib/food";

interface Props {
  onAdd: (item: FoodItem) => void;
}

const fieldClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export default function AddItemForm({ onAdd }: Props) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [category, setCategory] = useState<Category>("野菜");
  const [purchasedOn, setPurchasedOn] = useState(todayISO());
  const [expiresOn, setExpiresOn] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !expiresOn) return;

    onAdd({
      id: crypto.randomUUID(),
      name: name.trim(),
      quantity: quantity.trim(),
      category,
      purchasedOn,
      expiresOn,
      createdAt: Date.now(),
    });

    // 次の入力に備えてリセット（カテゴリと購入日は据え置き）
    setName("");
    setQuantity("");
    setExpiresOn("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            食材名
          </span>
          <input
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：にんじん"
            required
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            数量
          </span>
          <input
            className={fieldClass}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="例：2本 / 約150g"
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            カテゴリ
          </span>
          <select
            className={fieldClass}
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            購入日
          </span>
          <input
            type="date"
            className={fieldClass}
            value={purchasedOn}
            onChange={(e) => setPurchasedOn(e.target.value)}
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            賞味・消費期限
          </span>
          <input
            type="date"
            className={fieldClass}
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            required
          />
        </label>
      </div>

      <button
        type="submit"
        className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        disabled={!name.trim() || !expiresOn}
      >
        ＋ 追加する
      </button>
    </form>
  );
}
