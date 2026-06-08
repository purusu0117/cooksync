"use client";

import {
  CATEGORY_EMOJI,
  daysUntil,
  estimateExpiry,
  freshnessOf,
  todayISO,
  type FridgeItem,
} from "@/lib/food";
import { FreshnessBadge, FRESHNESS_UI } from "./freshness";

interface Props {
  item: FridgeItem;
  onDelete: (id: string) => void;
  onUpdate: (item: FridgeItem) => void;
  onEdit: (item: FridgeItem) => void;
}

/** 数量文字列の先頭の数値を半分にする（できなければ「（半分）」を付す） */
function halveQuantity(q: string): string {
  const m = q.match(/^(\d+(?:\.\d+)?)/);
  if (m) {
    const half = Number(m[1]) / 2;
    return q.replace(m[1], String(half));
  }
  return q ? `${q}（半分）` : "半分";
}

export default function FoodCard({ item, onDelete, onUpdate, onEdit }: Props) {
  const left = daysUntil(item.expiresOn);
  const freshness = freshnessOf(item.expiresOn);
  const ui = FRESHNESS_UI[freshness];

  function handleCut() {
    const today = todayISO();
    onUpdate({ ...item, cutOn: today, expiresOn: estimateExpiry(today, 4) });
  }

  function handleHalve() {
    onUpdate({ ...item, quantity: halveQuantity(item.quantity) });
  }

  return (
    <li
      className={`animate-pop-in rounded-2xl border border-l-4 border-line ${ui.accentBorder} bg-surface p-3 shadow-sm transition hover:shadow-md`}
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-paper text-xl"
          aria-hidden
        >
          {CATEGORY_EMOJI[item.category]}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="truncate font-semibold text-ink">{item.name}</p>
            {item.quantity && (
              <span className="shrink-0 text-sm text-ink-soft">
                {item.quantity}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-soft/80">
            {item.cutOn ? `加工 ${item.cutOn}` : `購入 ${item.purchasedOn}`}　期限 {item.expiresOn}
          </p>
        </div>

        <FreshnessBadge freshness={freshness} daysLeft={left} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="rounded-lg px-2 py-1 text-xs font-medium text-ink-soft transition hover:bg-brand-soft hover:text-brand-dark"
        >
          ✏️ 編集
        </button>
        <button
          type="button"
          onClick={handleHalve}
          className="rounded-lg px-2 py-1 text-xs font-medium text-ink-soft transition hover:bg-brand-soft hover:text-brand-dark"
        >
          ½ 半分使った
        </button>
        <button
          type="button"
          onClick={handleCut}
          className="rounded-lg px-2 py-1 text-xs font-medium text-ink-soft transition hover:bg-brand-soft hover:text-brand-dark"
        >
          🔪 切った
        </button>
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-ink-soft transition hover:bg-red-50 hover:text-red-600"
        >
          ✓ 使い切った
        </button>
      </div>
    </li>
  );
}
