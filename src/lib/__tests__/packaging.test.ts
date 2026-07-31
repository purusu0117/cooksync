import { describe, it, expect } from "vitest";
import { packOf, toBuyableFor, convertAmount, quantitySuggestions } from "../packaging";

describe("toBuyableFor（買い物リストは店で買える単位にする）", () => {
  it("中身の個数で書かれた分量を、売っている単位に換算する", () => {
    // レシピの「ミニトマト5個」をそのまま買い物リストに入れても店では買えない
    expect(toBuyableFor("ミニトマト", "5個").amount).toBe("1パック");
    expect(toBuyableFor("ミニトマト", "20個").amount).toBe("2パック");
    expect(toBuyableFor("卵", "2個").amount).toBe("1パック");
    expect(toBuyableFor("卵", "8個").amount).toBe("2パック");
    expect(toBuyableFor("にんにく", "2かけ").amount).toBe("1玉");
  });
  it("半端な本数・束数は切り上げる", () => {
    expect(toBuyableFor("長ねぎ", "1/2本").amount).toBe("1本");
    expect(toBuyableFor("にんじん", "1/3本").amount).toBe("1本");
    expect(toBuyableFor("水菜", "1/2束").amount).toBe("1束");
  });
  it("「適量」「少々」は1単位で買う", () => {
    expect(toBuyableFor("小ねぎ", "適量").amount).toBe("1束");
    expect(toBuyableFor("大葉", "少々").amount).toBe("1パック");
  });
  it("重さから必要なパック数を出す", () => {
    expect(toBuyableFor("しめじ", "150g").amount).toBe("2パック");
    expect(toBuyableFor("もやし", "200g").amount).toBe("1袋");
  });
  it("辞書に無い食材は従来どおり（重さはそのまま・個数は切り上げ）", () => {
    expect(toBuyableFor("鶏もも肉", "250g").amount).toBe("250g");
    expect(toBuyableFor("謎の食材", "1/2個").amount).toBe("1個");
  });
  it("調味料の計量単位は販売単位に換算しない", () => {
    expect(toBuyableFor("しょうゆ", "大さじ2").amount).toBe("1本");
  });
  it("加工品は生鮮の売り方に引きずられない", () => {
    expect(packOf("にんにくチューブ")).toBeNull();
    expect(packOf("トマト缶")).toBeNull();
  });
  it("買い方の目安（hint）を添える", () => {
    expect(toBuyableFor("ミニトマト", "5個").hint).toContain("15個");
  });
});

describe("convertAmount（在庫の単位をレシピの単位に換算）", () => {
  it("パック↔個を換算する", () => {
    expect(convertAmount("卵", "1パック", "個")).toBe(6);
    expect(convertAmount("ミニトマト", "2パック", "個")).toBe(30);
  });
  it("換算できないものは null", () => {
    expect(convertAmount("鶏もも肉", "1パック", "g")).toBeNull();
    expect(convertAmount("卵", "適量", "個")).toBeNull();
  });
  it("同じ単位ならそのまま数値を返す", () => {
    expect(convertAmount("卵", "3個", "個")).toBe(3);
  });
});

describe("quantitySuggestions（在庫登録の数量チップ）", () => {
  it("箱・パック売りの食材は入力候補を出す", () => {
    expect(quantitySuggestions("ミニトマト")).toContain("1パック");
    expect(quantitySuggestions("固形コンソメ")).toContain("1箱");
    expect(quantitySuggestions("卵")).toContain("6個");
  });
  it("辞書に無い食材は候補なし", () => {
    expect(quantitySuggestions("謎の食材")).toEqual([]);
  });
});
