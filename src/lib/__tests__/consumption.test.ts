import { describe, it, expect } from "vitest";
import { inferConsumed } from "../consumption";
import type { FridgeItem } from "../food";

function item(name: string, zone: FridgeItem["zone"]): FridgeItem {
  return {
    id: name,
    name,
    quantity: "",
    category: "その他",
    zone,
    purchasedOn: "2026-06-01",
    expiresOn: "2026-06-20",
    createdAt: 0,
  };
}

describe("inferConsumed ゾーン別ルール", () => {
  const fridge = [
    item("鶏もも肉", "生鮮"),
    item("玉ねぎ", "野菜"),
    item("冷凍あさり", "冷凍"),
    item("醤油", "乾物・調味料"),
    item("使ってない大根", "野菜"),
  ];
  const consumed = ["鶏もも肉", "玉ねぎ", "あさり", "醤油"];
  const plan = inferConsumed(consumed, fridge);

  it("生鮮は自動削除提案", () => {
    expect(plan.autoRemove.map((i) => i.name)).toEqual(["鶏もも肉"]);
  });
  it("野菜は量を確認", () => {
    expect(plan.askAmount.map((i) => i.name)).toEqual(["玉ねぎ"]);
  });
  it("冷凍は残量確認（部分一致であさり→冷凍あさり）", () => {
    expect(plan.askFrozen.map((i) => i.name)).toEqual(["冷凍あさり"]);
  });
  it("調味料は削除しない(keep)", () => {
    expect(plan.keep.map((i) => i.name)).toEqual(["醤油"]);
  });
  it("使っていない食材はどの分類にも入らない", () => {
    const all = [
      ...plan.autoRemove,
      ...plan.askAmount,
      ...plan.askFrozen,
      ...plan.keep,
    ].map((i) => i.name);
    expect(all).not.toContain("使ってない大根");
  });
});
