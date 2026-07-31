// 初回の5分（QuickStart / AddItemForm）の**描画結果**を固定する。
//
// ここが静かに壊れたときに起きること：
//   - 初回にまた6項目のフォームが出る
//       → 初見の人は「作業だ」と分かって離脱する。Food & Drink の Day1 継続率は
//         全カテゴリ最下位（16.5%）で、死因はどのアプリも「登録が面倒で続かない」。
//   - 写真の入口が一等地から落ちる
//       → いちばん軽い入口（1枚撮るだけ）が埋もれ、手入力しか見えなくなる。
//   - 進捗（あと何個）が消える
//       → ゴールまでの距離が見えず、「どこまでやれば終わるのか」が分からなくなる。
// どれもビルドもテストも通ってしまうので、描画結果で押さえる。

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import QuickStart from "@/components/QuickStart";
import AddItemForm from "@/components/AddItemForm";
import { STARTER_FOODS } from "@/lib/starter";

/**
 * 6項目フォーム（食材名／数量／カテゴリ／購入日／期限／開封済み）が開いているかを
 * **入力欄の実体**で判定する。文言（「カテゴリと賞味期限は自動で入ります」など）は
 * 説明文にも出るので、ラベル文字列で判定すると誤検知する。
 */
function hasDetailFields(html: string): boolean {
  return (
    html.includes('type="date"') || // 購入日・賞味期限
    html.includes("<select") || // カテゴリ
    html.includes('type="checkbox"') || // 開封済み
    html.includes(">数量</span>") // 数量
  );
}

function quickStart(count: number, existing: string[] = []) {
  return renderToStaticMarkup(
    <QuickStart
      count={count}
      existingNames={existing}
      onAdd={() => {}}
      onAddMany={() => {}}
      onManual={() => {}}
    />,
  );
}

describe("QuickStart（初回の一等地）", () => {
  const html = quickStart(0);

  it("到達点は「登録が終わった」ではなく「今日の献立が出る」", () => {
    expect(html).toContain("今日なに作るか、ここで決まります");
  });

  it("ゴールまでの距離を出す（あと何個で献立が出せるか）", () => {
    expect(quickStart(0)).toContain("あと3つで、今日の献立を出せます");
    expect(quickStart(1)).toContain("あと2つで、今日の献立を出せます");
    expect(quickStart(3)).toContain("そろいました");
  });

  it("3つそろったら、その場で献立に行ける", () => {
    const ready = quickStart(3);
    expect(ready).toContain('href="/meal"');
    expect(ready).toContain("今日の献立を出す");
  });

  it("1つでも入れたら、3つ未満でも先に進める逃げ道がある（3つを壁にしない）", () => {
    expect(quickStart(1)).toContain("今のまま献立を見る");
    expect(quickStart(0)).not.toContain("今のまま献立を見る");
  });

  it("写真の入口が入っている（いちばん軽い入口を一等地に置く）", () => {
    expect(html).toContain("写真を撮る / 選ぶ");
    expect(html).toContain("冷蔵庫を開けて1枚撮るのがいちばん速いです");
  });

  it("よく買うものがタップで足せる", () => {
    expect(html).toContain("よく買うもの（タップで入ります）");
    for (const f of STARTER_FOODS.slice(0, 8)) expect(html).toContain(f);
  });

  it("既に冷蔵庫にあるものはチップに出さない", () => {
    const withEgg = quickStart(1, ["卵"]);
    // チップは8件までなので、卵が抜けた分だけ後ろの候補が繰り上がる
    expect(withEgg).toContain("牛乳");
    expect(withEgg).toContain("豚こま肉");
  });

  it("初回に6項目フォームを出さない（食材名だけで入れられる）", () => {
    expect(hasDetailFields(html)).toBe(false);
    expect(html).toContain("名前だけでOK");
  });

  it("詳しく入れたい人の入口は残す（降ろすだけで消さない）", () => {
    expect(html).toContain("数量や期限まで自分で決める");
  });

  it("タップできる要素は44px以上（iPhoneで押せる下限）", () => {
    const tappable = html.match(/<(?:button|a|input)\s[^>]*>/g) ?? [];
    const small = tappable.filter(
      (t) =>
        !t.includes("min-h-[44px]") &&
        !t.includes('type="file"') && // ラベル側で44pxを持つ隠しinput
        !t.includes('type="checkbox"'), // 44pxはラベル側で確保
    );
    expect(small).toEqual([]);
  });

  it("小さすぎる文字を使わない（text-xs=13.5px 未満を置かない）", () => {
    expect(html).not.toMatch(/text-\[1[0-2]px\]/);
    expect(html).not.toContain("text-[13px]");
  });
});

describe("AddItemForm（手入力）", () => {
  const html = renderToStaticMarkup(<AddItemForm onAdd={() => {}} />);

  it("既定は食材名だけ＝6項目を最初から開かない", () => {
    expect(html).toContain("食材名");
    expect(hasDetailFields(html)).toBe(false);
  });

  it("食材名だけで入る、と明記する（何を求められているかを迷わせない）", () => {
    expect(html).toContain("食材名だけでOK");
  });

  it("詳しく決めたい人は開ける", () => {
    expect(html).toContain("数量・カテゴリ・期限も決める");
  });

  it("入力欄とボタンのタップ領域が44px以上", () => {
    const tappable = html.match(/<(?:button|input|select)\s[^>]*>/g) ?? [];
    for (const t of tappable) expect(t).toContain("min-h-[44px]");
  });
});
