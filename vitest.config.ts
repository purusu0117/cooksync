// vitest の設定。**やっていることは `@/` エイリアスの解決だけ**。
//
// なぜ要るか：src/lib/*.ts のテストは相対パス（`../affiliate`）で書けるが、
// コンポーネントのテストはそうはいかない。コンポーネント自身が `@/lib/...` で
// 他を読んでいるので、エイリアスが解決できないとテストから import した瞬間に落ちる。
//
// 収益導線（ShoppablePanel）は「提携先が未設定のあいだは1ピクセルも描かない」ことが仕様で、
// そこが静かに壊れると **広告表記だけ残って報酬にならないリンクが全ユーザーに出る**。
// 目視では気づけないので、描画結果をテストで固定できるようにしておく。
//
// include は既定のまま（`**/*.{test,spec}.?(c|m)[jt]s?(x)`）＝既存の src/lib/__tests__ も従来どおり動く。

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    // テストが大翔の実データ .data/ を壊さないよう、ワーカーごとの一時ディレクトリに逃がす。
    // 詳細は vitest.setup.ts のコメント。
    setupFiles: ["./vitest.setup.ts"],
  },
});
