// Step 6：献立提案のランキング（決定論ロジック＝アプリの売り）。
// 方針：①美味しさ最優先（curatedは全部美味しい前提で同点スタート）
//       ②期限が近い食材を使えると加点（ボーナスであって支配しない）
//       ③直近2日に作ったレシピは強く減点（連日回避）
//       ④買い足しが少ないと小加点／方向性フィルタ一致で加点

import { bucketOf, todayISO, type FridgeItem } from "./food";
import { ingredientMatches, type Recipe, type RecipeTags } from "./recipe";
import { recentMeals, type MealEntry } from "./mealplan";

export interface RankedRecipe {
  recipe: Recipe;
  score: number;
  usesExpiring: string[]; // 消費できる期限間近の食材名（🔴🟡）
  missingNames: string[]; // 買い足しが要る材料名
  reasons: string[];
}

/**
 * 星評価の索引（recipeId → stars）。
 *
 * ★同じ recipeId が複数あったら **先勝ち**。置き換え前の `ratings.find(...)` と同じ挙動にするため。
 *   （評価は1レシピ1件のはずだが、端末間マージの取りこぼしで重複しうる）
 *
 * なぜ関数に切り出すか：レシピ一覧・ホーム・献立ウィザードの3画面が同じ索引を欲しがる。
 * それぞれで `find()` の全走査を書いていたので、1本にまとめて回帰テストで固定する。
 */
export function starsMapOf(
  ratings: readonly { recipeId: string; stars: number }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of ratings) if (!m.has(r.recipeId)) m.set(r.recipeId, r.stars);
  return m;
}

/**
 * 「作った回数」の索引（recipeId → 回数）。
 * 数えるのは made:true だけ（献立に入れただけ＝made 未定義/false は作った回数に入れない）。
 */
export function madeCountMapOf(meals: readonly MealEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of meals) {
    if (!e.made) continue;
    m.set(e.recipeId, (m.get(e.recipeId) ?? 0) + 1);
  }
  return m;
}

const BASE_TASTE = 100;
const PRIORITY_BONUS = 8; // 🔴 を活かせる材料1つにつき
const SOON_BONUS = 4; // 🟡 を活かせる材料1つにつき
const BONUS_CAP = 24; // 期限ボーナスが味を支配しないよう上限
const FILTER_BONUS = 6; // 方向性フィルタ1項目一致につき
const FEW_BUY_BONUS = 5; // 買い足し0〜1点なら
const RECENT_PENALTY = 1000; // 連日回避：実質除外
const RATING_BONUS = 5; // ★1つにつき（5つで+25。味を支配しすぎない範囲）

export function rankCandidates(
  candidates: Recipe[],
  fridge: FridgeItem[],
  recent: MealEntry[],
  filters: RecipeTags = {},
  today: string = todayISO(),
  matches: (a: string, b: string) => boolean = ingredientMatches,
  ratingOf: (recipeId: string) => number = () => 0,
): RankedRecipe[] {
  const priorityNames = fridge
    .filter((f) => bucketOf(f.expiresOn, today) === "priority")
    .map((f) => f.name);
  const soonNames = fridge
    .filter((f) => bucketOf(f.expiresOn, today) === "soon")
    .map((f) => f.name);
  const fridgeNames = fridge.map((f) => f.name);

  /**
   * 直近2日に作ったレシピID。
   *
   * ★ここは以前、レシピ1件ごとに wasMadeRecently() を呼んでいた。中身は
   *   「献立履歴を**全件**日付パースして filter → sort」なので、
   *   レシピ206件 × 履歴700件 ＝ 14万回のパース＋206回のソートが1レンダーで走っていた。
   *   実測で献立ウィザードの1操作が **255ms**（デスクトップ。iPhone Safariは3〜4倍）。
   *   履歴は全レシピで共通なので、外で1回だけ作って Set で引く。
   *   判定結果は wasMadeRecently と同一（同じ recentMeals を使い、recipeId で照合）。
   */
  const recentIds = new Set(recentMeals(recent, 2, today).map((e) => e.recipeId));

  const ranked = candidates.map((recipe) => {
    let score = BASE_TASTE;
    const reasons: string[] = [];
    const usesExpiring: string[] = [];

    // 期限ボーナス（上限つき）
    let bonus = 0;
    for (const ing of recipe.ingredients) {
      if (priorityNames.some((n) => matches(ing.name, n))) {
        bonus += PRIORITY_BONUS;
        usesExpiring.push(ing.name);
      } else if (soonNames.some((n) => matches(ing.name, n))) {
        bonus += SOON_BONUS;
        usesExpiring.push(ing.name);
      }
    }
    bonus = Math.min(bonus, BONUS_CAP);
    if (bonus > 0) {
      score += bonus;
      reasons.push(`期限間近の食材を${usesExpiring.length}品消費`);
    }

    // 方向性フィルタ一致
    let filterHits = 0;
    if (filters.cuisine && recipe.tags.cuisine === filters.cuisine) filterHits++;
    if (filters.heaviness && recipe.tags.heaviness === filters.heaviness)
      filterHits++;
    if (filters.staple && recipe.tags.staple === filters.staple) filterHits++;
    if (
      filters.cookTime &&
      recipe.tags.cookTime &&
      recipe.tags.cookTime <= filters.cookTime
    )
      filterHits++;
    if (filterHits > 0) {
      score += filterHits * FILTER_BONUS;
      reasons.push("好みの方向性に一致");
    }

    // 買い足しの少なさ（在庫に無い材料の数）
    const missingNames = recipe.ingredients
      .filter(
        (i) =>
          i.toBuy ||
          (!i.basicSeasoning && !fridgeNames.some((n) => matches(n, i.name))),
      )
      .map((i) => i.name);
    if (missingNames.length <= 1) {
      score += FEW_BUY_BONUS;
      reasons.push("買い足しがほぼ不要");
    }

    // 高評価を優先
    const stars = ratingOf(recipe.id);
    if (stars > 0) {
      score += stars * RATING_BONUS;
      reasons.push(`評価★${stars}`);
    }

    // 連日回避
    if (recentIds.has(recipe.id)) {
      score -= RECENT_PENALTY;
      reasons.push("直近2日に作ったため除外");
    }

    return { recipe, score, usesExpiring, missingNames, reasons };
  });

  return ranked.sort((a, b) => b.score - a.score);
}
