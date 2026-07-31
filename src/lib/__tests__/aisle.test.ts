import { describe, it, expect } from "vitest";
import { AISLE_ORDER, groupByAisle } from "../aisle";
import { guessCategory } from "../guess";

// 買い物中に価値を感じる人が50.1%いる＝**店で開く画面**。
// 売り場ごとに固まっていないと、店内を行ったり来たりすることになる。

describe("groupByAisle", () => {
  it("売り場順に並べ替える（追加順のままにしない）", () => {
    const items = ["牛乳", "玉ねぎ", "鶏もも肉", "にんじん"].map((name) => ({ name }));
    const groups = groupByAisle(items, (i) => i.name);
    expect(groups.map((g) => g.category)).toEqual(["野菜", "肉・魚", "乳製品・卵"]);
  });

  it("同じ売り場のものは1箇所にまとまる", () => {
    const items = ["玉ねぎ", "牛乳", "にんじん"].map((name) => ({ name }));
    const groups = groupByAisle(items, (i) => i.name);
    const veg = groups.find((g) => g.category === "野菜");
    expect(veg?.items.map((i) => i.name)).toEqual(["玉ねぎ", "にんじん"]);
  });

  it("売り場の中の順番は元のまま（レシピから入った順に読める）", () => {
    const items = ["にんじん", "玉ねぎ", "キャベツ"].map((name) => ({ name }));
    const groups = groupByAisle(items, (i) => i.name);
    expect(groups[0].items.map((i) => i.name)).toEqual(["にんじん", "玉ねぎ", "キャベツ"]);
  });

  it("空の売り場は出さない", () => {
    const groups = groupByAisle([{ name: "玉ねぎ" }], (i) => i.name);
    expect(groups).toHaveLength(1);
  });

  it("1件も落とさない（分類できないものは「その他」に入る）", () => {
    const names = ["玉ねぎ", "牛乳", "ぜんぜん知らない何か", "米"];
    const groups = groupByAisle(
      names.map((name) => ({ name })),
      (i) => i.name,
    );
    expect(groups.flatMap((g) => g.items).map((i) => i.name).sort()).toEqual(
      [...names].sort(),
    );
  });

  it("並び順の定義に全カテゴリが入っている（新カテゴリの入れ忘れで消えない）", () => {
    const names = ["玉ねぎ", "牛乳", "鶏もも肉", "米", "しょうゆ", "お茶", "なぞの品"];
    for (const n of names) expect(AISLE_ORDER).toContain(guessCategory(n));
  });

  it("冷蔵庫の分類と同じ辞書を使う（画面ごとに別のもの扱いにしない）", () => {
    const groups = groupByAisle([{ name: "豚こま" }], (i) => i.name);
    expect(groups[0].category).toBe(guessCategory("豚こま"));
  });
});
