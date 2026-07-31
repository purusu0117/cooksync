// 2026-08-01 の描画高速化で入れた「索引」の回帰テスト。
//
//  ① starsMapOf / madeCountMapOf … 画面3つ（レシピ一覧・ホーム・献立ウィザード）で
//     ratings.find() / meals.filter() の全走査を置き換えたもの。**先勝ち**や
//     「made:true だけ数える」といった細かい挙動がズレると、星や「◯回作った」が静かに狂う。
//  ② rankCandidates の「直近2日に作ったレシピを除外」… 以前はレシピ1件ごとに
//     wasMadeRecently()（＝献立履歴の全件パース＋ソート）を呼んでいたのを、
//     外で1回だけ Set を作る形に変えた。**判定結果が同一である**ことをここで固定する。

import { describe, it, expect } from "vitest";
import { madeCountMapOf, rankCandidates, starsMapOf } from "../ranking";
import { wasMadeRecently, type MealEntry } from "../mealplan";
import type { Recipe } from "../recipe";
import type { FridgeItem } from "../food";

const TODAY = "2026-08-01";

function meal(id: string, date: string, recipeId: string, made?: boolean): MealEntry {
  return { id, date, slot: "夜", recipeId, recipeName: recipeId, made };
}

function recipe(id: string): Recipe {
  return {
    id,
    name: id,
    emoji: "🍳",
    catch: "",
    servings: 2,
    ingredients: [{ name: "玉ねぎ", amount: "1個" }],
    steps: [],
    leftoverStorage: [],
    sources: [],
    tags: {},
    createdAt: 0,
  };
}

describe("starsMapOf", () => {
  it("recipeId → stars を引ける", () => {
    const m = starsMapOf([
      { recipeId: "a", stars: 5 },
      { recipeId: "b", stars: 3 },
    ]);
    expect(m.get("a")).toBe(5);
    expect(m.get("b")).toBe(3);
    expect(m.get("c")).toBeUndefined();
  });

  it("重複した recipeId は先勝ち（置き換え前の find() と同じ）", () => {
    const rows = [
      { recipeId: "a", stars: 5 },
      { recipeId: "a", stars: 1 },
    ];
    expect(starsMapOf(rows).get("a")).toBe(rows.find((r) => r.recipeId === "a")!.stars);
    expect(starsMapOf(rows).get("a")).toBe(5);
  });

  it("空でも落ちない", () => {
    expect(starsMapOf([]).size).toBe(0);
  });
});

describe("madeCountMapOf", () => {
  const meals = [
    meal("1", TODAY, "a", true),
    meal("2", TODAY, "a", true),
    meal("3", TODAY, "a", false), // 献立に入れただけ＝作った回数に入れない
    meal("4", TODAY, "b"), // made 未定義も同様
    meal("5", TODAY, "c", true),
  ];

  it("made:true だけを数える", () => {
    const m = madeCountMapOf(meals);
    expect(m.get("a")).toBe(2);
    expect(m.get("b")).toBeUndefined();
    expect(m.get("c")).toBe(1);
  });

  it("置き換え前の meals.filter(...).length と全レシピで一致する", () => {
    const m = madeCountMapOf(meals);
    for (const id of ["a", "b", "c", "d"]) {
      const before = meals.filter((e) => e.recipeId === id && e.made).length;
      expect(m.get(id) ?? 0).toBe(before);
    }
  });
});

describe("rankCandidates の連日回避（Set 化しても判定が変わらない）", () => {
  const fridge: FridgeItem[] = [];
  const candidates = ["today", "yesterday", "old", "never"].map(recipe);
  const history: MealEntry[] = [
    meal("m1", "2026-08-01", "today", true),
    meal("m2", "2026-07-31", "yesterday", true),
    meal("m3", "2026-07-28", "old", true),
  ];

  it("直近2日に作ったレシピだけが強く減点される", () => {
    const ranked = rankCandidates(candidates, fridge, history, {}, TODAY);
    const scoreOf = (id: string) => ranked.find((r) => r.recipe.id === id)!.score;
    expect(scoreOf("today")).toBeLessThan(-500);
    expect(scoreOf("yesterday")).toBeLessThan(-500);
    expect(scoreOf("old")).toBeGreaterThan(0);
    expect(scoreOf("never")).toBeGreaterThan(0);
  });

  it("wasMadeRecently（旧実装が呼んでいた関数）と1件ずつ一致する", () => {
    const ranked = rankCandidates(candidates, fridge, history, {}, TODAY);
    for (const c of candidates) {
      const excludedNow = ranked
        .find((r) => r.recipe.id === c.id)!
        .reasons.includes("直近2日に作ったため除外");
      expect(excludedNow).toBe(wasMadeRecently(history, c.id, 2, TODAY));
    }
  });

  it("献立履歴が空でも落ちない", () => {
    const ranked = rankCandidates(candidates, fridge, [], {}, TODAY);
    expect(ranked).toHaveLength(candidates.length);
    for (const r of ranked) expect(r.score).toBeGreaterThan(0);
  });

  it("同じレシピが履歴に何度あっても除外は1回ぶん（点が二重に引かれない）", () => {
    const dup = [
      meal("d1", TODAY, "today", true),
      meal("d2", TODAY, "today", true),
      meal("d3", TODAY, "today", true),
    ];
    const one = rankCandidates([recipe("today")], fridge, [dup[0]], {}, TODAY)[0].score;
    const many = rankCandidates([recipe("today")], fridge, dup, {}, TODAY)[0].score;
    expect(many).toBe(one);
  });
});
