import { describe, it, expect } from "vitest";
import { parseNum, formatNum, scaleMeasures, scaleRecipe } from "../recipeScale";
import type { Recipe } from "../recipe";

describe("parseNum / formatNum", () => {
  it("分数・帯分数・小数を解釈する", () => {
    expect(parseNum("2")).toBe(2);
    expect(parseNum("1/2")).toBe(0.5);
    expect(parseNum("1と1/2")).toBe(1.5);
    expect(parseNum("1.5")).toBe(1.5);
  });
  it("読みやすい表記に戻す", () => {
    expect(formatNum(2)).toBe("2");
    expect(formatNum(0.5)).toBe("1/2");
    expect(formatNum(1.5)).toBe("1と1/2");
    expect(formatNum(3)).toBe("3");
    expect(formatNum(0.25)).toBe("1/4");
  });
});

describe("scaleMeasures", () => {
  it("factor=1 なら変えない", () => {
    expect(scaleMeasures("大さじ1と1/2", 1)).toBe("大さじ1と1/2");
  });
  it("g・個・大さじを倍にする", () => {
    expect(scaleMeasures("200g", 2)).toBe("400g");
    expect(scaleMeasures("1/2個", 2)).toBe("1個");
    expect(scaleMeasures("大さじ1", 2)).toBe("大さじ2");
    expect(scaleMeasures("小さじ1と1/2", 2)).toBe("小さじ3");
  });
  it("範囲（80〜90g）を両端スケールする", () => {
    expect(scaleMeasures("80〜90g", 2)).toBe("160〜180g");
  });
  it("半分にもできる", () => {
    expect(scaleMeasures("200g", 0.5)).toBe("100g");
    expect(scaleMeasures("卵2個", 0.5)).toBe("卵1個");
  });
  it("適量・少々・時間(分)は変えない", () => {
    expect(scaleMeasures("適量", 2)).toBe("適量");
    expect(scaleMeasures("少々", 2)).toBe("少々");
    expect(scaleMeasures("3分加熱する", 2)).toBe("3分加熱する");
    expect(scaleMeasures("180度に予熱", 2)).toBe("180度に予熱");
  });
  it("手順文中の分量だけ置換し、裸の数字は触らない", () => {
    expect(scaleMeasures("ご飯200gを盛り、5分蒸らす", 2)).toBe("ご飯400gを盛り、5分蒸らす");
  });
});

describe("scaleRecipe", () => {
  const base: Recipe = {
    id: "x",
    name: "テスト",
    emoji: "🍚",
    catch: "",
    servings: 2,
    kcal: 600,
    ingredients: [
      { name: "ご飯", amount: "400g" },
      { name: "卵", amount: "2個" },
      { name: "塩", amount: "適量", basicSeasoning: true },
    ],
    steps: [{ title: "1", text: "ご飯400gに卵2個を混ぜ、3分置く" }],
    leftoverStorage: [],
    sources: [],
    tags: {},
    createdAt: 0,
  };

  it("2人分→4人分で分量とkcalが倍、人数が更新される", () => {
    const r = scaleRecipe(base, 4);
    expect(r.servings).toBe(4);
    expect(r.kcal).toBe(1200);
    expect(r.ingredients[0].amount).toBe("800g");
    expect(r.ingredients[1].amount).toBe("4個");
    expect(r.ingredients[2].amount).toBe("適量");
    expect(r.steps[0].text).toBe("ご飯800gに卵4個を混ぜ、3分置く");
  });

  it("2人分→1人分で半分になる", () => {
    const r = scaleRecipe(base, 1);
    expect(r.ingredients[0].amount).toBe("200g");
    expect(r.ingredients[1].amount).toBe("1個");
    expect(r.kcal).toBe(300);
  });

  it("同人数なら同一参照を返す", () => {
    expect(scaleRecipe(base, 2)).toBe(base);
  });
});
