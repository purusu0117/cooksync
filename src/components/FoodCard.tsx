"use client";

import {
  CATEGORY_EMOJI,
  daysUntil,
  FRESHNESS,
  freshnessOf,
  type FoodItem,
} from "@/lib/food";

interface Props {
  item: FoodItem;
  onDelete: (id: string) => void;
}

export default function FoodCard({ item, onDelete }: Props) {
  const left = daysUntil(item.expiresOn);
  const style = FRESHNESS[freshnessOf(item.expiresOn)];

  return (
    <li
      className={`flex items-center gap-3 rounded-xl border ${style.border} bg-white p-3 shadow-sm transition hover:shadow-md`}
    >
      <span className="text-2xl" aria-hidden>
        {CATEGORY_EMOJI[item.category]}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="truncate font-medium text-zinc-900">{item.name}</p>
          {item.quantity && (
            <span className="shrink-0 text-sm text-zinc-500">
              {item.quantity}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-zinc-400">
          購入 {item.purchasedOn}　期限 {item.expiresOn}
        </p>
      </div>

      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${style.badge}`}
      >
        {style.emoji} {style.label(left)}
      </span>

      <button
        type="button"
        onClick={() => onDelete(item.id)}
        aria-label={`${item.name}を削除`}
        className="shrink-0 rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-red-500"
      >
        ✕
      </button>
    </li>
  );
}
