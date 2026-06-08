import { describe, it, expect } from "vitest";
import { shortfall, staleItems, type ShoppingItem } from "../shopping";
import { ingredientMatches } from "../recipe";

const DAY = 86_400_000;

function s(name: string, checked: boolean, ageDays: number, now: number): ShoppingItem {
  return {
    id: name,
    name,
    amount: "",
    checked,
    addedAt: now - ageDays * DAY,
  };
}

describe("staleItems", () => {
  it("3日以上前の未チェックだけを返す", () => {
    const now = 1_000 * DAY;
    const items = [
      s("古い未購入", false, 4, now),
      s("新しい未購入", false, 1, now),
      s("古いが購入済み", true, 5, now),
    ];
    const stale = staleItems(items, 3, now).map((i) => i.name);
    expect(stale).toEqual(["古い未購入"]);
  });
});

describe("shortfall", () => {
  it("在庫にもリストにも無いものだけ残す（部分一致）", () => {
    const needed = [
      { name: "鶏もも肉", amount: "1枚" },
      { name: "玉ねぎ", amount: "1個" },
      { name: "醤油", amount: "大さじ1" },
    ];
    const have = ["玉ねぎ 1個"]; // 部分一致で玉ねぎを所持
    const onList = ["醤油"];
    const result = shortfall(needed, have, onList, ingredientMatches).map(
      (r) => r.name,
    );
    expect(result).toEqual(["鶏もも肉"]);
  });
});
