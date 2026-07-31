// 中核ロジックのマイクロベンチ（ブラウザ不要・数秒で終わる）。
//
//   npx vitest bench scripts/bench-core.bench.ts --run
//
// ここで測るのは「2026-08-01 に入れた高速化そのもの」の前後。
// **旧実装を再現するのではなく、旧実装が実際に呼んでいた関数をそのまま呼ぶ**ので、
// 「ベンチ用に都合よく書いた比較」にならない：
//   - normalizeName（Mapキャッシュ付き） vs normalizeNameUncached（キャッシュを入れる前の実体）
//   - recentMeals を1回だけ呼んで Set 参照 vs レシピごとに wasMadeRecently（旧 rankCandidates）
//   - starsMapOf/madeCountMapOf で索引 vs ratings.find()/meals.filter() の全走査（旧3画面）
//
// 画面まるごとの実測は scripts/bench-render.mjs（Playwright）の方。

import { bench, describe } from "vitest";
import { normalizeName, normalizeNameUncached, ingredientMatches } from "@/lib/recipe";
import { madeCountMapOf, starsMapOf } from "@/lib/ranking";
import { recentMeals, wasMadeRecently, type MealEntry } from "@/lib/mealplan";

const TODAY = "2026-08-01";

// 計算結果の捨て先。これが無いと JIT に「使われていない」と見なされて丸ごと消される。
let sink = 0;
export const __sink = () => sink;

// --- 合成データ（scripts/bench-data.mjs と同じ規模：レシピ200 / 在庫100 / 履歴700） ---
const NAMES = [
  "玉ねぎ", "たまねぎ", "タマネギ", "人参", "にんじん", "じゃがいも", "大根", "キャベツ",
  "白菜", "ピーマン", "なす", "きゅうり", "トマト", "トマト缶", "ほうれん草", "小松菜",
  "もやし", "ブロッコリー", "しめじ", "えのき", "長ねぎ", "ごぼう", "かぼちゃ", "にんにく",
  "生姜", "鶏もも肉", "鶏むね肉", "豚バラ肉", "豚こま切れ", "牛こま切れ", "ひき肉",
  "ベーコン", "ウインナー", "鮭", "さば", "エビ", "ツナ缶", "卵", "牛乳", "バター",
  "チーズ", "豆腐", "納豆", "スパゲッティ", "うどん", "ご飯", "食パン", "醤油", "みりん",
  "塩", "こしょう", "砂糖", "味噌", "ごま油", "酒", "玉ねぎ（みじん切り）", "スパゲッティ（1.8mm太麺）",
];

const RECIPE_IDS = Array.from({ length: 200 }, (_, i) => `r-${i}`);
const FRIDGE_NAMES = Array.from({ length: 100 }, (_, i) => NAMES[i % NAMES.length]);
const RECIPE_INGREDIENTS = RECIPE_IDS.map((_, i) =>
  Array.from({ length: 12 }, (_, k) => NAMES[(i * 7 + k * 3) % NAMES.length]),
);

const MEALS: MealEntry[] = Array.from({ length: 700 }, (_, i) => ({
  id: `m-${i}`,
  date: `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
  slot: i % 2 ? "夜" : "昼",
  recipeId: RECIPE_IDS[i % RECIPE_IDS.length],
  recipeName: "x",
  made: i % 3 !== 0,
}));

const RATINGS = Array.from({ length: 80 }, (_, i) => ({
  recipeId: RECIPE_IDS[i * 2],
  stars: 1 + (i % 5),
}));

// ---------------------------------------------------------------------------

describe("材料名の正規化（レシピ一覧の在庫判定で48万回呼ばれる経路）", () => {
  // 実際の使われ方：レシピの材料 × 冷蔵庫の在庫 の総当たり。名前の種類は有限なので
  // キャッシュはほぼ全ヒットになる。
  bench("キャッシュあり（現行 normalizeName）", () => {
    for (const ings of RECIPE_INGREDIENTS) {
      for (const ing of ings) {
        for (const f of FRIDGE_NAMES) {
          normalizeName(ing);
          normalizeName(f);
        }
      }
    }
  });

  bench("キャッシュなし（旧実装 normalizeNameUncached）", () => {
    for (const ings of RECIPE_INGREDIENTS) {
      for (const ing of ings) {
        for (const f of FRIDGE_NAMES) {
          normalizeNameUncached(ing);
          normalizeNameUncached(f);
        }
      }
    }
  });
});

describe("在庫マッチング（買い足し数の算出そのもの）", () => {
  bench("ingredientMatches 総当たり 200×12×100", () => {
    let n = 0;
    for (const ings of RECIPE_INGREDIENTS) {
      for (const ing of ings) {
        for (const f of FRIDGE_NAMES) if (ingredientMatches(f, ing)) n++;
      }
    }
    sink = n;
  });
});

describe("連日回避の判定（rankCandidates の中身）", () => {
  bench("現行：recentMeals を1回 → Set で引く", () => {
    const recentIds = new Set(recentMeals(MEALS, 2, TODAY).map((e) => e.recipeId));
    let n = 0;
    for (const id of RECIPE_IDS) if (recentIds.has(id)) n++;
    sink = n;
  });

  bench("旧実装：レシピごとに wasMadeRecently（履歴700件を毎回パース＋ソート）", () => {
    let n = 0;
    for (const id of RECIPE_IDS) if (wasMadeRecently(MEALS, id, 2, TODAY)) n++;
    sink = n;
  });
});

describe("星評価・作った回数の引き方（レシピ一覧の1行ごと）", () => {
  bench("現行：Map 索引を作って O(1) で引く", () => {
    const stars = starsMapOf(RATINGS);
    const made = madeCountMapOf(MEALS);
    let n = 0;
    for (const id of RECIPE_IDS) n += (stars.get(id) ?? 0) + (made.get(id) ?? 0);
    sink = n;
  });

  bench("旧実装：ratings.find() / meals.filter() で毎回全走査", () => {
    let n = 0;
    for (const id of RECIPE_IDS) {
      n += RATINGS.find((r) => r.recipeId === id)?.stars ?? 0;
      n += MEALS.filter((m) => m.recipeId === id && m.made).length;
    }
    sink = n;
  });
});
