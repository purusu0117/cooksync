// 取り込みプレビューの「レシピが無いのに渡された」ケースを押さえる。
//
// このコンポーネントはホーム画面(RecipeSources)の中に描かれるので、ここで例外が出ると
// **ホーム画面ごと真っ白**になる（TypeError: Cannot read properties of undefined
// (reading 'name')）。サーバー側でも error にしているが、古いジョブや将来の経路で
// すり抜けても画面が死なないことを、描画結果として固定しておく。

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ImportedRecipePreview, {
  type ImportResult,
} from "@/components/recipes/ImportedRecipePreview";

function render(result: ImportResult) {
  return renderToStaticMarkup(<ImportedRecipePreview result={result} onDiscard={() => {}} />);
}

describe("ImportedRecipePreview", () => {
  it("recipe が null でも落ちず、何も描かない", () => {
    expect(render({ recipe: null })).toBe("");
  });

  it("recipe が undefined でも落ちず、何も描かない（doneなのに中身が無い古いジョブ）", () => {
    expect(render({ recipe: undefined })).toBe("");
  });

  it("レシピがあれば従来どおり中身を描く", () => {
    const html = render({
      recipe: { name: "肉じゃが", catch: "定番の味", ingredients: [], steps: [] },
    });
    expect(html).toContain("肉じゃが");
  });
});
