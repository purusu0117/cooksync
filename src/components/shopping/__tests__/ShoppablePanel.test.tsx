// 「まとめて買う」導線の**描画結果**を固定する。
//
// ここが静かに壊れたときに起きること：
//   - 未設定なのに描かれる → 報酬にならないリンクと広告表記だけが全ユーザーに出る
//   - 設定済みなのに描かれない → 収益が0のまま、原因に気づけない
// どちらも目視では気づきにくい（提携先が増えるのは大翔が環境変数を入れた瞬間だけなので、
// 普段の動作確認では常に「出ない」側しか見ない）ので、テストで押さえる。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ShoppablePanel from "@/components/shopping/ShoppablePanel";
import { PARTNERS } from "@/lib/affiliate";

const ENV_KEYS = [
  ...PARTNERS.map((p) => p.envKey),
  "NEXT_PUBLIC_SHOPPABLE_PREVIEW",
];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(clearEnv);
afterEach(clearEnv);

function render(count: number) {
  return renderToStaticMarkup(
    <ShoppablePanel
      placement="shopping"
      count={count}
      title={`まだ買っていない${count}件を、ネットで注文して届けてもらう`}
      description="お店に行かなくても、ネットスーパーや食材宅配で受け取れます。"
      copyText="玉ねぎ 1個"
    />,
  );
}

describe("ShoppablePanel", () => {
  it("提携先が未設定なら1ピクセルも描かない＝既存画面の見た目が変わらない", () => {
    expect(render(3)).toBe("");
  });

  it("設定済みでも買うものが0件なら描かない（用が無いのに注文を勧めない）", () => {
    process.env.NEXT_PUBLIC_AFF_OISIX = "https://px.a8.net/svt/ejp?a8mat=X";
    expect(render(0)).toBe("");
  });

  it("設定済み＋不足ありで、リンク・広告表記・コピーボタンが出る", () => {
    process.env.NEXT_PUBLIC_AFF_OISIX = "https://px.a8.net/svt/ejp?a8mat=X";
    const html = render(3);
    expect(html).toContain("https://px.a8.net/svt/ejp?a8mat=X");
    // ボタンは「動作＋対象」で読める文言にする（行き先だけの「〜へ」にしない）
    expect(html).toContain("Oisix（オイシックス）で注文する");
    expect(html).toContain("買うもの3件をコピーする");
    // ステマ規制（2023-10-01施行）の広告表記
    expect(html).toContain(">PR<");
    expect(html).toContain("紹介料");
    // 成果報酬リンクであることの機械可読な表明＋新規タブから元画面を触らせない
    expect(html).toContain('rel="noopener noreferrer sponsored"');
  });

  it("タップ領域は52px以上（リンク）／44px以上（コピー）を確保している", () => {
    process.env.NEXT_PUBLIC_AFF_OISIX = "https://px.a8.net/svt/ejp?a8mat=X";
    const html = render(3);
    expect(html).toContain("min-h-[52px]");
    expect(html).toContain("min-h-[44px]");
  });

  it("プレビューモードは公式サイトの素リンク＝広告ではないのでPR表記を出さない", () => {
    process.env.NEXT_PUBLIC_SHOPPABLE_PREVIEW = "1";
    const html = render(2);
    expect(html).toContain("https://sm.rakuten.co.jp/");
    expect(html).not.toContain(">PR<");
    expect(html).not.toContain("sponsored");
  });
});
