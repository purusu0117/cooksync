"use client";

// ホーム一等地の「作りかけに戻る」カード。
//
// 調理の進捗（どの作業までチェックしたか）は前から保存されていたのに、
// **ホームから戻る導線が無かった**。途中で手を止めた人は、次に開いたときに
// 自分でレシピを探し直さないと続きに戻れない。中断は失敗ではなく普通のこと
// （宅配が来た・子どもが呼んだ・煮込みの30分に一度アプリを閉じた）なので、
// 拾い直せる場所を1つだけ、一番目に入るところに置く。
//
// 出る条件は cookProgress.pickResumable に寄せてある（作り終えたもの・古すぎるものは出さない）。
// 該当が無ければ **1ピクセルも描かない**。常設のバナーにすると邪魔になるだけで、
// 「自分ごとのカードが出た日」のうれしさが消える。

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, CookingPot } from "lucide-react";
import { useAllRecipes } from "@/lib/useStore";
import { toCookTasks } from "@/lib/cookSteps";
import { pickResumable, useCookProgressList } from "@/lib/cookProgress";

/**
 * 「いつの続きか」を人の言葉で。時刻を持たない旧データは何も言わない（嘘を書かない）。
 *
 * ⚠️ 経過ミリ秒を86,400,000で割ってはいけない。
 *    夜21時に止めて翌朝9時に開くと12時間差＝「0日」になり「さっきの続き」と出る。
 *    人が言う「昨日」は経過時間ではなく**日付が変わったかどうか**なので、暦日で数える。
 */
function whenLabel(updatedAt: number, now: number): string {
  if (!updatedAt) return "";
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(updatedAt)) / 86_400_000);
  if (days <= 0) return "今日の続き";
  if (days === 1) return "昨日の続き";
  return `${days}日前の続き`;
}

export default function ResumeCooking() {
  const recipes = useAllRecipes();
  const entries = useCookProgressList();
  // 現在時刻は**描画中に読まない**（描画のたびに答えが変わる＝純粋でない）。
  // マウント後に一度だけ確定させる。0のあいだは何も描かないので、
  // 「古い作りかけが一瞬だけ出る」ようなちらつきも起きない。
  // （effect本体での同期setStateは避ける＝RecipeSources と同じ書き方）
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(t);
  }, [entries]);

  const resume = useMemo(() => {
    if (!now) return null;
    const totals = new Map<string, number>();
    const nameOf = new Map<string, string>();
    for (const r of recipes) {
      totals.set(r.id, toCookTasks(r.steps).length);
      nameOf.set(r.id, r.name);
    }
    const picked = pickResumable(entries, (id) => totals.get(id) ?? 0, now);
    if (!picked) return null;
    return {
      ...picked,
      name: nameOf.get(picked.recipeId) ?? "",
      total: totals.get(picked.recipeId) ?? 0,
      when: whenLabel(picked.updatedAt, now),
    };
  }, [recipes, entries, now]);

  if (!resume || !resume.name) return null;

  const percent = Math.round((resume.doneCount / resume.total) * 100);

  return (
    <Link
      href={`/recipes/${resume.recipeId}`}
      className="mb-5 flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent-soft p-4 shadow-sm transition hover:shadow-md active:scale-[0.99]"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-surface text-accent-dark">
        <CookingPot size={26} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        {/* 料理名が主役。1行で切ると「作りかけの「喫茶店風ナポリタ…」となって
            肝心の何を作りかけたのかが読めないので、2行まで許す */}
        <span className="line-clamp-2 block text-sm leading-snug font-bold text-accent-dark">
          作りかけの「{resume.name}」に戻る
        </span>
        <span className="mt-0.5 block text-xs text-ink-soft">
          {resume.when && `${resume.when}・`}
          {resume.total}作業のうち{resume.doneCount}つまで終わっています
        </span>
        {/* 進み具合を1本の線で。数字だけより「あと少し」が伝わる */}
        <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.max(6, percent)}%` }}
          />
        </span>
      </span>
      <ChevronRight size={20} className="shrink-0 text-accent-dark" />
    </Link>
  );
}
