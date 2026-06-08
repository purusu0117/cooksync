"use client";

import {
  estimateExpiry,
  todayISO,
  zoneForCategory,
  type FridgeItem,
} from "@/lib/food";
import { shoppingStore } from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import { staleByDate, type ShoppingItem } from "@/lib/shopping";

interface Props {
  onAddToFridge: (item: FridgeItem) => void;
}

function toFridgeItem(s: ShoppingItem): FridgeItem {
  const today = todayISO();
  return {
    id: crypto.randomUUID(),
    name: s.name,
    quantity: s.amount,
    category: "その他",
    zone: zoneForCategory("その他"),
    purchasedOn: today,
    expiresOn: estimateExpiry(today, 7), // 仮の期限。カードから編集可
    createdAt: Date.now(),
  };
}

/** Step 0a/0c：買い物リストのチェック済み→冷蔵庫へ、古い未チェック項目のクリーンアップ */
export default function MaintenancePanel({ onAddToFridge }: Props) {
  const [shopping, setShopping] = usePersistentList(shoppingStore);

  const checked = shopping.filter((s) => s.checked);
  const stale = staleByDate(shopping, todayISO(), 3);

  if (checked.length === 0 && stale.length === 0) return null;

  function moveToFridge(s: ShoppingItem) {
    onAddToFridge(toFridgeItem(s));
    setShopping((prev) => prev.filter((x) => x.id !== s.id));
  }

  function moveAll() {
    for (const s of checked) onAddToFridge(toFridgeItem(s));
    setShopping((prev) => prev.filter((x) => !x.checked));
  }

  function removeStale(s: ShoppingItem) {
    setShopping((prev) => prev.filter((x) => x.id !== s.id));
  }

  return (
    <section className="mb-5 rounded-3xl border border-brand/30 bg-brand-soft/60 p-4">
      <h2 className="mb-2 text-sm font-bold text-brand-dark">
        🧹 冷蔵庫メンテナンス
      </h2>

      {checked.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs text-ink-soft">
            買い物リストでチェック済み — 冷蔵庫へ移しますか？（期限は仮なのでカードから調整）
          </p>
          <ul className="flex flex-col gap-1.5">
            {checked.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm"
              >
                <span className="flex-1 truncate text-ink">
                  {s.name} <span className="text-ink-soft">{s.amount}</span>
                </span>
                <button
                  type="button"
                  onClick={() => moveToFridge(s)}
                  className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-brand-dark"
                >
                  → 冷蔵庫へ
                </button>
              </li>
            ))}
          </ul>
          {checked.length > 1 && (
            <button
              type="button"
              onClick={moveAll}
              className="mt-2 text-xs font-medium text-brand-dark underline"
            >
              すべて冷蔵庫へ移動（{checked.length}件）
            </button>
          )}
        </div>
      )}

      {stale.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-ink-soft">
            3日以上前から残っている未購入項目 — まだ必要？
          </p>
          <ul className="flex flex-col gap-1.5">
            {stale.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm"
              >
                <span className="flex-1 truncate text-ink-soft">
                  {s.name} {s.amount}
                </span>
                <button
                  type="button"
                  onClick={() => removeStale(s)}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-red-50 hover:text-red-600"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
