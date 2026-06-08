import { describe, it, expect } from "vitest";
import { guessCategory, guessItem, guessShelfLifeDays } from "../guess";

describe("guessCategory", () => {
  it("食材名からカテゴリを推定", () => {
    expect(guessCategory("鶏もも肉")).toBe("肉・魚");
    expect(guessCategory("玉ねぎ")).toBe("野菜");
    expect(guessCategory("牛乳")).toBe("乳製品・卵");
    expect(guessCategory("醤油")).toBe("調味料");
    expect(guessCategory("食パン")).toBe("主食");
    expect(guessCategory("謎の物体")).toBe("その他");
  });
});

describe("guessShelfLifeDays", () => {
  it("食材ごとの日持ち目安", () => {
    expect(guessShelfLifeDays("豚ひき肉")).toBe(2);
    expect(guessShelfLifeDays("卵")).toBe(14);
    expect(guessShelfLifeDays("玉ねぎ")).toBe(14);
    expect(guessShelfLifeDays("もやし")).toBe(3);
  });
});

describe("guessItem", () => {
  it("購入日＋目安日数で期限を推定", () => {
    const g = guessItem("鶏もも肉", "2026-06-08");
    expect(g.category).toBe("肉・魚");
    expect(g.shelfLifeDays).toBe(2);
    expect(g.expiresOn).toBe("2026-06-10");
  });
});
