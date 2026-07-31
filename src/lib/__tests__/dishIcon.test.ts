import { describe, it, expect } from "vitest";
import { dishIconOf } from "../dishIcon";

describe("dishIconOf（料理名から専用イラストを選ぶ）", () => {
  it("主食の型を取り違えない", () => {
    expect(dishIconOf("ふわとろ親子丼")).toBe("donburi");
    expect(dishIconOf("塩ダレキャベツ豚丼")).toBe("donburi");
    expect(dishIconOf("あさりの炊き込みご飯")).toBe("donburi"); // あさり(魚介)より丼が先
    expect(dishIconOf("濃厚チーズのタコライス")).toBe("donburi");
    expect(dishIconOf("ウインナーと長ねぎの香ばし卵チャーハン")).toBe("friedrice"); // 卵より炒飯
    expect(dishIconOf("牛乳と全卵の濃厚カルボナーラ")).toBe("pasta"); // 卵よりパスタ
    expect(dishIconOf("いろいろキノコのスパゲッティ")).toBe("pasta");
    expect(dishIconOf("肉うどん")).toBe("noodle");
  });
  it("汁物と煮込みを分ける", () => {
    expect(dishIconOf("ミネストローネ")).toBe("soup");
    expect(dishIconOf("クラムチャウダー")).toBe("soup");
    expect(dishIconOf("きのこと玉ねぎ(と卵)のコンソメスープ")).toBe("soup");
    expect(dishIconOf("鶏もも肉ときのこのトマト煮込み")).toBe("stew");
    expect(dishIconOf("至高のチキントマト煮")).toBe("stew");
  });
  it("魚介・肉・卵・揚げ物", () => {
    expect(dishIconOf("鮭のムニエル ミニトマト白ワインソース")).toBe("fish");
    expect(dishIconOf("ちゃんちゃん焼き")).toBe("fish");
    expect(dishIconOf("サーモンポキ")).toBe("fish");
    expect(dishIconOf("エビチリもどき")).toBe("shrimp");
    expect(dishIconOf("鶏の唐揚げ")).toBe("fried"); // 鶏(meat)より揚げ物が先
    expect(dishIconOf("ハンバーグ")).toBe("meat");
    expect(dishIconOf("卵かけご飯風オムレツ")).toBe("egg");
    // 「玉」単体は卵と見なさない（玉ねぎが卵になるため）。「にら玉炒め」は炒め物扱いでよい
    expect(dishIconOf("鶏にら玉炒め")).toBe("stirfry");
  });
  it("炒め物・サラダ・副菜・巻きもの", () => {
    expect(dishIconOf("豚バラともやしのオイスター炒め")).toBe("stirfry");
    expect(dishIconOf("野菜たっぷり豚プルコギ")).toBe("stirfry");
    expect(dishIconOf("豚キムチ")).toBe("stirfry");
    expect(dishIconOf("冷しゃぶのおろしポン酢サラダ")).toBe("salad");
    expect(dishIconOf("アボカドとトマトときゅうりの中華サラダ")).toBe("salad");
    expect(dishIconOf("にんにくみそのたたききゅうり")).toBe("salad");
    expect(dishIconOf("なすの照り焼き")).toBe("vegetable");
    expect(dishIconOf("エビとアボカドの生春巻き 自家製スイートチリ")).toBe("roll");
  });
  it("名前で決まらなければ主食タグ、それも無ければ皿", () => {
    expect(dishIconOf("謎の一品", "麺")).toBe("noodle");
    expect(dishIconOf("謎の一品", "パン")).toBe("bread");
    expect(dishIconOf("謎の一品")).toBe("plate");
  });
});
