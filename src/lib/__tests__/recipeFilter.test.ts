import { describe, it, expect } from "vitest";
import {
  expandTerm,
  kindTriggerOf,
  kindsOf,
  matchesQuery,
  usesExpiring,
} from "../recipeFilter";
import type { Recipe } from "../recipe";

function recipe(over: Partial<Recipe>): Recipe {
  return {
    id: "x",
    name: "テスト",
    emoji: "🍽",
    catch: "",
    servings: 2,
    ingredients: [],
    steps: [],
    leftoverStorage: [],
    sources: [],
    tags: {},
    createdAt: 0,
    ...over,
  };
}

const 生姜焼き = recipe({
  name: "豚の生姜焼き",
  catch: "柔らか・じゅわ・タレ",
  ingredients: [
    { name: "豚ロース薄切り", amount: "150g" },
    { name: "玉ねぎ", amount: "1/2個" },
    { name: "醤油", amount: "大さじ1.5", basicSeasoning: true },
  ],
  tags: { cuisine: "和", heaviness: "ガッツリ", staple: "ご飯", cookTime: 30 },
});

const ムニエル = recipe({
  name: "鮭のムニエル",
  ingredients: [
    { name: "鮭の切り身", amount: "2切" },
    { name: "ミニトマト", amount: "6個" },
  ],
  tags: { cuisine: "洋", heaviness: "さっぱり", cookTime: 30 },
});

const きゅうり = recipe({
  name: "にんにくみそのたたききゅうり",
  ingredients: [
    { name: "きゅうり", amount: "1本" },
    { name: "味噌", amount: "小さじ1", basicSeasoning: true },
  ],
  tags: { heaviness: "さっぱり", cookTime: 15 },
});

describe("kindsOf（主材料の系統）", () => {
  it("肉・魚介を材料から判定する", () => {
    expect(kindsOf(生姜焼き)).toContain("肉");
    expect(kindsOf(ムニエル)).toContain("魚介");
  });
  it("野菜は「肉も魚介も使わない＝野菜中心」の意味にする", () => {
    expect(kindsOf(きゅうり)).toEqual(["野菜"]);
    // 玉ねぎを使っていても肉料理は野菜中心に含めない
    expect(kindsOf(生姜焼き)).not.toContain("野菜");
  });
});

describe("expandTerm / kindTriggerOf", () => {
  it("「肉系」「魚」は主材料の系統として扱う", () => {
    expect(kindTriggerOf("肉系")).toBe("肉");
    expect(kindTriggerOf("魚")).toBe("魚介");
    expect(kindTriggerOf("ヘルシー")).toBe("野菜");
    expect(kindTriggerOf("カルボナーラ")).toBeNull();
  });
  it("普通の語はそのまま", () => {
    expect(expandTerm("カルボナーラ")).toEqual(["カルボナーラ"]);
  });
});

describe("紛らわしい名前で系統を誤判定しない", () => {
  const タコライス = recipe({
    name: "濃厚チーズのタコライス",
    ingredients: [
      { name: "合いびき肉", amount: "150g" },
      { name: "タコライス用スパイス", amount: "少々" },
    ],
  });
  const かつお節サラダ = recipe({
    name: "冷しゃぶサラダ",
    ingredients: [
      { name: "豚ロース薄切り", amount: "160g" },
      { name: "かつお節", amount: "1袋" },
      { name: "レタス", amount: "1/2玉" },
    ],
  });
  it("「タコ」ライスは魚介ではない", () => {
    expect(kindsOf(タコライス)).not.toContain("魚介");
    expect(matchesQuery(タコライス, "魚")).toBe(false);
    // 料理名での検索は従来どおり効く
    expect(matchesQuery(タコライス, "タコライス")).toBe(true);
  });
  it("かつお節は出汁であって魚料理にしない", () => {
    expect(kindsOf(かつお節サラダ)).not.toContain("魚介");
    expect(kindsOf(かつお節サラダ)).toContain("肉");
  });
});

describe("matchesQuery", () => {
  it("「肉系」で肉料理が出て、魚料理は出ない", () => {
    expect(matchesQuery(生姜焼き, "肉系")).toBe(true);
    expect(matchesQuery(ムニエル, "肉系")).toBe(false);
  });
  it("「魚」で魚料理が出る", () => {
    expect(matchesQuery(ムニエル, "魚")).toBe(true);
    expect(matchesQuery(きゅうり, "魚")).toBe(false);
  });
  it("味の言葉でも引ける（タグを見る）", () => {
    expect(matchesQuery(ムニエル, "さっぱり")).toBe(true);
    expect(matchesQuery(生姜焼き, "がっつり")).toBe(true);
  });
  it("スペース区切りはAND（重ねがけ）", () => {
    expect(matchesQuery(ムニエル, "魚 さっぱり")).toBe(true);
    expect(matchesQuery(生姜焼き, "肉 さっぱり")).toBe(false);
  });
  it("従来どおり料理名・材料名の部分一致も効く", () => {
    expect(matchesQuery(生姜焼き, "生姜")).toBe(true);
    expect(matchesQuery(生姜焼き, "玉ねぎ")).toBe(true);
    expect(matchesQuery(生姜焼き, "カレー")).toBe(false);
  });
  it("空の検索語は全件通す", () => {
    expect(matchesQuery(生姜焼き, "")).toBe(true);
    expect(matchesQuery(生姜焼き, "   ")).toBe(true);
  });
});

describe("usesExpiring（期限が近い食材を使えるか）", () => {
  it("冷蔵庫の期限間近の食材と付き合わせる", () => {
    expect(usesExpiring(ムニエル, ["ミニトマト"])).toBe(true);
    expect(usesExpiring(ムニエル, ["キャベツ"])).toBe(false);
    expect(usesExpiring(ムニエル, [])).toBe(false);
  });
});
