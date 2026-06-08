"use client";

import { useState } from "react";
import {
  CATEGORIES,
  type Category,
  type FridgeItem,
  todayISO,
  zoneForCategory,
} from "@/lib/food";

interface Props {
  onAdd: (item: FridgeItem) => void;
}

const fieldClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft";

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
      zone: zoneForCategory(category),
      purchasedOn,
      expiresOn,
      createdAt: Date.now(),
    });

    setName("");
    setQuantity("");
    setExpiresOn("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl border border-line bg-surface p-4 shadow-sm"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink-soft">
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
          <span className="mb-1 block text-xs font-medium text-ink-soft">
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
          <span className="mb-1 block text-xs font-medium text-ink-soft">
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
          <span className="mb-1 block text-xs font-medium text-ink-soft">
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
          <span className="mb-1 block text-xs font-medium text-ink-soft">
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
        className="mt-4 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft"
        disabled={!name.trim() || !expiresOn}
      >
        ＋ 冷蔵庫に追加
      </button>
    </form>
  );
}
