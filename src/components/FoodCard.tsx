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

// カード下の操作ボタン。
// ⚠️ 以前は `px-2 py-1` で**高さ31px**しかなく、Appleのヒューマンインターフェース
//    ガイドラインの最小44ptを下回っていた。冷蔵庫は片手・キッチンで濡れた指で触る画面なので、
//    ここが小さいと「半分使った」を押したつもりで「使い切った」が押される。
//    高さは min-h-11（44px）で確保し、見た目の余白は px 側で調整する。
const ROW_ACTION_BASE =
  "inline-flex min-h-11 items-center rounded-lg px-2.5 text-xs font-medium text-ink-soft transition";
const ROW_ACTION = `${ROW_ACTION_BASE} hover:bg-brand-soft hover:text-brand-dark`;

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
          className={ROW_ACTION}
        >
          <Pencil size={14} strokeWidth={2} className="mr-1" />
          編集
        </button>
        <button
          type="button"
          onClick={handleHalve}
          className={ROW_ACTION}
        >
          ½ 半分使った
        </button>
        <button
          type="button"
          onClick={handleCut}
          className={ROW_ACTION}
        >
          <Scissors size={14} strokeWidth={2} className="mr-1" />
          切った
        </button>
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className={`ml-auto ${ROW_ACTION_BASE} hover:bg-red-50 hover:text-red-600`}
        >
          <Check size={14} strokeWidth={2.5} className="mr-1" />
          使い切った
        </button>
      </div>
    </li>
  );
}

/**
 * 冷蔵庫カードは1画面に100枚並ぶ。1枚触っただけで100枚とも作り直すのは無駄なので memo する。
 *
 * **比較関数は付けない（React 既定の浅い比較に任せる）。**
 * 一度は「item だけ見てハンドラの同一性は無視する」比較関数を書いたが、これは
 * 「ハンドラが setState の updater しか呼んでいない」という**呼び出し側の内部事情**に
 * 依存していて、FridgeApp 側でハンドラが props や state を参照した瞬間に
 * 古い値を掴んだまま（stale closure）になる時限爆弾だった。
 *
 * 正しい直し方は**渡す側で同一性を固定すること**なので、FridgeApp の
 * deleteItem / updateItem / addItem / addMany / updateMany を useCallback にした。
 * onEdit は useState のセッター（元から固定）。よって浅い比較で memo は効く。
 *
 * ⚠️ FoodCard に props を足すときは、**その props も同一性が安定しているか**を確認すること。
 *    インラインの arrow やレンダー中に作るオブジェクトを渡すと memo は即座に無効になる。
 *    意図は回帰テストで固定してある（src/components/__tests__/foodCardMemo.test.tsx）。
 */
export default memo(FoodCard);
