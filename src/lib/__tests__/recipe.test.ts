import { describe, it, expect } from "vitest";
import { ingredientMatches, normalizeName } from "../recipe";

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
  it("括弧書き・前後の語は従来どおり寛容にマッチ", () => {
    expect(ingredientMatches("玉ねぎ（みじん切り）", "玉葱")).toBe(true);
  });
});
