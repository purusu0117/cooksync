import { describe, it, expect } from "vitest";
import { ingredientMatches, isSameDish, normalizeDishName, normalizeName } from "../recipe";

describe("normalizeName 表記ゆれ", () => {
  it("漢字・かな・カタカナの違いを同一視する", () => {
    expect(normalizeName("玉ねぎ")).toBe(normalizeName("玉葱"));
    expect(normalizeName("タマネギ")).toBe(normalizeName("たまねぎ"));
    expect(normalizeName("人参")).toBe(normalizeName("にんじん"));
    expect(normalizeName("卵")).toBe(normalizeName("玉子"));
    expect(normalizeName("醤油")).toBe(normalizeName("しょうゆ"));
  });
});

describe("ingredientMatches", () => {
  it("玉ねぎ＝玉葱＝タマネギ", () => {
    expect(ingredientMatches("玉ねぎ", "玉葱")).toBe(true);
    expect(ingredientMatches("タマネギ", "玉ねぎ")).toBe(true);
    expect(ingredientMatches("人参", "にんじん")).toBe(true);
    expect(ingredientMatches("卵", "玉子")).toBe(true);
  });
  it("別の食材は一致しない", () => {
    expect(ingredientMatches("玉ねぎ", "にんじん")).toBe(false);
    expect(ingredientMatches("長ねぎ", "玉ねぎ")).toBe(false);
  });
  it("生トマトと加工トマト（缶・水煮・ホール）は別食材として扱う", () => {
    expect(ingredientMatches("トマト", "トマト缶")).toBe(false);
    expect(ingredientMatches("トマト", "カットトマト缶")).toBe(false);
    expect(ingredientMatches("トマト", "ホールトマト")).toBe(false);
    expect(ingredientMatches("トマト", "トマト水煮")).toBe(false);
    expect(ingredientMatches("ミニトマト", "トマト缶")).toBe(false);
    // 加工トマトどうしは同一視する
    expect(ingredientMatches("トマト缶", "カットトマト缶")).toBe(true);
    expect(ingredientMatches("トマト缶", "ホールトマト")).toBe(true);
  });
  it("括弧書き・前後の語は従来どおり寛容にマッチ", () => {
    expect(ingredientMatches("玉ねぎ（みじん切り）", "玉葱")).toBe(true);
  });
});

describe("isSameDish（AI提案の重複除去）", () => {
  it("表記ゆれ・飾り語だけが違う料理は同じとみなす", () => {
    expect(isSameDish("豚の生姜焼き", "豚の生姜焼き")).toBe(true);
    expect(isSameDish("豚の生姜焼き", "絶品！豚の生姜焼き")).toBe(true);
    expect(isSameDish("鶏の唐揚げ", "鶏の唐揚げ 簡単レシピ")).toBe(true);
    expect(isSameDish("ガパオライス", "ガパオライス")).toBe(true);
  });
  it("別の料理は別と判定する", () => {
    expect(isSameDish("豚の生姜焼き", "鶏の唐揚げ")).toBe(false);
    expect(isSameDish("親子丼", "牛丼")).toBe(false);
  });
  it("短い語の包含では同一と判定しない", () => {
    expect(isSameDish("丼", "親子丼")).toBe(false);
  });
  // 回帰：飾り語の除去は kataToHira の後に走るため、カタカナ語はひらがな形が必要だった。
  // 「レシピ」だけを列挙していた頃は既に「れしぴ」化していて除去できなかった。
  it("カタカナの飾り語（レシピ）を落とせる", () => {
    expect(normalizeDishName("青椒肉絲レシピ")).toBe(normalizeDishName("青椒肉絲"));
    expect(normalizeDishName("ハンバーグの作り方レシピ")).toBe(
      normalizeDishName("ハンバーグ"),
    );
  });
});
