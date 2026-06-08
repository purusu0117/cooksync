import { describe, it, expect } from "vitest";
import { rankCandidates } from "../ranking";
import type { Recipe, RecipeIngredient } from "../recipe";
import type { FridgeItem } from "../food";
import type { MealEntry } from "../mealplan";

const TODAY = "2026-06-08";

function recipe(id: string, ingredients: RecipeIngredient[]): Recipe {
  return {
    id,
    name: id,
    emoji: "🍽",
    catch: "",
    servings: 1,
    ingredients,
    steps: [],
    leftoverStorage: [],
    sources: [],
    tags: {},
    createdAt: 0,
  };
}

function fridgeItem(name: string, expiresOn: string): FridgeItem {
  return {
    id: name,
    name,
    quantity: "",
    category: "野菜",
    zone: "野菜",
    purchasedOn: "2026-06-01",
    expiresOn,
    createdAt: 0,
  };
}

describe("rankCandidates", () => {
  const fridge = [fridgeItem("玉ねぎ", TODAY)]; // 期限間近(priority)
  const A = recipe("A", [{ name: "玉ねぎ", amount: "1個" }]); // 期限間近を使う
  const B = recipe("B", [{ name: "鶏むね", amount: "1枚", toBuy: true }]); // 使わない

  it("期限間近を使えるレシピが上位（ただし支配しない）", () => {
    const ranked = rankCandidates([A, B], fridge, [], {}, TODAY);
    const a = ranked.find((r) => r.recipe.id === "A")!;
    const b = ranked.find((r) => r.recipe.id === "B")!;
    expect(a.score).toBeGreaterThan(b.score);
    // ボーナスは味（基礎点100）を覆さない程度
    expect(a.score - b.score).toBeLessThanOrEqual(30);
    expect(a.usesExpiring).toContain("玉ねぎ");
  });

  it("直近2日に作ったレシピは強く減点され末尾に", () => {
    const recent: MealEntry[] = [
      { id: "x", date: TODAY, slot: "夜", recipeId: "A", recipeName: "A" },
    ];
    const ranked = rankCandidates([A, B], fridge, recent, {}, TODAY);
    expect(ranked[ranked.length - 1].recipe.id).toBe("A");
    const a = ranked.find((r) => r.recipe.id === "A")!;
    expect(a.score).toBeLessThan(0);
  });

  it("方向性フィルタ一致で加点", () => {
    const wa = recipe("wa", [{ name: "豆腐", amount: "1丁" }]);
    wa.tags = { cuisine: "和" };
    const yo = recipe("yo", [{ name: "チーズ", amount: "30g" }]);
    yo.tags = { cuisine: "洋" };
    const ranked = rankCandidates([wa, yo], [], [], { cuisine: "和" }, TODAY);
    expect(ranked[0].recipe.id).toBe("wa");
  });
});
