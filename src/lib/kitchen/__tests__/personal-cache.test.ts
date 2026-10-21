import { expect, it } from "vitest";
import { poolKey } from "../../recipeCache";
it("invalidates personal recommendations when feedback, retired rules, amount or equipment change after a long identical wish", () => {
  const wish = "作り置きを使って今日の料理を考えたい。同じ前置きが続く場合も省略しない。";
  const q = { privateScope: "owner:place", wish: wish + JSON.stringify({ stock: "1食", feedback: "薄味", retiredRules: [], equipment: "鍋" }) };
  const original = poolKey(q);
  for (const context of [{ stock: "2食", feedback: "薄味", retiredRules: [], equipment: "鍋" }, { stock: "1食", feedback: "塩辛い", retiredRules: [], equipment: "鍋" }, { stock: "1食", feedback: "薄味", retiredRules: ["朝食方針"], equipment: "鍋" }, { stock: "1食", feedback: "薄味", retiredRules: [], equipment: "電子レンジ" }]) expect(poolKey({ ...q, wish: wish + JSON.stringify(context) })).not.toBe(original);
  expect(poolKey({ ...q, privateScope: "owner:other" })).not.toBe(original);
});
