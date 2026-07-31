"use client";

// ホームの「今週の記録」。**AIを呼ばない**（原価0）。データは
// 「作った」の記録(mealStore)と冷蔵庫(fridgeStore)から決定論で作る。
//
// 狙いは継続率。料理は成果物が残らない（食べたら消える）ので、
// やった量が見えないまま「今日も何か作らなきゃ」だけが積み上がる。
// 家計簿が「今月いくら貯まった」を見せるのと同じ理屈で、
// **積み上がりが見えること自体**が、もう一度開く理由になる。
//
// 出し分け：
//   ・「作った」記録が1件も無い人 → **何も描かない**。0点の成績表を初日に見せない
//     （ホームの上のほうは初見の人が見る場所なので、悩みの言葉だけを置く）
//   ・今週まだ0品の人 → 責めない。連続記録は残したまま、
//     「期限が近い食材」を次の一歩として出す（＝今日開く理由をこちらから渡す）

import Link from "next/link";
import { useMemo } from "react";
import { ChevronRight, Flame } from "lucide-react";
import { fridgeStore, mealStore } from "@/lib/storage";
import { usePersistentList, useAllRecipes } from "@/lib/useStore";
import { buildWeeklyRecap } from "@/lib/weeklyRecap";

export default function WeeklyRecap() {
  const [meals] = usePersistentList(mealStore);
  const [fridge] = usePersistentList(fridgeStore);
  const recipes = useAllRecipes();

  const recap = useMemo(
    () => buildWeeklyRecap({ meals, recipes, fridge }),
    [meals, recipes, fridge],
  );

  if (!recap.hasHistory) return null;

  const diff = recap.madeCount - recap.prevMadeCount;

  return (
    <section className="mb-7">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-base font-bold text-brand-dark">今週の記録</h2>
        {recap.streakWeeks >= 2 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent-dark">
            <Flame size={13} strokeWidth={2.2} />
            {recap.streakWeeks}週つづけて料理中
          </span>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
        {recap.madeCount > 0 ? (
          <>
            <div className="flex items-end gap-4">
              <Stat value={recap.madeCount} unit="品" label="作った" />
              <Stat value={recap.activeDays} unit="日" label="キッチンに立った" />
              <Stat value={recap.ingredients.length} unit="種類" label="使った食材" />
            </div>

            {diff !== 0 && (
              <p className="mt-3 text-xs text-ink-soft">
                {diff > 0
                  ? `先週より${diff}品多く作りました。`
                  : `先週は${recap.prevMadeCount}品でした。`}
              </p>
            )}

            {/* 何を作ったか。名前が並ぶと「1週間ぶんの自分の料理」として見える */}
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {recap.dishes.slice(0, 6).map((d) => (
                <li
                  key={d.recipeId}
                  className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-dark"
                >
                  {d.name}
                  {d.count > 1 && <span className="ml-1 font-bold">×{d.count}</span>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm leading-relaxed text-ink">
            今週はまだ記録がありません。
            {recap.streakWeeks > 0 && (
              <span className="text-ink-soft">
                {" "}
                先週まで{recap.streakWeeks}週つづいています。
              </span>
            )}
          </p>
        )}

        {/* 冷蔵庫の今。「次に何をすればいいか」を1行で渡す＝明日また開く理由になる */}
        <div className="mt-3 border-t border-line pt-3">
          {recap.expired > 0 ? (
            <Next
              href="/fridge"
              text={`期限が過ぎた食材が${recap.expired}個あります。片づけて数え直しましょう`}
            />
          ) : recap.expiringSoon > 0 ? (
            <Next
              href="/meal"
              text={`${recap.expiringNames.join("・")}があと3日以内。これで作れる献立を見る`}
            />
          ) : (
            <p className="text-xs leading-relaxed text-ink-soft">
              期限切れはありません。この調子で使い切っていきましょう。
            </p>
          )}
        </div>
      </div>
    </section>
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

/** 次の一歩。タップ領域は44px以上（py-2.5 + 文字 = 約46px） */
function Next({ href, text }: { href: string; text: string }) {
  return (
    <Link
      href={href}
      className="-mx-1 flex items-center gap-2 rounded-xl px-1 py-2.5 transition hover:bg-paper"
    >
      <span className="min-w-0 flex-1 text-xs leading-relaxed font-medium text-accent-dark">
        {text}
      </span>
      <ChevronRight size={16} className="shrink-0 text-accent-dark" />
    </Link>
  );
}
