// プレミアム特典「作った料理の記録が、ずっと残る」の中身を組み立てる純粋ロジック。
// **AIを一切呼ばない**（原価0）。だからこそ ¥480 の中に入れられる。
//
// ホームの「今週の記録」(components/home/WeeklyRecap.tsx) は**無料のまま一切変えない**。
// これはその過去ぶんを並べるだけの**追加**で、無料ユーザーから取り上げたものは1つもない。
//
// ⚠️ **数字を盛らない**（weeklyRecap.ts と同じ原則）。
//    過去の週について「そのとき冷蔵庫に何があったか」の記録は**存在しない**。
//    だから buildWeeklyRecap に fridge:[] を渡し、期限まわりの欄は**表示しない**。
//    「先週は3個ムダにしませんでした」のような、記録から言えないことは書かない。

import { buildWeeklyRecap, mondayOf, type RecapDish } from "@/lib/weeklyRecap";
import type { MealEntry } from "@/lib/mealplan";
import { todayISO } from "@/lib/food";

/** さかのぼる週数。12週＝約3ヶ月。これ以上は縦に長いだけで読まれない。 */
export const HISTORY_WEEKS = 12;

export interface RecapWeekSummary {
  /** その週の月曜 yyyy-mm-dd */
  weekStart: string;
  /** 画面に出す見出し（「7/27の週」） */
  label: string;
  /** その週に作った品数 */
  madeCount: number;
  /** その週にキッチンに立った日数 */
  activeDays: number;
  /** 作った料理（多い順） */
  dishes: RecapDish[];
  /** 使った食材の種類数 */
  ingredientCount: number;
}

const DAY_MS = 86_400_000;

function parseISO(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function toISO(ms: number): string {
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** 「7/27の週」。年は同じ年のあいだ冗長なので出さない。 */
export function weekLabel(mondayISO: string): string {
  const [, m, d] = mondayISO.split("-");
  return `${Number(m)}/${Number(d)}の週`;
}

export interface RecapHistoryInput {
  meals: MealEntry[];
  recipes: { id: string; ingredients: { name: string; basicSeasoning?: boolean }[] }[];
  today?: string;
  weeks?: number;
}

/**
 * **先週から** さかのぼって週ごとの記録を作る（今週はホームに出ているので含めない）。
 *
 * 1品も作らなかった週は返さない。空の行が並ぶと「サボった週」の一覧になり、
 * 続けている人ほど見たくなくなる（weeklyRecap.ts の streak の考え方と揃える）。
 */
export function buildRecapHistory({
  meals,
  recipes,
  today = todayISO(),
  weeks = HISTORY_WEEKS,
}: RecapHistoryInput): RecapWeekSummary[] {
  const thisMonday = mondayOf(today);
  const out: RecapWeekSummary[] = [];
  for (let i = 1; i <= weeks; i++) {
    const monday = toISO(parseISO(thisMonday) - i * 7 * DAY_MS);
    // fridge:[] は意図的。過去の冷蔵庫の記録は存在しないので、期限の欄は作らない。
    const recap = buildWeeklyRecap({ meals, recipes, fridge: [], today: monday });
    if (recap.madeCount === 0) continue;
    out.push({
      weekStart: recap.weekStart,
      label: weekLabel(recap.weekStart),
      madeCount: recap.madeCount,
      activeDays: recap.activeDays,
      dishes: recap.dishes,
      ingredientCount: recap.ingredients.length,
    });
  }
  return out;
}

/** 期間全体の合計。「3ヶ月で◯品」という見え方をつくる（積み上がりが継続の理由になる）。 */
export function historyTotals(weeksList: RecapWeekSummary[]): {
  madeCount: number;
  activeDays: number;
  weeks: number;
} {
  return {
    madeCount: weeksList.reduce((n, w) => n + w.madeCount, 0),
    activeDays: weeksList.reduce((n, w) => n + w.activeDays, 0),
    weeks: weeksList.length,
  };
}
