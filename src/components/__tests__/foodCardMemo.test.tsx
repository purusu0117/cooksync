// FoodCard を React.memo 化した（2026-08-01）ことの回帰テスト。
//
// 冷蔵庫は100件並ぶ画面で、1枚触るだけで100枚とも作り直していた。
//
// ★設計上の約束（これが崩れると memo は静かに無効化される）
//   ① FoodCard には**独自の比較関数を付けない**。React 既定の浅い比較に任せる。
//      一度は「item だけ見てハンドラは無視する」比較関数を書いたが、それは
//      「ハンドラが setState の updater しか呼んでいない」という呼び出し側の内部事情に
//      依存していて、ハンドラが props/state を参照した瞬間に古い値を掴む時限爆弾だった。
//   ② 代わりに**渡す側（FridgeApp）でハンドラの同一性を固定する**。
//      ①だけ守って②を忘れると「memo を書いたのに1回も効かない」状態になり、
//      しかも画面は正しく動くので気づけない。だから②もここで固定する。
//   ③ 表示は memo 化前と変わらない。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
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

// React.memo が返すオブジェクトの中身（型定義には出ないので取り出す）
const memoized = FoodCard as unknown as {
  $$typeof?: symbol;
  compare?: unknown;
};

describe("FoodCard の memo", () => {
  it("memo で包まれている", () => {
    expect(memoized.$$typeof).toBe(Symbol.for("react.memo"));
  });

  it("独自の比較関数を持たない（＝既定の浅い比較に任せている）", () => {
    // ここが non-null になったら、上のコメントの経緯を読んでから足すこと。
    expect(memoized.compare == null).toBe(true);
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

describe("FridgeApp 側でハンドラの同一性が固定されている", () => {
  // ソースを読んで確かめる。フックの同一性はレンダーを回さないと観測できないが、
  // 「useCallback を外して普通の関数宣言に戻す」という**実際に起きた退行**は
  // これで確実に捕まえられる。
  const src = readFileSync(
    path.join(process.cwd(), "src/components/FridgeApp.tsx"),
    "utf8",
  );

  for (const name of ["addItem", "deleteItem", "updateItem", "addMany", "updateMany"]) {
    it(`${name} は useCallback で包まれている`, () => {
      expect(src).toMatch(new RegExp(`const ${name} = useCallback\\(`));
      // 「function addItem(...)」に戻していないこと
      expect(src).not.toMatch(new RegExp(`function ${name}\\s*\\(`));
    });
  }

  it("FoodCard に渡す4つのハンドラはすべて固定されたものだけ（インラインの arrow を渡さない）", () => {
    const usage = src.slice(src.indexOf("<FoodCard"), src.indexOf("</ul>", src.indexOf("<FoodCard")));
    expect(usage).toContain("onDelete={deleteItem}");
    expect(usage).toContain("onUpdate={updateItem}");
    expect(usage).toContain("onEdit={setEditing}"); // useState のセッター＝元から固定
    expect(usage).not.toContain("=>"); // インラインの arrow が1つでもあれば memo は毎回はずれる
  });
});
