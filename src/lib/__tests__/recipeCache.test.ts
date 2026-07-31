import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  addToPool,
  poolKey,
  poolKeyParts,
  takeFromPool,
  type PoolQuery,
} from "../recipeCache";

// ローカル保存先（redis未設定時のフォールバック）を毎回まっさらにして検証する
const FILE = path.join(process.cwd(), ".data", "recipe-pool.json");

async function clean() {
  await fs.rm(FILE, { force: true }).catch(() => {});
}

beforeEach(clean);
afterEach(clean);

function recipe(name: string, ings: [string, boolean?][]) {
  return {
    name,
    ingredients: ings.map(([n, basic]) => ({
      name: n,
      toBuy: false,
      basicSeasoning: !!basic,
    })),
  };
}

const base: PoolQuery = {
  servings: 2,
  shopMode: "stock",
  filters: { cuisine: "中", cookTime: 30 },
};

describe("poolKey", () => {
  // キーの構成が黙って変わるとプール全体が無効化される（全ミス＝原価が跳ね上がる）。
  // 構成要素を明示的に固定しておく。
  it("キーの構成要素は 買い物方針|人数|ジャンル|好み|主食|時間|作りたいもの", () => {
    expect(poolKeyParts({ ...base, fridge: ["豚肉"] })).toBe(
      "stock|s2|中|any|any|30|any",
    );
    expect(
      poolKeyParts({
        servings: 4,
        shopMode: "buy",
        wish: "カレー",
        filters: { cuisine: "洋", heaviness: "ガッツリ", staple: "ごはん", cookTime: 60 },
      }),
    ).toBe("buy|s4|洋|ガッツリ|ごはん|60|かれ"); // 長音符は正規化で落ちる
  });

  it("冷蔵庫の中身ではキーが変わらない（変わるとヒット率が0になる）", () => {
    const a = poolKey({ ...base, fridge: ["鶏むね肉", "ピーマン"] });
    const b = poolKey({ ...base, fridge: ["豚バラ", "キャベツ", "人参"] });
    expect(a).toBe(b);
  });

  it("調理時間はバケット化される（29分と30分を別キーにしない）", () => {
    const a = poolKey({ ...base, filters: { cuisine: "中", cookTime: 29 } });
    const b = poolKey({ ...base, filters: { cuisine: "中", cookTime: 30 } });
    expect(a).toBe(b);
  });

  it("ジャンル・人数・買い物方針が違えば別キー", () => {
    const k = poolKey(base);
    expect(poolKey({ ...base, filters: { cuisine: "和", cookTime: 30 } })).not.toBe(k);
    expect(poolKey({ ...base, servings: 4 })).not.toBe(k);
    expect(poolKey({ ...base, shopMode: "buy" })).not.toBe(k);
  });

  it("作りたいものは表記ゆれを吸収する", () => {
    const a = poolKey({ ...base, wish: "簡単 青椒肉絲" });
    const b = poolKey({ ...base, wish: "青椒肉絲レシピ" });
    expect(a).toBe(b);
  });
});

