"use client";

// プレミアム特典「作った料理の記録が、ずっと残る」の画面（/premium/recap）。
//
// ⚠️ **ホームの「今週の記録」は無料のまま。1行も変えていない。**
//    これは過去12週ぶんを並べる**追加の画面**で、無料ユーザーから取り上げたものはない。
//    未加入の人にはロック表示を出すが、そこにも「今週ぶんは無料で見られます」と必ず書く。
//
// AIを呼ばないので原価0。だから ¥480 の中に入れられる（新しいAI機能を足すと原価が増え、
// pricing.ts の1人あたり原価上限 ¥220 を圧迫する）。

import { useMemo } from "react";
import Link from "next/link";
import { History, Lock } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { fridgeStore, mealStore } from "@/lib/storage";
import { usePersistentList, useAllRecipes } from "@/lib/useStore";
import { buildWeeklyRecap } from "@/lib/weeklyRecap";
import { useUsage } from "@/lib/usage";
import { HISTORY_WEEKS, buildRecapHistory, historyTotals } from "./recapHistory";

export default function RecapHistory() {
  const { premium } = useUsage();
  const [meals] = usePersistentList(mealStore);
  const [fridge] = usePersistentList(fridgeStore);
  const recipes = useAllRecipes();

  const weeks = useMemo(
    () => (premium ? buildRecapHistory({ meals, recipes }) : []),
    [premium, meals, recipes],
  );
  const totals = useMemo(() => historyTotals(weeks), [weeks]);
  // 今週ぶんは**未加入でも見える**（ホームと同じもの）。ロック画面でもこれは隠さない。
  const thisWeek = useMemo(
    () => buildWeeklyRecap({ meals, recipes, fridge }),
    [meals, recipes, fridge],
  );

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-4">
      <PageHeader
        title="作った料理の記録"
        tagline={`今週で${thisWeek.madeCount}品。ここには先週より前の記録が残ります。`}
        Icon={History}
        iconClass="text-brand"
      />

      {!premium ? (
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-bold text-ink">
            <Lock size={16} className="shrink-0 text-ink-soft" />
            過去の記録はプレミアムで見られます
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">
            ホームの「今週の記録」は今までどおり無料で見られます。ここで増えるのは、先週より前の
            {HISTORY_WEEKS}週ぶんをさかのぼって見られることだけです。
          </p>
          <Link
            href="/premium"
            className="mt-3 flex min-h-[48px] items-center justify-center rounded-2xl bg-brand text-sm font-bold text-white active:scale-[.98]"
          >
            プレミアムを見る
          </Link>
        </div>
      ) : weeks.length === 0 ? (
        <p className="rounded-2xl bg-paper p-4 text-sm leading-relaxed text-ink-soft">
          先週より前の記録はまだありません。レシピの「作った」ボタンで記録が残ります。
        </p>
      ) : (
        <>
          <div className="mb-4 flex items-end gap-5 rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <Stat value={totals.madeCount} unit="品" label={`${totals.weeks}週ぶんの合計`} />
            <Stat value={totals.activeDays} unit="日" label="キッチンに立った" />
          </div>

          <ul className="flex flex-col gap-2.5">
            {weeks.map((w) => (
              <li
                key={w.weekStart}
                className="rounded-2xl border border-line bg-surface p-4 shadow-sm"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-brand-dark">{w.label}</p>
                  <p className="shrink-0 text-xs text-ink-soft tabular-nums">
                    {w.madeCount}品 / {w.activeDays}日 / 食材{w.ingredientCount}種類
                  </p>
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {w.dishes.map((d) => (
                    <li
                      key={d.recipeId}
                      className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-dark"
                    >
                      {d.name}
                      {d.count > 1 && <span className="ml-1 font-bold">×{d.count}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          {/* ⚠️ 期限・ムダにしなかった量は**出さない**。過去の冷蔵庫の記録が無いので作れない。
                 作れない数字を出すと、一度でも嘘だと気づかれた瞬間に全部の数字が信じられなくなる。 */}
          <p className="mt-4 text-xs leading-relaxed text-ink-soft">
            「作った」ボタンで記録した料理だけを数えています。1品も作らなかった週は表示しません。
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ value, unit, label }: { value: number; unit: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="text-2xl leading-none font-bold text-brand-dark">
        {value}
        <span className="ml-0.5 text-sm font-bold">{unit}</span>
      </p>
      <p className="mt-1 truncate text-xs text-ink-soft">{label}</p>
    </div>
  );
}
