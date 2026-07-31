// ベンチマーク用の合成データ生成（決定論的）。
//
// scripts/bench-render.mjs から使う。乱数はシード固定なので、before/after で
// **まったく同じデータ**を測れる（測るたびに件数や中身が変わると比較にならない）。
//
// 規模は品質保証部門の監査に合わせてある：レシピ200 × 冷蔵庫100 × 献立履歴700（1年分）。

/** mulberry32：シード固定の疑似乱数（外部依存なし） */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 実データに寄せた食材名（表記ゆれ・漢字/かな/カタカナを混ぜる＝normalizeName の負荷が本番相当になる）
const INGREDIENTS = [
  "玉ねぎ", "たまねぎ", "人参", "にんじん", "じゃがいも", "大根", "キャベツ", "白菜",
  "ピーマン", "パプリカ", "なす", "きゅうり", "トマト", "ミニトマト", "トマト缶",
  "ほうれん草", "小松菜", "水菜", "もやし", "ブロッコリー", "アスパラ", "オクラ",
  "しめじ", "えのき", "しいたけ", "まいたけ", "長ねぎ", "ねぎ", "ごぼう", "れんこん",
  "かぼちゃ", "さつまいも", "アボカド", "にんにく", "生姜",
  "鶏もも肉", "鶏むね肉", "ささみ", "豚バラ肉", "豚こま切れ", "牛こま切れ", "ひき肉",
  "ベーコン", "ウインナー", "ハム", "鮭", "さば", "ぶり", "エビ", "イカ", "あさり",
  "ツナ缶", "卵", "牛乳", "バター", "チーズ", "ヨーグルト", "豆腐", "納豆", "厚揚げ",
  "スパゲッティ", "うどん", "そば", "ご飯", "食パン",
];

const SEASONINGS = ["塩", "こしょう", "醤油", "みりん", "酒", "砂糖", "味噌", "ごま油", "サラダ油"];

const DISH_WORDS = [
  "炒め", "煮", "焼き", "蒸し", "揚げ", "和え", "丼", "パスタ", "スープ", "サラダ",
  "カレー", "グラタン", "チャーハン", "うどん", "鍋",
];

const CUISINES = ["和", "洋", "中", "アジアン"];
const HEAVINESS = ["ガッツリ", "さっぱり", "あっさり"];
const STAPLES = ["ご飯", "麺", "パン"];
const COOK_TIMES = [15, 30, 60];
const CATEGORIES = ["野菜", "肉・魚", "乳製品・卵", "主食", "調味料", "飲料", "その他"];
const ZONES = ["生鮮", "野菜", "乾物・調味料", "冷凍", "その他"];

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function isoDate(base, offsetDays) {
  const d = new Date(base.getTime() + offsetDays * 86_400_000);
  const o = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - o).toISOString().slice(0, 10);
}

/**
 * 合成データ一式を返す。
 * @param {{recipes?:number, fridge?:number, meals?:number, seed?:number}} opts
 */
export function makeDataset(opts = {}) {
  const nRecipes = opts.recipes ?? 200;
  const nFridge = opts.fridge ?? 100;
  const nMeals = opts.meals ?? 700;
  const r = rng(opts.seed ?? 20260801);
  const today = new Date();

  const recipes = [];
  for (let i = 0; i < nRecipes; i++) {
    const main = pick(r, INGREDIENTS);
    const name = `${main}の${pick(r, DISH_WORDS)}${i}`;
    const nIng = 8 + Math.floor(r() * 8); // 8〜15品（監査の「材料15」に届く）
    const ingredients = [];
    for (let k = 0; k < nIng; k++) {
      const seasoning = k >= nIng - 3;
      ingredients.push({
        name: seasoning ? pick(r, SEASONINGS) : pick(r, INGREDIENTS),
        amount: `${1 + Math.floor(r() * 4)}${pick(r, ["個", "g", "本", "枚", "大さじ", "ml"])}`,
        group: k < 4 ? "主材料" : seasoning ? "調味料" : "その他",
        toBuy: false,
        basicSeasoning: seasoning,
      });
    }
    const steps = [];
    for (let k = 0; k < 6; k++) {
      steps.push({
        title: `${k + 1}. 工程${k + 1}`,
        text: `${pick(r, INGREDIENTS)}を切って${3 + Math.floor(r() * 10)}分ほど加熱する。塩こしょうで味を整える。`,
        tip: k % 2 === 0 ? "火加減は中火をキープする" : undefined,
      });
    }
    recipes.push({
      id: `bench-${i}`,
      name,
      emoji: "🍳",
      kcal: 300 + Math.floor(r() * 500),
      catch: `${main}が主役の${pick(r, HEAVINESS)}な一皿`,
      servings: 2,
      ingredients,
      steps,
      sideDishes: ["ご飯", "味噌汁"],
      leftoverStorage: [{ ingredient: main, method: "冷蔵で3日" }],
      sources: [{ label: "ベンチ用", url: "https://example.com", popularity: "" }],
      tags: {
        cuisine: pick(r, CUISINES),
        heaviness: pick(r, HEAVINESS),
        staple: pick(r, STAPLES),
        cookTime: pick(r, COOK_TIMES),
      },
      createdAt: Date.now() - i * 86_400_000,
    });
  }

  const fridge = [];
  for (let i = 0; i < nFridge; i++) {
    const name = INGREDIENTS[i % INGREDIENTS.length];
    const cat = pick(r, CATEGORIES);
    fridge.push({
      id: `f-${i}`,
      name,
      quantity: `${1 + Math.floor(r() * 5)}${pick(r, ["個", "g", "本", "パック"])}`,
      category: cat,
      purchasedOn: isoDate(today, -Math.floor(r() * 10)),
      expiresOn: isoDate(today, -3 + Math.floor(r() * 20)), // 期限切れ〜2週間先まで散らす
      createdAt: Date.now() - i * 3_600_000,
      zone: pick(r, ZONES),
    });
  }

  const meals = [];
  for (let i = 0; i < nMeals; i++) {
    const rec = recipes[Math.floor(r() * recipes.length)];
    meals.push({
      id: `m-${i}`,
      date: isoDate(today, -Math.floor(r() * 365)), // 1年分
      slot: r() < 0.5 ? "昼" : "夜",
      recipeId: rec.id,
      recipeName: rec.name,
      made: r() < 0.7,
    });
  }

  const ratings = [];
  for (let i = 0; i < Math.floor(nRecipes * 0.4); i++) {
    ratings.push({
      recipeId: recipes[Math.floor(r() * recipes.length)].id,
      stars: 1 + Math.floor(r() * 5),
    });
  }

  return { recipes, fridge, meals, ratings };
}

/** localStorage に流し込む形（キーは src/lib/storage.ts と一致させる） */
export function toLocalStorage(ds) {
  return {
    "fridge-app:items:v2": JSON.stringify(ds.fridge),
    "fridge-app:recipes:v1": JSON.stringify(ds.recipes),
    "fridge-app:meals:v1": JSON.stringify(ds.meals),
    "cooksync:ratings:v1": JSON.stringify(ds.ratings),
    "fridge-app:shopping:v1": "[]",
    "cooksync:account:v1": "[]",
    "cooksync:usage:v1": "[]",
  };
}
