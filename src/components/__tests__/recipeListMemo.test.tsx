// レシピ一覧の高速化（2026-08-01）の回帰テスト。
//
// 星評価と「作った回数」を Map 索引に切り替え、1行ぶんの RecipeRow を memo 化した。
// 索引そのものの挙動は src/lib/__tests__/rankingIndex.test.ts で固定してあるので、
// ここでは **画面として出るものが変わっていない** ことだけを見る
// （memo 化でうっかり行が描かれなくなる／件数がズレる、を防ぐ）。
//
// サーバー描画なので保存レシピは空＝内蔵サンプル（SEED_RECIPES）が並ぶ。

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RecipeList from "@/components/recipes/RecipeList";
import { SEED_RECIPES } from "@/lib/seedRecipes";

describe("RecipeList（索引化・memo 化後）", () => {
  const html = renderToStaticMarkup(<RecipeList />);

  it("サンプルレシピが全部並ぶ", () => {
    for (const r of SEED_RECIPES) expect(html).toContain(r.name);
  });

  it("件数表示がレシピ数と一致する", () => {
    expect(html).toContain(`${SEED_RECIPES.length}件`);
  });

  // 冷蔵庫が空のときは在庫バッジを**出さない**。
  // 空の冷蔵庫と突き合わせれば当然どれも「買い足し10品」になるが、それは在庫を
  // 知らないだけで事実ではない。初めて開いた人の一覧がオレンジの「買い足し」で
  // 埋まると「何も作れないアプリ」に見えるので、在庫が1つ入るまでは何も言わない。
  it("冷蔵庫が空のあいだは在庫バッジを出さない", () => {
    expect(html).not.toContain("買い足し");
    expect(html).not.toContain("在庫で作れる</span>");
  });

  it("検索・絞り込み・並び替えのUIが出る", () => {
    expect(html).toContain("おすすめ順");
    expect(html).toContain("評価が高い順");
    expect(html).toContain("よく作る順");
    expect(html).toContain("新しい順");
    expect(html).toContain("絞り込み");
  });
});
