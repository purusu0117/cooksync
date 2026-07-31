// RecipeDetail の useMemo 化（2026-08-01）の回帰テスト。
//
// この画面は 961行あって useMemo を1つも使っていなかった。派生値を useMemo に移すために
// **計算をぜんぶ早期 return より前へ動かした**ので、
//   ① レシピが見つからないとき（フックは走るが recipe===null）に落ちない
//   ② 見つかるときの表示が変わっていない（材料・工程・在庫判定・保存方法・参考リンク）
// を固定しておく。①はフックの順序を壊すと即クラッシュする箇所なので特に重要。
//
// サーバー描画なので、保存レシピは空＝内蔵サンプル（SEED_RECIPES）が見える状態になる。

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// useRouter は App Router のコンテキストが要る（描画するだけなので中身は使わない）
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
}));

const { default: RecipeDetail } = await import("@/components/recipes/RecipeDetail");
const { SEED_RECIPES } = await import("@/lib/seedRecipes");

const seed = SEED_RECIPES[0];

describe("RecipeDetail（useMemo 化後）", () => {
  it("存在しないIDでも落ちず、読み込み中の表示になる", () => {
    const html = renderToStaticMarkup(<RecipeDetail id="does-not-exist" />);
    expect(html).not.toBe("");
    expect(html).toContain("レシピ");
  });

  it("サンプルレシピの中身が従来どおり描かれる", () => {
    const html = renderToStaticMarkup(<RecipeDetail id={seed.id} />);
    expect(html).toContain(seed.name);
    expect(html).toContain(seed.catch);
    // 材料（グループ分け＋分量）
    for (const ing of seed.ingredients.slice(0, 3)) {
      expect(html).toContain(ing.name);
    }
    // 工程（1作業＝1チェックに割られている）
    expect(html).toContain("行程");
    expect(html).toContain("余った材料の保存");
    expect(html).toContain("参考にしたページ");
    expect(html).toContain("レシピ一覧へ戻る");
  });

  it("在庫ゼロなので、基本調味料以外は「買い足し」表示になる", () => {
    const html = renderToStaticMarkup(<RecipeDetail id={seed.id} />);
    expect(html).toContain("買い足し");
    expect(html).not.toContain("在庫あり");
  });

  it("人数セレクタ・作った回数・評価が出る", () => {
    const html = renderToStaticMarkup(<RecipeDetail id={seed.id} />);
    expect(html).toContain("何人前で作る？");
    expect(html).toContain("作った回数");
    expect(html).toContain("このレシピを評価");
    expect(html).toContain(`${seed.servings}人分`);
  });
});
