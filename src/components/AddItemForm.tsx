"use client";

import { useState } from "react";
import {
  CATEGORIES,
  type Category,
  type FridgeItem,
  todayISO,
  zoneForCategory,
} from "@/lib/food";
import { guessItem } from "@/lib/guess";

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
  // 自動推定を手入力で上書きしたかどうか
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [autofilled, setAutofilled] = useState(false);

  // 食材名が確定したら、カテゴリと期限を推定して未編集の欄に流し込む
  function autofillFromName() {
    if (!name.trim()) return;
    const g = guessItem(name.trim(), purchasedOn);
    let did = false;
    if (!categoryTouched) {
      setCategory(g.category);
      did = true;
    }
    if (!expiryTouched) {
      setExpiresOn(g.expiresOn);
      did = true;
    }
    setAutofilled(did);
  }

  function add() {
    const finalName = name.trim();
    if (!finalName) return;
    // 期限が空なら推定で補完
    const finalExpiry =
      expiresOn || guessItem(finalName, purchasedOn).expiresOn;

    onAdd({
      id: crypto.randomUUID(),
      name: finalName,
      quantity: quantity.trim(),
      category,
      zone: zoneForCategory(category),
      purchasedOn,
      expiresOn: finalExpiry,
      createdAt: Date.now(),
    });

    setName("");
    setQuantity("");
    setExpiresOn("");
    setCategoryTouched(false);
    setExpiryTouched(false);
    setAutofilled(false);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      className="rounded-3xl border border-line bg-surface p-4 shadow-sm"
    >
      <p className="mb-3 text-xs text-ink-soft">
        🤖 食材名を入れると<strong>カテゴリと賞味期限を自動推定</strong>します（あくまで目安。下の欄でいつでも修正できます）。
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink-soft">食材名</span>
          <input
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={autofillFromName}
            placeholder="例：鶏もも肉（入力後にカテゴリ・期限が埋まります）"
            required
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-ink-soft">数量</span>
          <input
            className={fieldClass}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="例：2本 / 約150g"
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-ink-soft">
            カテゴリ{!categoryTouched && autofilled && <span className="ml-1 text-brand">（自動）</span>}
          </span>
          <select
            className={fieldClass}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as Category);
              setCategoryTouched(true);
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-ink-soft">購入日</span>
          <input
            type="date"
            className={`${fieldClass} min-w-0 appearance-none`}
            value={purchasedOn}
            onChange={(e) => setPurchasedOn(e.target.value)}
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-ink-soft">
            賞味・消費期限{!expiryTouched && autofilled && <span className="ml-1 text-brand">（自動）</span>}
          </span>
          <input
            type="date"
            className={`${fieldClass} min-w-0 appearance-none`}
            value={expiresOn}
            onChange={(e) => {
              setExpiresOn(e.target.value);
              setExpiryTouched(true);
            }}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-4 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft"
        disabled={!name.trim()}
      >
        ＋ 冷蔵庫に追加
      </button>
    </form>
  );
}
