import { describe, it, expect } from "vitest";
import { toBuyableAmount, subtractAmount, parseAmount } from "../portion";

describe("toBuyableAmount", () => {
  it("個数の端数は切り上げて買える量にする", () => {
    expect(toBuyableAmount("1/2個")).toBe("1個");
    expect(toBuyableAmount("1/4個")).toBe("1個");
    expect(toBuyableAmount("1と1/2個")).toBe("2個");
    expect(toBuyableAmount("1片")).toBe("1片");
    expect(toBuyableAmount("2本")).toBe("2本");
  });
  it("範囲は上限を採用", () => {
    expect(toBuyableAmount("160〜180g")).toBe("180g");
    expect(toBuyableAmount("1〜2個")).toBe("2個");
  });
  it("重量・容量はそのまま（半端でも買えるので）", () => {
    expect(toBuyableAmount("180g")).toBe("180g");
    expect(toBuyableAmount("100ml")).toBe("100ml");
  });
  it("調味料の計量単位（小さじ/大さじ/カップ/cm）は店で量り買い不可→1本", () => {
    expect(toBuyableAmount("大さじ2")).toBe("1本");
    expect(toBuyableAmount("小さじ1/2")).toBe("1本");
    expect(toBuyableAmount("カップ1")).toBe("1本");
    expect(toBuyableAmount("5cm")).toBe("1本"); // わさび等
  });
  it("適量・お好みは変えない", () => {
    expect(toBuyableAmount("適量")).toBe("適量");
    expect(toBuyableAmount("適量（味変）")).toBe("適量（味変）");
  });
});

describe("subtractAmount", () => {
  it("1個から1/4使うと3/4残る", () => {
    expect(subtractAmount("1個", "1/4個")).toBe("3/4個");
  });
  it("1個から1/2使うと1/2残る", () => {
    expect(subtractAmount("1個", "1/2個")).toBe("1/2個");
  });
  it("ちょうど使い切ると空（削除目印）", () => {
    expect(subtractAmount("1個", "1個")).toBe("");
    expect(subtractAmount("200g", "200g")).toBe("");
  });
  it("使う方が多くても0扱い（空）", () => {
    expect(subtractAmount("1個", "2個")).toBe("");
  });
  it("単位が違う/読めないときは在庫を維持（安全側）", () => {
    expect(subtractAmount("1パック", "160g")).toBe("1パック");
    expect(subtractAmount("1個", "適量")).toBe("1個");
    expect(subtractAmount("少々", "1個")).toBe("少々");
  });
  it("グラムの引き算", () => {
    expect(subtractAmount("300g", "180g")).toBe("120g");
  });
});

describe("parseAmount", () => {
  it("範囲は上限を取る", () => {
    expect(parseAmount("160〜180g")).toEqual({ num: 180, unit: "g", ok: true });
  });
  it("読めないものは ok:false", () => {
    expect(parseAmount("適量").ok).toBe(false);
  });
});
