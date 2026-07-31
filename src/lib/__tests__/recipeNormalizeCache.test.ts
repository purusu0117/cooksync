// normalizeName に Map キャッシュを入れた（2026-08-01）ことで **挙動が1ミリも変わっていない** ことの回帰テスト。
//
// キャッシュを入れてよい根拠は「normalizeNameUncached が純粋関数であること」。
// ここでは実際に
//   ① キャッシュ有り／無しの結果が全入力で一致する
//   ② 何度呼んでも同じ（＝キャッシュが壊れた値を返さない）
//   ③ 上限に達してキャッシュを捨てたあとも同じ
// を確かめる。①が崩れたら「純粋ではなくなった」ということなので、キャッシュを外すこと。

import { describe, it, expect } from "vitest";
import {
  ingredientMatches,
  normalizeName,
  normalizeNameUncached,
} from "../recipe";

// 表記ゆれ・括弧書き・全角空白・カタカナ・数量混じり・調味料・缶詰まで一通り
const NAMES = [
  "玉ねぎ", "タマネギ", "たまねぎ", "玉葱", "玉ねぎ1個", "玉ねぎ（みじん切り）",
  "人参", "にんじん", "ニンジン", "大根", "だいこん",
  "卵", "たまご", "玉子", "鶏肉", "とり肉", "鳥肉", "豚肉", "牛肉", "ひき肉", "挽肉",
  "長ねぎ", "長ネギ", "長葱", "ねぎ", "葱", "なす", "茄子", "きゅうり", "胡瓜",
  "じゃがいも", "じゃが芋", "馬鈴薯", "さつまいも", "薩摩芋", "かぼちゃ", "南瓜",
  "にんにく", "大蒜", "しょうが", "生姜", "ピーマン", "ぴーまん",
  "醤油", "しょうゆ", "味噌", "みそ", "砂糖", "さとう", "塩", "こしょう", "胡椒",
  "鮭", "さけ", "しゃけ", "豆腐", "とうふ", "胡麻", "ごま",
  "トマト", "とまと", "トマト缶", "ホールトマト", "カットトマト缶", "トマト水煮",
  "　スパゲッティ　", "スパゲッティ（1.8mm太麺）", "塩・こしょう", "しめじ, えのき",
  "", "   ", "Chicken Breast", "BACON",
];

describe("normalizeName のキャッシュ", () => {
  it("キャッシュ有りと無しで結果が完全に一致する", () => {
    for (const n of NAMES) {
      expect(normalizeName(n)).toBe(normalizeNameUncached(n));
    }
  });

  it("同じ入力を何度呼んでも同じ結果（キャッシュが値を壊さない）", () => {
    for (const n of NAMES) {
      const first = normalizeName(n);
      for (let i = 0; i < 5; i++) expect(normalizeName(n)).toBe(first);
    }
  });

  it("上限を超えてキャッシュが捨てられても結果は変わらない", () => {
    // NORMALIZE_CACHE_LIMIT(5000) を確実に超えるだけ別々の名前を流す
    for (let i = 0; i < 6000; i++) normalizeName(`架空の食材${i}`);
    for (const n of NAMES) {
      expect(normalizeName(n)).toBe(normalizeNameUncached(n));
    }
  });

  it("材料マッチングの結果も変わらない（缶詰と生鮮の区別を含む）", () => {
    expect(ingredientMatches("玉ねぎ", "タマネギ")).toBe(true);
    expect(ingredientMatches("玉ねぎ1個", "たまねぎ")).toBe(true);
    expect(ingredientMatches("鶏肉", "とり肉")).toBe(true);
    // 缶詰（加工品）と生鮮は別物のまま
    expect(ingredientMatches("トマト", "トマト缶")).toBe(false);
    expect(ingredientMatches("トマト缶", "ホールトマト")).toBe(true);
    expect(ingredientMatches("玉ねぎ", "にんじん")).toBe(false);
    expect(ingredientMatches("", "玉ねぎ")).toBe(false);
  });
});
