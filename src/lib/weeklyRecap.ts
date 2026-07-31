// 「今週の記録」を組み立てる純粋ロジック。**AIを一切呼ばない**（原価0）。
//
// なぜ要るか：
//   料理は「やった感」が残りにくい。作った直後に皿は空になり、翌日には何を作ったか忘れる。
//   家計簿アプリが「今月いくら貯まった」を見せるのと同じで、
//   **積み上がりが見えること自体**が、明日もう一度開く理由になる。
//   Food&Drinkの継続率は全カテゴリ最下位（Day1 16.5%/Day7 7%/Day30 3.9%）で、
//   その理由は「取引的で、ロイヤルティが育たない」こと。記録は取引を関係に変える数少ない手段。
//
// ⚠️ **数字を盛らない。** このアプリには「食材をいつ捨てたか」のログが無い。
//    だから「◯g捨てずに済みました」は**作れない**。作れないものを出すと、
//    一度でも嘘だと気づかれた瞬間にアプリ全体の数字が信じられなくなる。
//    ここで出すのは、記録から**そのまま言える事実**だけにしてある：
//      ・作った品数／作った日数（「作った」ボタンの記録そのもの）
//      ・その料理に使った食材の種類数（作ったレシピの材料そのもの）
//      ・いま冷蔵庫にある期限切れの数（在庫そのもの）
//
// 週の区切りは**月曜始まり**。AI枠が回復するのも月曜（aiLimits.weekKey）なので、
// 「月曜にリセットされる」という体験を1つに揃える。

import type { MealEntry } from "./mealplan";
import type { FridgeItem } from "./food";
import { daysUntil, todayISO } from "./food";

/** 期限が「近い」とみなす日数。冷蔵庫画面の🟡と同じ基準にしてある。 */
export const SOON_DAYS = 3;

export interface RecapDish {
  recipeId: string;
  name: string;
  /** 今週その料理を作った回数 */
  count: number;
}

export interface WeeklyRecap {
  /** その週の月曜 yyyy-mm-dd */
  weekStart: string;
  /** 今週作った品数（「作った」ボタンの記録＝made:true のみ。献立に入れただけは数えない） */
  madeCount: number;
  /** 先週作った品数（増えた／減ったを言うため） */
  prevMadeCount: number;
  /** 今週キッチンに立った日数（同じ日に2品作っても1日） */
  activeDays: number;
  /** 作った料理（多い順→名前順） */
  dishes: RecapDish[];
  /** その料理に使った食材の種類（基本調味料を除く・重複なし） */
  ingredients: string[];
  /** いま冷蔵庫にある期限切れの数 */
  expired: number;
  /** いま冷蔵庫にある「あと3日以内」の数 */
  expiringSoon: number;
  /** 期限が近い食材の名前（先頭3件まで。次に何を作るかのきっかけ用） */
  expiringNames: string[];
  /** 1品以上作った週が何週続いているか（今週まだ0でも、先週までの連続は途切れさせない） */
  streakWeeks: number;
  /** 「作った」記録が1件でもあるか。無ければカードごと出さない（空の記録は逆効果） */
  hasHistory: boolean;
}

const DAY_MS = 86_400_000;

function parseISO(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function toISO(ms: number): string {
  const d = new Date(ms);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** その日が属する週の月曜を返す（月曜始まり） */
export function mondayOf(iso: string): string {
  const t = parseISO(iso);
  const dow = (new Date(t).getDay() + 6) % 7; // 月曜=0
  return toISO(t - dow * DAY_MS);
}

/** n週前の月曜 */
function weekBefore(mondayISO: string, n: number): string {
  return toISO(parseISO(mondayISO) - n * 7 * DAY_MS);
}

/** その週（月曜〜日曜）に作った記録だけ抜き出す */
function madeInWeek(meals: MealEntry[], monday: string): MealEntry[] {
  const start = parseISO(monday);
  const end = start + 7 * DAY_MS;
  return meals.filter((m) => {
    if (!m.made) return false;
    const t = parseISO(m.date);
    return t >= start && t < end;
  });
}

/**
 * 1品以上作った週が何週続いているか。
 *
 * ⚠️ **今週がまだ0でも連続を0にしない。** 月曜の朝に開いた瞬間「連続0週」と言われるのは
 *    理不尽で、続けてきた人ほど嫌になる。今週が0なら先週から数え始める
 *    （＝丸1週間なにも作らなかったときに初めて途切れる）。
 */
export function streakOf(meals: MealEntry[], monday: string, maxWeeks = 52): number {
  const start = madeInWeek(meals, monday).length > 0 ? 0 : 1;
  if (start === 1 && madeInWeek(meals, weekBefore(monday, 1)).length === 0) return 0;
  let n = 0;
  for (let i = start; i < maxWeeks + start; i++) {
    if (madeInWeek(meals, weekBefore(monday, i)).length === 0) break;
    n++;
  }
  return n;
}

export interface RecapInput {
  meals: MealEntry[];
  /** レシピは材料を引くためだけに使う。見つからないレシピはスキップ（削除済みでも落ちない） */
  recipes: { id: string; ingredients: { name: string; basicSeasoning?: boolean }[] }[];
  fridge: FridgeItem[];
  today?: string;
}

export function buildWeeklyRecap({
  meals,
  recipes,
  fridge,
  today = todayISO(),
}: RecapInput): WeeklyRecap {
  const weekStart = mondayOf(today);
  const thisWeek = madeInWeek(meals, weekStart);
  const prevWeek = madeInWeek(meals, weekBefore(weekStart, 1));

  // 料理ごとに集計（多い順→名前順で安定させる＝同じデータなら毎回同じ並び）
  const byRecipe = new Map<string, RecapDish>();
  for (const m of thisWeek) {
    const cur = byRecipe.get(m.recipeId);
    if (cur) cur.count++;
    else byRecipe.set(m.recipeId, { recipeId: m.recipeId, name: m.recipeName, count: 1 });
  }
  const dishes = [...byRecipe.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"),
  );

  // 使った食材＝作ったレシピの材料。基本調味料（塩・こしょう等）は「使った実感」が無いので除く。
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  const ingredients: string[] = [];
  const seen = new Set<string>();
  for (const d of dishes) {
    for (const ing of recipeById.get(d.recipeId)?.ingredients ?? []) {
      const name = ing.name.trim();
      if (!name || ing.basicSeasoning || seen.has(name)) continue;
      seen.add(name);
      ingredients.push(name);
    }
  }

  // いまの冷蔵庫の状態。「今週どうだったか」ではなく「次に何をすればいいか」を示す欄。
  let expired = 0;
  const soon: { name: string; left: number }[] = [];
  for (const item of fridge) {
    const left = daysUntil(item.expiresOn, today);
    if (left < 0) expired++;
    else if (left <= SOON_DAYS) soon.push({ name: item.name, left });
  }
  soon.sort((a, b) => a.left - b.left || a.name.localeCompare(b.name, "ja"));

  return {
    weekStart,
    madeCount: thisWeek.length,
    prevMadeCount: prevWeek.length,
    activeDays: new Set(thisWeek.map((m) => m.date)).size,
    dishes,
    ingredients,
    expired,
    expiringSoon: soon.length,
    expiringNames: soon.slice(0, 3).map((s) => s.name),
    streakWeeks: streakOf(meals, weekStart),
    hasHistory: meals.some((m) => m.made),
  };
}
