// 空の画面を「行き止まり」にしないための番人。
//
// 空状態は、初見の人がいちばん長く見る画面でもある。
// 「まだ食材がありません」で終わっている画面は、そこで閉じられる。
// EMPTY_STATES に新しい空状態を足したときに **次の1手を書き忘れる** のが一番あり得るので、
// 全項目を走査して機械的に落とす。

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EmptyState, { EMPTY_STATES } from "@/components/EmptyState";

const entries = Object.entries(EMPTY_STATES);

describe("EMPTY_STATES（空状態の中身）", () => {
  it("空状態が1つ以上定義されている（この検査が空振りしていないことの確認）", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s：次の1手が必ず1つ以上ある", (_key, content) => {
    expect(content.actions.length).toBeGreaterThan(0);
    for (const a of content.actions) {
      expect(a.label.trim()).not.toBe("");
      expect(a.href.trim()).not.toBe("");
    }
  });

  it.each(entries)("%s：主導線は1つだけ（どれを押せばいいか迷わせない）", (_key, content) => {
    expect(content.actions.filter((a) => a.primary)).toHaveLength(1);
  });

  it.each(entries)("%s：見出しと説明が空でない", (_key, content) => {
    expect(content.title.trim()).not.toBe("");
    expect(content.body.trim()).not.toBe("");
  });

  it.each(entries)(
    "%s：否定形の決まり文句で終わらせない（初見の人に伝わらないため）",
    (_key, content) => {
      // 「〜しません」「〜できません」は、その現象を知らない初見の人には空振りする。
      // Preferences/copywriting-audience.md の原則。
      expect(content.body).not.toMatch(/しません|できません/);
    },
  );
});

describe("EmptyState（描画）", () => {
  it.each(entries)("%s：見出し・説明・次の1手が全部描かれる", (_key, content) => {
    const html = renderToStaticMarkup(<EmptyState content={content} />);
    expect(html).toContain(content.title);
    expect(html).toContain(content.body);
    for (const a of content.actions) {
      expect(html).toContain(a.label);
      expect(html).toContain(`href="${a.href}"`);
    }
  });

  it.each(entries)(
    "%s：ボタンのタップ領域が44px以上（iPhoneで押せる下限）",
    (_key, content) => {
      const html = renderToStaticMarkup(<EmptyState content={content} />);
      const links = html.match(/<a [^>]*>/g) ?? [];
      expect(links.length).toBe(content.actions.length);
      for (const l of links) expect(l).toContain("min-h-[44px]");
    },
  );

  it("買い物リストが空のときは『献立を決める』に送る（空のリストに送り返さない）", () => {
    // ここが /shopping に戻っていると、空の画面から空の画面に移るだけになる。
    expect(EMPTY_STATES.shopping.actions[0].href).toBe("/meal");
    expect(EMPTY_STATES.homeShopping.actions[0].href).toBe("/meal");
  });

  it("在庫ゼロで献立に来ても行き止まりにしない（買い物前提で進めると書く）", () => {
    expect(EMPTY_STATES.meal.body).toContain("買い物");
  });
});
