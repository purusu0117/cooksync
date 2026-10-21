import type { Recipe } from "../recipe";
import type { KitchenState, Feedback } from "./model";
import { ingredientId } from "./planning";
export const recipeBasis = (r: Recipe) => JSON.stringify([r.servings, r.ingredients.map(i => [i.name, i.amount, i.inventoryKind || "raw"]), r.steps.map(s => [s.title, s.text])]);
export const feedbackMatches = (f: Feedback, r: Recipe) => f.active && f.recipeId === r.id && f.recipeBasis === recipeBasis(r);
/** Explainable comparisons; no private household defaults or inferred nutrition amounts. */
export function mealProfile(recipe: Recipe) {
  const ingredients = recipe.ingredients.map(i => ingredientId(i.name));
  const proteins = ["鶏", "豚", "牛", "魚", "卵", "豆"].filter((_, i) => ingredients.some(n => [/とり|鶏|ちきん/, /ぶた|豚|べーこん/, /ぎゅう|牛/, /さけ|さば|魚|つな|まぐろ|たら/, /たまご|卵/, /とうふ|豆|なっとう/][i].test(n)));
  const seasonings = ingredients.filter(n => /しょうゆ|みそ|けちゃっぷ|かれー|ぽん酢|酢|そーす/.test(n));
  return { proteins, seasonings, cuisine: recipe.tags.cuisine, staple: recipe.tags.staple };
}
export function rankRecipes(recipes: Recipe[], state: KitchenState, locationId: string): { recipe: Recipe; reasons: string[]; score: number }[] {
  const recent = state.plans.filter(p => p.locationId === locationId && ["cooked", "partial"].includes(p.status)).slice(-5);
  return recipes.map(recipe => {
    const profile = mealProfile(recipe), reasons: string[] = []; let score = 0;
    const feedback = state.feedback.filter(f => f.locationId === locationId && feedbackMatches(f, recipe)).at(-1);
    if (feedback?.eaten === "完食") { score += 2; reasons.push("前回は完食"); }
    if (state.preferences.variety) for (const p of recent) {
      const prior = mealProfile(p.recipe);
      if (p.recipe.id === recipe.id) { score -= 3; reasons.push("最近作った料理"); }
      if (profile.staple && profile.staple === prior.staple) { score--; reasons.push("最近と主食が近い"); }
      if (profile.proteins.some(t => prior.proteins.includes(t))) { score--; reasons.push("最近とたんぱく源が近い"); }
      if (profile.seasonings.some(t => prior.seasonings.includes(t))) { score--; reasons.push("最近と味付けが近い"); }
    }
    return { recipe, reasons: [...new Set(reasons)], score };
  }).sort((a, b) => b.score - a.score);
}
