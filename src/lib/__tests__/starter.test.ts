// 初回導線（QuickStart）の土台を固定する。
//
// ここが静かに壊れたときに起きること：
//   - STARTER_FOODS に辞書外の名前が混ざる
//       → 「よく買うもの」をタップするたびに /api/estimate-expiry（AI）が飛ぶ。
//         無料枠の中で成立させる設計が崩れ、原価も乗る。目視では**絶対に気づけない**。
//   - quickItem が期限やゾーンを埋めなくなる
//       → 名前だけで入れた食材が「期限なし・その他」になり、優先消費バナーにも出ない。
//         初回の到達点（最初の献立が出る）まで届かなくなる。
//   - SUGGEST_THRESHOLD / remainingToSuggest がズレる
//       → 「あと2つ」の表示と、実際に献立が出せる件数が食い違う（＝嘘の進捗）。

import { describe, it, expect } from "vitest";
import {
  STARTER_FOODS,
  SUGGEST_THRESHOLD,
  quickItem,
  remainingToSuggest,
  starterSuggestions,
} from "../starter";
import { guessItem } from "../guess";
import { zoneForCategory } from "../food";

const TODAY = "2026-08-01";

describe("SUGGEST_THRESHOLD / remainingToSuggest", () => {
  it("「冷蔵庫を全部登録」ではなく3つで到達できる", () => {
    expect(SUGGEST_THRESHOLD).toBe(3);
  });

  it("ゴールまでの距離を返す（超えたら0で、マイナスにしない）", () => {
    expect(remainingToSuggest(0)).toBe(3);
    expect(remainingToSuggest(1)).toBe(2);
    expect(remainingToSuggest(3)).toBe(0);
    expect(remainingToSuggest(40)).toBe(0);
  });
});

describe("STARTER_FOODS", () => {
  it("全部が guess.ts の辞書に載っている＝タップしてもAIを呼ばない", () => {
    const needsAI = STARTER_FOODS.filter((f) => guessItem(f, TODAY).needsAI);
    expect(needsAI).toEqual([]);
  });

  it("全部が「その他」以外に分類できる（分類不能なものを候補に出さない）", () => {
    const unclassified = STARTER_FOODS.filter(
      (f) => guessItem(f, TODAY).category === "その他",
    );
    expect(unclassified).toEqual([]);
  });

  it("重複が無い（同じ食材が2回チップに出ない）", () => {
    expect(new Set(STARTER_FOODS).size).toBe(STARTER_FOODS.length);
  });

  it("最初の画面に出す8件だけで、主材料と野菜が両方そろう（3つ入れれば献立が成立する）", () => {
    const first8 = starterSuggestions([], 8).map(
      (n) => guessItem(n, TODAY).category,
    );
    expect(first8).toContain("野菜");
    expect(
      first8.some((c) => c === "肉・魚" || c === "乳製品・卵"),
    ).toBe(true);
  });
});

describe("starterSuggestions", () => {
  it("既に冷蔵庫にあるものは候補から外す（同じものを2度勧めない）", () => {
    const out = starterSuggestions(["卵", "玉ねぎ"], 16);
    expect(out).not.toContain("卵");
    expect(out).not.toContain("玉ねぎ");
    expect(out).toContain("牛乳");
  });

  it("表記ゆれ（たまご/タマゴ）でも同じものとして外す", () => {
    expect(starterSuggestions(["たまご"], 16)).not.toContain("卵");
    expect(starterSuggestions(["タマネギ"], 16)).not.toContain("玉ねぎ");
  });

  it("件数を絞れる（チップが画面を埋め尽くさない）", () => {
    expect(starterSuggestions([], 8)).toHaveLength(8);
  });
});

describe("quickItem", () => {
  it("食材名だけで、カテゴリ・期限・保存ゾーン・購入日が全部埋まる", () => {
    const it0 = quickItem("鶏もも肉", TODAY);
    expect(it0.name).toBe("鶏もも肉");
    expect(it0.category).toBe("肉・魚");
    expect(it0.zone).toBe(zoneForCategory("肉・魚"));
    expect(it0.purchasedOn).toBe(TODAY);
    // 鶏＝2日（guess.ts の辞書）
    expect(it0.expiresOn).toBe("2026-08-03");
    expect(it0.id).toBeTruthy();
    expect(it0.createdAt).toBeGreaterThan(0);
  });

  it("推定結果は手入力フォーム（guessItem）と完全に一致する＝入口で結果が変わらない", () => {
    for (const name of STARTER_FOODS) {
      const g = guessItem(name, TODAY);
      const q = quickItem(name, TODAY);
      expect(q.category).toBe(g.category);
      expect(q.expiresOn).toBe(g.expiresOn);
    }
  });

  it("パック売りの食材は数量に販売単位が入る（空欄のままにしない）", () => {
    expect(quickItem("卵", TODAY).quantity).toBe("1パック");
    expect(quickItem("豆腐", TODAY).quantity).toBe("1丁");
    expect(quickItem("もやし", TODAY).quantity).toBe("1袋");
  });

  it("前後の空白は落とす（チップと手入力で別名にならない）", () => {
    expect(quickItem("  玉ねぎ  ", TODAY).name).toBe("玉ねぎ");
  });

  it("辞書に無い食材でもその場で登録できる（AI待ちで止めない）", () => {
    const q = quickItem("ドリアン", TODAY);
    expect(q.name).toBe("ドリアン");
    expect(q.expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.category).toBe("その他");
  });

  it("『〜ルー』で終わる果物を調味料（＝1年もち）にしない", () => {
    // 「ルー」の部分一致で ブルーベリー／ドラゴンフルーツ が調味料になっていた。
    // 名前だけで登録する導線が主役になったので、カテゴリ誤判定は
    // そのまま「期限が1年後」＝使い切り提案から永久に漏れる、を意味する。
    for (const name of ["ドラゴンフルーツ", "ブルーベリー", "グレープフルーツ"]) {
      expect(quickItem(name, TODAY).category).not.toBe("調味料");
    }
    // カレールーは調味料のまま
    expect(quickItem("カレールー", TODAY).category).toBe("調味料");
  });

  it("IDは毎回違う（同じ食材を2つ入れても片方が消えない）", () => {
    expect(quickItem("卵", TODAY).id).not.toBe(quickItem("卵", TODAY).id);
  });
});
