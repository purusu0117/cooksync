// FoodCard を React.memo 化した（2026-08-01）ことの回帰テスト。
//
// 冷蔵庫は100件並ぶ画面で、1枚触るだけで100枚とも作り直していた。
// memo の比較関数は **item だけ** を見てハンドラの同一性を無視する形にしてあるので、
//  ① 中身が同じなら再描画をスキップする（＝比較関数が true を返す）
//  ② item が差し替わったら必ず再描画する（＝false を返す）
//  ③ 表示は memo 化前と変わらない
// を固定しておく。①が壊れると 100枚の再描画が戻り、②が壊れると **画面が更新されなくなる**。

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FoodCard from "@/components/FoodCard";
import { todayISO, estimateExpiry, type FridgeItem } from "@/lib/food";

const item: FridgeItem = {
  id: "f1",
  name: "玉ねぎ",
  quantity: "2個",
  category: "野菜",
  purchasedOn: todayISO(),
  expiresOn: estimateExpiry(todayISO(), 4),
  createdAt: 0,
  zone: "野菜",
};

const noop = () => {};
const props = { item, onDelete: noop, onUpdate: noop, onEdit: noop };

// React.memo が返すオブジェクトは compare を持つ（型定義には出ないので取り出す）
const compare = (FoodCard as unknown as {
  compare: (a: typeof props, b: typeof props) => boolean;
}).compare;

describe("FoodCard の memo", () => {
  it("item が同じなら、ハンドラが毎回新しい関数でも再描画しない", () => {
    expect(
      compare(props, {
        item,
        onDelete: () => {},
        onUpdate: () => {},
        onEdit: () => {},
      }),
    ).toBe(true);
  });

  it("item が差し替わったら必ず再描画する", () => {
    expect(compare(props, { ...props, item: { ...item, quantity: "1個" } })).toBe(false);
    expect(compare(props, { ...props, item: { ...item } })).toBe(false); // 同じ中身でも別オブジェクトなら描き直す
  });

  it("表示内容は memo 化前と同じ（食材名・数量・操作ボタンが出る）", () => {
    const html = renderToStaticMarkup(<FoodCard {...props} />);
    expect(html).toContain("玉ねぎ");
    expect(html).toContain("2個");
    expect(html).toContain("半分使った");
    expect(html).toContain("切った");
    expect(html).toContain("使い切った");
    expect(html).toContain("編集");
    expect(html).toContain(item.expiresOn);
  });

  it("期限の残り日数の出方が変わっていない（今日/期限切れ）", () => {
    const expired = { ...item, id: "f2", expiresOn: estimateExpiry(todayISO(), -3) };
    expect(renderToStaticMarkup(<FoodCard {...props} item={expired} />)).toContain(
      "期限切れ3日",
    );
    const today = { ...item, id: "f3", expiresOn: todayISO() };
    expect(renderToStaticMarkup(<FoodCard {...props} item={today} />)).toContain(
      "今日まで",
    );
  });
});
