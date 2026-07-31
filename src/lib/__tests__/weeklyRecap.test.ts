import { describe, it, expect } from "vitest";
import { buildWeeklyRecap, mondayOf, streakOf } from "../weeklyRecap";
import type { MealEntry } from "../mealplan";
import type { FridgeItem } from "../food";

// 「今週の記録」は継続率のための表示なので、**数字が事実と一致していること**が命。
// 盛った数字は一度でも気づかれたらアプリ全体の数字が信じられなくなる。
// 2026-07-27(月) 〜 2026-08-02(日) を今週として固定してテストする。

const TODAY = "2026-07-31"; // 金曜

function meal(date: string, recipeId: string, name: string, made = true): MealEntry {
  return { id: `${date}-${recipeId}`, date, slot: "夜", recipeId, recipeName: name, made };
}

function item(name: string, expiresOn: string): FridgeItem {
  return {
    id: name,
    name,
    quantity: "1",
    category: "野菜",
    zone: "野菜",
    purchasedOn: "2026-07-20",
    expiresOn,
    createdAt: 0,
  };
}

const RECIPES = [
  {
    id: "napolitan",
    ingredients: [
      { name: "スパゲッティ" },
      { name: "玉ねぎ" },
      { name: "塩", basicSeasoning: true },
    ],
  },
  { id: "curry", ingredients: [{ name: "玉ねぎ" }, { name: "にんじん" }] },
];

describe("mondayOf", () => {
  it("週の始まりは月曜。月曜自身はその日を返す", () => {
    expect(mondayOf("2026-07-27")).toBe("2026-07-27"); // 月
    expect(mondayOf("2026-07-31")).toBe("2026-07-27"); // 金
    expect(mondayOf("2026-08-02")).toBe("2026-07-27"); // 日
    expect(mondayOf("2026-08-03")).toBe("2026-08-03"); // 次の月
  });
});

