"use client";

import { useMemo, useState } from "react";
import { shoppingStore } from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import type { ShoppingItem } from "@/lib/shopping";
import PageHeader from "@/components/PageHeader";

const fieldClass =
  "rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft";

export default function ShoppingList() {
  const [items, setItems] = usePersistentList(shoppingStore);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  const { todo, done } = useMemo(
    () => ({
      todo: items.filter((i) => !i.checked),
      done: items.filter((i) => i.checked),
    }),
    [items],
  );

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        amount: amount.trim(),
        checked: false,
        addedAt: Date.now(),
      },
    ]);
    setName("");
    setAmount("");
  }

  function toggle(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)),
    );
  }
  function remove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function row(i: ShoppingItem) {
    return (
      <li
        key={i.id}
        className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-sm"
      >
        <button
          type="button"
          onClick={() => toggle(i.id)}
          aria-label="チェック"
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs transition ${
            i.checked ? "border-brand bg-brand text-white" : "border-line bg-paper"
          }`}
        >
          {i.checked && "✓"}
        </button>
        <span
          className={`flex-1 truncate text-sm ${
            i.checked ? "text-ink-soft line-through" : "text-ink"
          }`}
        >
          {i.name}
          {i.amount && <span className="ml-1.5 text-ink-soft">{i.amount}</span>}
          {i.note && (
            <span className="ml-1.5 text-xs text-ink-soft/80">（{i.note}）</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => remove(i.id)}
          aria-label="削除"
          className="shrink-0 rounded-lg p-1.5 text-ink-soft transition hover:bg-red-50 hover:text-red-600"
        >
          ✕
        </button>
      </li>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <PageHeader
        kicker="Shopping"
        title="買い物リスト"
        tagline="献立から自動追加された不足食材もここに。買ったらチェック→冷蔵庫の「メンテナンス」から在庫へ移せます。"
      />

      <form onSubmit={add} className="mb-5 flex gap-2">
        <input
          className={`${fieldClass} flex-1`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="買うもの（例：玉ねぎ）"
        />
        <input
          className={`${fieldClass} w-28`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="数量"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-95 disabled:bg-line disabled:text-ink-soft"
        >
          追加
        </button>
      </form>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface/60 py-12 text-center text-sm text-ink-soft">
          買い物リストは空です。
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <ul className="flex flex-col gap-2">{todo.map(row)}</ul>
          {done.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-ink-soft">
                購入済み（{done.length}）
              </p>
              <ul className="flex flex-col gap-2">{done.map(row)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
