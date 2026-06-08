"use client";

import { useState } from "react";
import {
  CATEGORIES,
  type Category,
  type FridgeItem,
  zoneForCategory,
} from "@/lib/food";

interface Props {
  item: FridgeItem;
  onSave: (item: FridgeItem) => void;
  onCancel: () => void;
}

const fieldClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft";

export default function EditItemForm({ item, onSave, onCancel }: Props) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity);
  const [category, setCategory] = useState<Category>(item.category);
  const [expiresOn, setExpiresOn] = useState(item.expiresOn);

  function save() {
    if (!name.trim() || !expiresOn) return;
    onSave({
      ...item,
      name: name.trim(),
      quantity: quantity.trim(),
      category,
      zone: zoneForCategory(category),
      expiresOn,
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/30 p-4 sm:items-center">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="animate-pop-in max-h-[88vh] w-full max-w-md overflow-y-auto rounded-3xl border border-line bg-surface p-5 shadow-xl"
      >
        <h2 className="mb-3 text-base font-bold text-ink">食材を編集</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-ink-soft">食材名</span>
            <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-ink-soft">数量</span>
            <input className={fieldClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-ink-soft">カテゴリ</span>
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
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-ink-soft">賞味・消費期限</span>
            <input
              type="date"
              className={`${fieldClass} min-w-0 appearance-none`}
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              required
            />
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:bg-paper"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={save}
            className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99]"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
