"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import {
  CATEGORIES,
  estimateExpiry,
  type Category,
  type FridgeItem,
  todayISO,
  zoneForCategory,
} from "@/lib/food";
import { guessItem } from "@/lib/guess";
import { estimateExpiryDays } from "@/lib/expiryAI";
import { packOf, quantitySuggestions } from "@/lib/packaging";

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
  const [opened, setOpened] = useState(false); // 開封済み＝期限は開封後の目安で計算
  // 自動推定を手入力で上書きしたかどうか
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [autofilled, setAutofilled] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNote, setAiNote] = useState(""); // AIが推定したときの根拠メモ

  const trimmed = name.trim();
  const pack = trimmed ? packOf(trimmed) : null;
  const qtyChips = trimmed ? quantitySuggestions(trimmed) : [];

  // 食材名が確定したら、カテゴリと期限を推定して未編集の欄に流し込む
  function autofillFromName(nextOpened = opened) {
    const n = name.trim();
    if (!n) return;
    const g = guessItem(n, purchasedOn, nextOpened);
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
    setAiNote("");
    // 辞書に無い食材は AI に日持ちを聞いて精度を上げる（失敗しても上の推定のまま動く）
    if (g.needsAI) void refineWithAI(n, nextOpened);
  }

  async function refineWithAI(n: string, nextOpened: boolean) {
    setAiLoading(true);
    try {
      const res = await estimateExpiryDays([{ name: n, opened: nextOpened }]);
      const est = res[n];
      if (est && !expiryTouched && name.trim() === n) {
        setExpiresOn(estimateExpiry(purchasedOn, est.days));
        setAiNote(
          `AI推定：${est.days}日${est.storage ? `・${est.storage}` : ""}${est.note ? `（${est.note}）` : ""}`,
        );
      }
    } finally {
      setAiLoading(false);
    }
  }

  function toggleOpened(next: boolean) {
    setOpened(next);
    if (!expiryTouched && name.trim()) {
      const g = guessItem(name.trim(), purchasedOn, next);
      setExpiresOn(g.expiresOn);
      if (g.needsAI) void refineWithAI(name.trim(), next);
    }
  }

  function add() {
    const finalName = name.trim();
    if (!finalName) return;
    // 期限が空なら推定で補完
    const finalExpiry =
      expiresOn || guessItem(finalName, purchasedOn, opened).expiresOn;

    onAdd({
      id: crypto.randomUUID(),
      name: finalName,
      quantity: quantity.trim(),
      category,
      zone: zoneForCategory(category),
      purchasedOn,
      expiresOn: finalExpiry,
      openedOn: opened ? purchasedOn : undefined,
      createdAt: Date.now(),
    });

    setName("");
    setQuantity("");
    setExpiresOn("");
    setOpened(false);
    setCategoryTouched(false);
    setExpiryTouched(false);
    setAutofilled(false);
    setAiNote("");
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
        <Bot size={13} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
        食材名を入れると<strong>カテゴリと賞味期限を自動推定</strong>します（知らない食材はAIが日持ちを調べます。いつでも下の欄で修正できます）。
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink-soft">食材名</span>
          <input
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => autofillFromName()}
            placeholder="例：鶏もも肉（入力後にカテゴリ・期限が埋まります）"
            required
          />
        </label>

        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink-soft">数量</span>
          <input
            className={fieldClass}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="例：1パック / 2本 / 約150g"
          />
          {/* 箱・パック売りで「中身が何個か分からない」食材は、売っている単位で入れられるようにする */}
          {qtyChips.length > 0 && (
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              {qtyChips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setQuantity(c)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    quantity === c
                      ? "border-brand bg-brand text-white"
                      : "border-line bg-paper text-ink-soft hover:border-brand hover:text-brand-dark"
                  }`}
                >
                  {c}
                </button>
              ))}
            </span>
          )}
          {pack?.hint && (
            <span className="mt-1 block text-xs text-ink-soft">
              目安：{pack.hint}（個数が分からなければ「1{pack.unit}」でOK）
            </span>
          )}
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

        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink-soft">
            賞味・消費期限
            {!expiryTouched && autofilled && <span className="ml-1 text-brand">（自動）</span>}
            {aiLoading && <span className="ml-1 text-brand-dark">AIが確認中…</span>}
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
          {aiNote && !expiryTouched && (
            <span className="mt-1 block text-xs text-brand-dark">
              <Bot size={12} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
              {aiNote}
            </span>
          )}
        </label>
      </div>

      {/* 開封済みかどうかで期限は大きく変わる（未開封のしょうゆ=1年半 / 開封後=1ヶ月） */}
      <label className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
        <input
          type="checkbox"
          checked={opened}
          onChange={(e) => toggleOpened(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-brand)]"
        />
        開封済み（開封後の日持ちで期限を計算）
      </label>

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
