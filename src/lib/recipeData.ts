// シードレシピ＋localStorage保存レシピを統合して取り出すヘルパ。
// （storage は recipe の型のみ import するので循環参照にならない）

import { SEED_RECIPES } from "./seedRecipes";
import { recipeStore } from "./storage";
import type { Recipe } from "./recipe";

export function getAllRecipes(): Recipe[] {
  const stored = recipeStore.load();
  const storedIds = new Set(stored.map((r) => r.id));
  // 保存版を優先し、未保存のシードを後ろに足す
  return [...stored, ...SEED_RECIPES.filter((r) => !storedIds.has(r.id))];
}

export function getRecipeById(id: string): Recipe | undefined {
  return getAllRecipes().find((r) => r.id === id);
}
