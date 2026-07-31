"use client";

import { memo } from "react";
import { Apple, Check, Pencil, Scissors } from "lucide-react";
import { CATEGORY_ICON } from "./categoryIcon";
import {
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

function FoodCard({ item, onDelete, onUpdate, onEdit }: Props) {
  // ★「今日」は1枚につき1回だけ求める。
  //   daysUntil / freshnessOf は既定引数で todayISO()＝new Date() を各々呼ぶので、
  //   何も渡さないと1枚あたり2回、100件で200回 Date を作ることになる。
  const today = todayISO();
  const left = daysUntil(item.expiresOn, today);
  const freshness = freshnessOf(item.expiresOn, today);
  const ui = FRESHNESS_UI[freshness];

  function handleCut() {
    const today = todayISO();
    onUpdate({ ...item, cutOn: today, expiresOn: estimateExpiry(today, 4) });
  }

  function handleHalve() {
    onUpdate({ ...item, quantity: halveQuantity(item.quantity) });
  }

  const Icon = CATEGORY_ICON[item.category] ?? Apple;

  return (
    <li
      className={`animate-pop-in rounded-2xl border border-l-4 border-line ${ui.accentBorder} bg-surface p-3 shadow-sm transition hover:shadow-md`}
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-paper text-brand"
          aria-hidden
        >
          <Icon size={20} strokeWidth={1.8} />
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
          <Pencil size={12} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
          編集
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
          <Scissors size={12} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
          切った
        </button>
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-ink-soft transition hover:bg-red-50 hover:text-red-600"
        >
          <Check size={12} strokeWidth={2.5} className="mr-1 inline-block align-[-0.15em]" />
          使い切った
        </button>
      </div>
    </li>
  );
}

/**
 * 冷蔵庫カードは1画面に100枚並ぶ。1枚触っただけで100枚とも作り直すのは無駄なので memo する。
 *
 * ★比較関数で **item だけ** を見て、3つのハンドラの同一性は無視している。理由：
 *   親（FridgeApp）の deleteItem / updateItem は毎レンダー作り直される普通の関数宣言で、
 *   既定の浅い比較だと毎回「変わった」と判定されて memo が1回も効かない。
 *   一方この3つは中身が
 *       setItems(prev => …)  ／  setEditing
 *   だけで、**レンダーごとの値を一切捕まえていない**（stale closure が原理的に起きない）。
 *   つまり古い関数を握り続けても結果は同じなので、無視して安全。
 *   setItems 自体は useServerList の useCallback([key]) で同一性が固定されている。
 *
 * ⚠️ FridgeApp 側でハンドラが props や state を参照するようになったら、この比較関数は
 *    古い値を掴んだままになる。**その時は比較関数を消して（既定の浅い比較に戻して）、
 *    代わりに FridgeApp 側で useCallback すること。** 回帰テストで意図を固定してある
 *    （src/components/__tests__/foodCardMemo.test.tsx）。
 */
export default memo(FoodCard, (prev, next) => prev.item === next.item);