describe("buildWeeklyRecap", () => {
  it("「作った」記録だけ数える（献立に入れただけ made:false は数えない）", () => {
    const r = buildWeeklyRecap({
      meals: [
        meal("2026-07-28", "napolitan", "ナポリタン"),
        meal("2026-07-30", "curry", "カレー", false), // 計画のみ
      ],
      recipes: RECIPES,
      fridge: [],
      today: TODAY,
    });
    expect(r.madeCount).toBe(1);
    expect(r.dishes.map((d) => d.name)).toEqual(["ナポリタン"]);
  });

  it("先週の分は今週に混ざらない（先週の数字は別に返す）", () => {
    const r = buildWeeklyRecap({
      meals: [
        meal("2026-07-28", "curry", "カレー"),
        meal("2026-07-26", "curry", "カレー"), // 先週の日曜
        meal("2026-07-21", "napolitan", "ナポリタン"), // 先週の火曜
      ],
      recipes: RECIPES,
      fridge: [],
      today: TODAY,
    });
    expect(r.madeCount).toBe(1);
    expect(r.prevMadeCount).toBe(2);
  });

  it("同じ日に2品作っても「キッチンに立った日」は1日", () => {
    const r = buildWeeklyRecap({
      meals: [
        meal("2026-07-28", "curry", "カレー"),
        meal("2026-07-28", "napolitan", "ナポリタン"),
        meal("2026-07-30", "curry", "カレー"),
      ],
      recipes: RECIPES,
      fridge: [],
      today: TODAY,
    });
    expect(r.madeCount).toBe(3);
    expect(r.activeDays).toBe(2);
  });

  it("同じ料理は1行にまとめ、多い順に並べる", () => {
    const r = buildWeeklyRecap({
      meals: [
        meal("2026-07-28", "curry", "カレー"),
        meal("2026-07-29", "napolitan", "ナポリタン"),
        meal("2026-07-30", "curry", "カレー"),
      ],
      recipes: RECIPES,
      fridge: [],
      today: TODAY,
    });
    expect(r.dishes).toEqual([
      { recipeId: "curry", name: "カレー", count: 2 },
      { recipeId: "napolitan", name: "ナポリタン", count: 1 },
    ]);
  });

  it("使った食材は重複を除き、基本調味料は数えない（「使った実感」が無いため）", () => {
    const r = buildWeeklyRecap({
      meals: [
        meal("2026-07-28", "napolitan", "ナポリタン"),
        meal("2026-07-29", "curry", "カレー"),
      ],
      recipes: RECIPES,
      fridge: [],
      today: TODAY,
    });
    // 玉ねぎは両方に出るが1種類。塩(basicSeasoning)は除外。
    // 並びは料理の並び順（多い順→名前順）に従う＝カレーの材料が先に来る
    expect(r.ingredients).toEqual(["玉ねぎ", "にんじん", "スパゲッティ"]);
  });

  it("レシピが削除されていても落ちない（材料が引けない分は数えないだけ）", () => {
    const r = buildWeeklyRecap({
      meals: [meal("2026-07-28", "deleted-recipe", "消えたレシピ")],
      recipes: RECIPES,
      fridge: [],
      today: TODAY,
    });
    expect(r.madeCount).toBe(1);
    expect(r.ingredients).toEqual([]);
  });

  it("冷蔵庫の「期限切れ」「あと3日以内」を数え、近い順に名前を出す", () => {
    const r = buildWeeklyRecap({
      meals: [meal("2026-07-28", "curry", "カレー")],
      recipes: RECIPES,
      fridge: [
        item("キャベツ", "2026-07-29"), // 期限切れ
        item("にんじん", "2026-08-02"), // あと2日
        item("玉ねぎ", "2026-08-01"), // あと1日
        item("じゃがいも", "2026-08-20"), // まだ先
      ],
      today: TODAY,
    });
    expect(r.expired).toBe(1);
    expect(r.expiringSoon).toBe(2);
    expect(r.expiringNames).toEqual(["玉ねぎ", "にんじん"]);
  });

  it("「作った」記録が1件も無ければ hasHistory=false（0点の成績表を初日に見せない）", () => {
    const r = buildWeeklyRecap({
      meals: [meal("2026-07-28", "curry", "カレー", false)],
      recipes: RECIPES,
      fridge: [],
      today: TODAY,
    });
    expect(r.hasHistory).toBe(false);
  });

  it("同じ入力なら毎回同じ結果（AIを使わない＝決定論）", () => {
    const input = {
      meals: [
        meal("2026-07-28", "curry", "カレー"),
        meal("2026-07-29", "napolitan", "ナポリタン"),
      ],
      recipes: RECIPES,
      fridge: [item("玉ねぎ", "2026-08-01")],
      today: TODAY,
    };
    expect(buildWeeklyRecap(input)).toEqual(buildWeeklyRecap(input));
  });
});

describe("streakOf（何週つづけて料理しているか）", () => {
  const monday = "2026-07-27";

  it("今週作っていれば今週から数える", () => {
    const meals = [
      meal("2026-07-28", "a", "A"),
      meal("2026-07-21", "a", "A"),
      meal("2026-07-14", "a", "A"),
    ];
    expect(streakOf(meals, monday)).toBe(3);
  });

  it("**今週まだ0でも連続を折らない**（月曜の朝に「連続0週」と言わない）", () => {
    const meals = [meal("2026-07-21", "a", "A"), meal("2026-07-14", "a", "A")];
    expect(streakOf(meals, monday)).toBe(2);
  });

  it("丸1週間なにも作らなければ0に戻る", () => {
    // 今週も先週も無し（先々週だけ）
    expect(streakOf([meal("2026-07-14", "a", "A")], monday)).toBe(0);
  });

  it("記録が1件も無ければ0", () => {
    expect(streakOf([], monday)).toBe(0);
  });
});
