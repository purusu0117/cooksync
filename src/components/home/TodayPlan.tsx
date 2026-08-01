"use client";

// ホームの「今日の献立」カード。
//
// なぜ要るか（2026-08-01 マーケ部門の指摘）:
//   献立ウィザードで確定した計画は mealStore に日付・昼夜つきで保存されるのに、
//   翌日ホームを開いても**自分が決めた献立がどこにも出ていなかった**。
//   「明日もう一度開く理由」の一等地が空いている状態。決めた献立が朝いちばんに
//   見えることが、そのまま「今日もこのアプリで料理する」への導線になる。
//
// 出し方:
//   ・今日の日付の、まだ作っていない（made でない）計画だけを出す。無い日は何も描かない
//   ・「作った」の記録はここではしない。実際の「作った」ボタン（RecipeDetail）は
//     冷蔵庫の在庫消費までセットで行うので、ここに簡易版を作ると在庫がズレる。
//     カードはレシピへ送るだけにする。

import Link from "next/link";
import { ChevronRight, UtensilsCrossed } from "lucide-react";
import { mealStore } from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import { todayISO } from "@/lib/food";
import DishIcon from "@/components/DishIcon";

export default function TodayPlan() {
  const [meals] = usePersistentList(mealStore);
  const today = todayISO();
  const plan = meals.filter((m) => m.date === today && !m.made);
  if (plan.length === 0) return null;

  return (
    <section className="mb-7">
      <h2 className="mb-2.5 inline-flex items-center gap-1.5 text-base font-bold text-brand-dark">
        <UtensilsCrossed size={18} strokeWidth={2} />
        今日の献立
      </h2>
      <ul className="flex flex-col gap-2">
        {plan.map((m) => (
          <li key={m.id}>
            <Link
              href={`/recipes/${m.recipeId}`}
              className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-2.5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md active:scale-[0.99]"
            >
              <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-dark">
                {m.slot}
              </span>
              <DishIcon name={m.recipeName} size={24} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                {m.recipeName}
              </span>
              <ChevronRight size={16} className="shrink-0 text-ink-soft" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
        作り終えたら、レシピの「作った」ボタンで記録できます（今週の記録にたまります）。
      </p>
    </section>
  );
}
