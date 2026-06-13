// レシピの分量を人数に応じてスケールする純ヘルパ。
// 数値＋既知の単位（または 大さじ/小さじ/カップ）だけを倍率変換し、
// 「適量」「少々」や時間（分・秒）など"単位なしの数値"はそのまま残す＝手順文に混ざっていても安全。

import type { Recipe, RecipeIngredient } from "./recipe";

// スケール対象の単位。長いものを先に（kg を g より先に等）。
// 時間(分/秒/時間)・温度(度/℃)・割合(%)・人(人/人分) は意図的に除外。
const UNIT =
  "(?:kg|mg|ml|mL|cc|g|L|l|カップ|合|杯|個|片|枚|本|玉|束|房|株|袋|パック|缶|箱|切れ|尾|かけ|つ|粒|滴|振り|ふり|cm|mm)";
// 数値：整数/小数/「1と1/2」/「1/2」
const NUM = "\\d+(?:\\.\\d+)?(?:と\\d+/\\d+)?|\\d+/\\d+";

/** 「1」「1.5」「1と1/2」「1/2」→ number */
export function parseNum(s: string): number {
  s = s.trim();
  const mixed = s.match(/^(\d+)と(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s);
}

/** number → 日本語で読みやすい分量表記（1/2・1と1/2・整数・端数は小数1桁） */
export function formatNum(n: number): string {
  n = Math.round(n * 1000) / 1000;
  if (n < 0) return "0";
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  const table: [number, string][] = [
    [0, ""],
    [0.25, "1/4"],
    [1 / 3, "1/3"],
    [0.5, "1/2"],
    [2 / 3, "2/3"],
    [0.75, "3/4"],
  ];
  let best = table[0];
  let bestDiff = 1;
  for (const cand of table) {
    const d = Math.abs(frac - cand[0]);
    if (d < bestDiff) {
      bestDiff = d;
      best = cand;
    }
  }
  if (bestDiff < 0.06) {
    const fracStr = best[1];
    if (!fracStr) return String(whole); // 端数なし＝整数
    return whole > 0 ? `${whole}と${fracStr}` : fracStr;
  }
  return String(Math.round(n * 10) / 10); // フォールバック：小数1桁
}

const SCALE_RE = new RegExp(
  // 1) 範囲：80〜90g
  `(${NUM})\\s*[〜～~]\\s*(${NUM})\\s*(${UNIT})` +
    // 2) 大さじ/小さじ/カップ ＋ 数値
    `|(大さじ|小さじ|カップ)\\s*(${NUM})` +
    // 3) 数値 ＋ 単位
    `|(${NUM})\\s*(${UNIT})`,
  "g",
);

/** 文字列中の「分量トークン」だけを倍率変換する（単位なしの裸の数値・時間は触らない） */
export function scaleMeasures(text: string, factor: number): string {
  if (!text || factor === 1 || !isFinite(factor) || factor <= 0) return text;
  return text.replace(
    SCALE_RE,
    (
      match: string,
      rangeA?: string,
      rangeB?: string,
      rangeUnit?: string,
      spoon?: string,
      spoonNum?: string,
      num?: string,
      unit?: string,
    ): string => {
      if (rangeUnit !== undefined && rangeA && rangeB) {
        return `${formatNum(parseNum(rangeA) * factor)}〜${formatNum(parseNum(rangeB) * factor)}${rangeUnit}`;
      }
      if (spoon !== undefined && spoonNum) {
        return `${spoon}${formatNum(parseNum(spoonNum) * factor)}`;
      }
      if (unit !== undefined && num) {
        return `${formatNum(parseNum(num) * factor)}${unit}`;
      }
      return match;
    },
  );
}

/** baseServings 基準のレシピを targetServings 人前にスケールした新しいレシピを返す（非破壊） */
export function scaleRecipe(recipe: Recipe, targetServings: number): Recipe {
  const base = recipe.servings || 1;
  const factor = targetServings / base;
  if (factor === 1) return recipe;
  const ingredients: RecipeIngredient[] = recipe.ingredients.map((ing) => ({
    ...ing,
    amount: scaleMeasures(ing.amount, factor),
  }));
  const steps = recipe.steps.map((s) => ({
    ...s,
    text: scaleMeasures(s.text, factor),
  }));
  return {
    ...recipe,
    servings: targetServings,
    kcal: recipe.kcal ? Math.round(recipe.kcal * factor) : recipe.kcal,
    ingredients,
    steps,
  };
}