describe("takeFromPool", () => {
  it("プールが空なら null（＝AI生成にフォールバックする）", async () => {
    expect(await takeFromPool({ ...base, fridge: ["鶏むね肉"] })).toBeNull();
  });

  it("在庫で作れるものだけ返す", async () => {
    await addToPool(base, [
      recipe("青椒肉絲", [["豚肉"], ["ピーマン"], ["醤油", true]]),
      recipe("麻婆豆腐", [["豆腐"], ["ひき肉"], ["豆板醤", true]]),
      recipe("回鍋肉", [["豚肉"], ["キャベツ"], ["味噌", true]]),
    ]);

    // 豆腐もひき肉も無いので麻婆豆腐は返ってこない
    const hit = await takeFromPool({
      ...base,
      fridge: ["豚肉", "ピーマン", "キャベツ"],
    });
    expect(hit).not.toBeNull();
    const names = hit!.recipes.map((r) => r.name);
    expect(names).not.toContain("麻婆豆腐");
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it("在庫が足りず候補が1件以下なら null（無理に配らない）", async () => {
    await addToPool(base, [
      recipe("青椒肉絲", [["豚肉"], ["ピーマン"]]),
      recipe("麻婆豆腐", [["豆腐"], ["ひき肉"]]),
    ]);
    const hit = await takeFromPool({ ...base, fridge: ["豚肉", "ピーマン"] });
    expect(hit).toBeNull();
  });

  it("既に持っているレシピ・直近で作ったものは除外する", async () => {
    await addToPool(base, [
      recipe("青椒肉絲", [["豚肉"], ["ピーマン"]]),
      recipe("回鍋肉", [["豚肉"], ["キャベツ"]]),
      recipe("豚キムチ", [["豚肉"], ["キムチ"]]),
    ]);
    const hit = await takeFromPool({
      ...base,
      fridge: ["豚肉", "ピーマン", "キャベツ", "キムチ"],
      existing: ["青椒肉絲"],
      avoid: ["回鍋肉"],
    });
    // 残り1件しか適合しないので配らない＝重複提案が起きない
    expect(hit).toBeNull();
  });

  it("料理名の言い換え（「簡単」「風」等）も同じ料理として除外する", async () => {
    await addToPool(base, [
      recipe("青椒肉絲", [["豚肉"], ["ピーマン"]]),
      recipe("回鍋肉", [["豚肉"], ["キャベツ"]]),
      recipe("豚キムチ", [["豚肉"], ["キムチ"]]),
    ]);
    const hit = await takeFromPool({
      ...base,
      fridge: ["豚肉", "ピーマン", "キャベツ", "キムチ"],
      existing: ["簡単青椒肉絲"], // 飾り語つきでも同じ料理
    });
    expect(hit!.recipes.map((r) => r.name)).not.toContain("青椒肉絲");
  });

  it("期限が近い食材を使うレシピを優先して返す", async () => {
    await addToPool(base, [
      recipe("回鍋肉", [["豚肉"], ["キャベツ"]]),
      recipe("なす味噌炒め", [["なす"], ["味噌", true]]),
      recipe("豚キムチ", [["豚肉"], ["キムチ"]]),
    ]);
    const hit = await takeFromPool({
      ...base,
      fridge: ["豚肉", "キャベツ", "なす", "キムチ"],
      expiring: ["なす"],
    });
    expect(hit!.recipes[0].name).toBe("なす味噌炒め");
  });

  it("買い物モードでは在庫制約をかけない", async () => {
    const buy: PoolQuery = { ...base, shopMode: "buy" };
    await addToPool(buy, [
      recipe("ラザニア", [["ラザニアシート"], ["合いびき肉"]]),
      recipe("パエリア", [["米"], ["エビ"]]),
    ]);
    const hit = await takeFromPool({ ...buy, fridge: [] }); // 冷蔵庫は空
    expect(hit).not.toBeNull();
    expect(hit!.recipes.length).toBe(2);
  });
});

describe("addToPool", () => {
  it("同じ料理は重複して貯めない", async () => {
    await addToPool(base, [recipe("青椒肉絲", [["豚肉"], ["ピーマン"]])]);
    await addToPool(base, [
      recipe("簡単青椒肉絲", [["豚肉"], ["ピーマン"]]), // 言い換え＝同じ料理
      recipe("回鍋肉", [["豚肉"], ["キャベツ"]]),
      recipe("豚キムチ", [["豚肉"], ["キムチ"]]),
    ]);
    const hit = await takeFromPool({
      ...base,
      fridge: ["豚肉", "ピーマン", "キャベツ", "キムチ"],
    });
    const names = hit!.recipes.map((r) => r.name);
    expect(names.filter((n) => n?.includes("青椒肉絲")).length).toBeLessThanOrEqual(1);
  });

  it("名前の無いゴミデータは貯めない", async () => {
    await addToPool(base, [{ ingredients: [] }, null, "x"] as unknown[]);
    expect(await takeFromPool({ ...base, fridge: ["豚肉"] })).toBeNull();
  });
});
