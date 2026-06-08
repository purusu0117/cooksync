import { describe, it, expect } from "vitest";
import {
  recentMeals,
  slotsForTiming,
  wasMadeRecently,
  type MealEntry,
} from "../mealplan";

const TODAY = "2026-06-08";

const meals: MealEntry[] = [
  { id: "1", date: "2026-06-08", slot: "夜", recipeId: "a", recipeName: "A" },
  { id: "2", date: "2026-06-07", slot: "昼", recipeId: "b", recipeName: "B" },
  { id: "3", date: "2026-06-04", slot: "夜", recipeId: "c", recipeName: "C" },
];

describe("recentMeals / wasMadeRecently", () => {
  it("直近2日（今日と昨日）のみ", () => {
    const r = recentMeals(meals, 2, TODAY).map((m) => m.recipeId);
    expect(r).toEqual(["a", "b"]); // 新しい順、4日前のcは除外
  });
  it("wasMadeRecently", () => {
    expect(wasMadeRecently(meals, "a", 2, TODAY)).toBe(true);
    expect(wasMadeRecently(meals, "c", 2, TODAY)).toBe(false);
  });
});

describe("slotsForTiming", () => {
  it("両方は今日の昼夜2スロット", () => {
    expect(slotsForTiming("両方", TODAY)).toEqual([
      { date: "2026-06-08", slot: "昼" },
      { date: "2026-06-08", slot: "夜" },
    ]);
  });
  it("翌日もは4スロット（翌日含む）", () => {
    const s = slotsForTiming("翌日も", TODAY);
    expect(s).toHaveLength(4);
    expect(s[3]).toEqual({ date: "2026-06-09", slot: "夜" });
  });
});
