import { describe, it, expect } from "vitest";
import { guessCategory, guessItem, guessShelfLifeDays } from "../guess";

describe("guessCategory", () => {
  it("食材名からカテゴリを推定", () => {
    expect(guessCategory("鶏もも肉")).toBe("肉・魚");
    expect(guessCategory("玉ねぎ")).toBe("野菜");
    expect(guessCategory("牛乳")).toBe("乳製品・卵");
    expect(guessCategory("醤油")).toBe("調味料");
    expect(guessCategory("食パン")).toBe("主食");
    expect(guessCategory("謎の物体")).toBe("その他");
  });
  it("トマト缶は生トマト（野菜）と分けて分類する", () => {
    expect(guessCategory("トマト")).toBe("野菜");
    expect(guessCategory("ミニトマト")).toBe("野菜");
    expect(guessCategory("トマト缶")).toBe("調味料");
    expect(guessCategory("カットトマト缶")).toBe("調味料");
  });
  it("ひらがな・カタカナ表記でも同じカテゴリになる（実データの取りこぼし対策）", () => {
    // 「しょうゆ」「めんつゆ」「白いりごま」等が“その他”に落ちていた
    expect(guessCategory("しょうゆ")).toBe("調味料");
    expect(guessCategory("めんつゆ")).toBe("調味料");
    expect(guessCategory("白いりごま")).toBe("調味料");
    expect(guessCategory("チリパウダー")).toBe("調味料");
    // チューブ薬味は生鮮の野菜ではなく調味料
    expect(guessCategory("にんにくチューブ")).toBe("調味料");
  });
  it("「水」を含む食材が飲料に誤分類されない", () => {
    expect(guessCategory("水菜")).toBe("野菜");
    expect(guessCategory("水")).toBe("飲料");
  });
});

describe("guessShelfLifeDays", () => {
  it("食材ごとの日持ち目安", () => {
    expect(guessShelfLifeDays("豚ひき肉")).toBe(1); // ひき肉は当日中
    expect(guessShelfLifeDays("鶏もも肉")).toBe(2);
    expect(guessShelfLifeDays("卵")).toBe(14);
    expect(guessShelfLifeDays("もやし")).toBe(3);
  });
  it("トマト缶は缶詰として長期保存、生トマトの6日に引っ張られない", () => {
    expect(guessShelfLifeDays("トマト")).toBe(6);
    expect(guessShelfLifeDays("トマト缶")).toBe(1095);
    expect(guessShelfLifeDays("ホールトマト")).toBe(1095);
    expect(guessShelfLifeDays("ツナ缶")).toBe(1095);
  });
  it("年単位で保存できるものは90日で頭打ちにしない", () => {
    expect(guessShelfLifeDays("砂糖")).toBe(3650);
    expect(guessShelfLifeDays("塩")).toBe(3650);
    expect(guessShelfLifeDays("スパゲッティ")).toBe(1095);
    expect(guessShelfLifeDays("しょうゆ")).toBe(540);
    expect(guessShelfLifeDays("はちみつ")).toBe(1095);
  });
  it("開封済みは開封後の目安に切り替わる", () => {
    expect(guessShelfLifeDays("しょうゆ", undefined, true)).toBe(30);
    expect(guessShelfLifeDays("ごま油", undefined, true)).toBe(60);
    expect(guessShelfLifeDays("トマト缶", undefined, true)).toBe(2);
    // 開封後の目安が無いものは未開封と同じ
    expect(guessShelfLifeDays("卵", undefined, true)).toBe(14);
  });
  it("紛らわしい名前を取り違えない", () => {
    expect(guessShelfLifeDays("牛乳")).toBe(7); // 「牛」で肉(4日)にしない
    expect(guessShelfLifeDays("塩鮭")).toBe(2); // 「塩」で10年にしない
    expect(guessShelfLifeDays("有塩バター")).toBe(180);
  });
});

describe("guessItem", () => {
  it("購入日＋目安日数で期限を推定", () => {
    const g = guessItem("鶏もも肉", "2026-06-08");
    expect(g.category).toBe("肉・魚");
    expect(g.shelfLifeDays).toBe(2);
    expect(g.expiresOn).toBe("2026-06-10");
    expect(g.needsAI).toBe(false);
  });
  it("辞書に無い食材は needsAI で印を付ける（AI推定に回す）", () => {
    expect(guessItem("謎の物体", "2026-06-08").needsAI).toBe(true);
    expect(guessItem("玉ねぎ", "2026-06-08").needsAI).toBe(false);
  });
});

describe("料理に使う酒類", () => {
  it("白ワイン・赤ワインは調味料（台所では料理用）", () => {
    expect(guessCategory("白ワイン")).toBe("調味料");
    expect(guessCategory("赤ワイン")).toBe("調味料");
    expect(guessCategory("ワイン")).toBe("飲料"); // ただの「ワイン」は飲み物
  });
});
