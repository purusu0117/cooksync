import { describe, it, expect } from "vitest";
import { splitStepText, toCookTasks, currentTaskKey } from "../cookSteps";
import type { RecipeStep } from "../recipe";

describe("splitStepText（1タブ＝1作業に割る）", () => {
  it("句点ごとに1作業へ分ける", () => {
    const parts = splitStepText(
      "玉ねぎ1/2個は薄切りにする。にんにく2かけはみじん切りにする。鶏もも肉は一口大に切る。",
    );
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain("玉ねぎ");
    expect(parts[2]).toContain("鶏もも肉");
  });
  it("短すぎる断片は直前の作業にくっつける", () => {
    const parts = splitStepText("フライパンに油をひいて中火で熱する。弱火に。");
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("弱火に");
  });
  it("箇条書き記号も区切りとして扱う", () => {
    const parts = splitStepText("①鍋に水を入れて沸かす ②塩を小さじ1加える");
    expect(parts).toHaveLength(2);
  });
  it("空文字は空配列", () => {
    expect(splitStepText("")).toEqual([]);
  });
});

const STEPS: RecipeStep[] = [
  {
    title: "1. 下準備",
    text: "玉ねぎ1個は薄切りにする。にんじん1本は乱切りにする。",
    tip: "先に全部切っておくと楽",
  },
  { title: "2. 炒める", text: "フライパンで玉ねぎをあめ色になるまで炒める。" },
];

describe("toCookTasks", () => {
  it("ステップをまたいで作業リストになる", () => {
    const tasks = toCookTasks(STEPS);
    expect(tasks).toHaveLength(3);
    expect(tasks[0].key).toBe("0-0");
    expect(tasks[0].group).toBe("1. 下準備");
    expect(tasks[2].groupIndex).toBe(1);
  });
  it("コツはそのステップの最後の作業だけに付く", () => {
    const tasks = toCookTasks(STEPS);
    expect(tasks[0].tip).toBeUndefined();
    expect(tasks[1].tip).toBe("先に全部切っておくと楽");
  });
});

describe("currentTaskKey（作業中の場所）", () => {
  it("未チェックの先頭を返す", () => {
    const tasks = toCookTasks(STEPS);
    expect(currentTaskKey(tasks, {})).toBe("0-0");
    expect(currentTaskKey(tasks, { "0-0": true })).toBe("0-1");
  });
  it("全部終わっていれば null", () => {
    const tasks = toCookTasks(STEPS);
    const all = Object.fromEntries(tasks.map((t) => [t.key, true]));
    expect(currentTaskKey(tasks, all)).toBeNull();
  });
});

describe("1文に複数の作業が入っているものを割る", () => {
  it("「〜て」＋「〜たら」は、待ちの手前で割れる（大翔の指摘そのもの）", () => {
    expect(splitStepText("調味料を入れて煮立ったら弱火で10分煮る。")).toEqual([
      "調味料を入れる。",
      "煮立ったら弱火で10分煮る。",
    ]);
  });

  it("て形は終止形に直してから割る（「入れて」のまま残さない）", () => {
    expect(splitStepText("水を加えて沸騰したらアクを取る。")).toEqual([
      "水を加える。",
      "沸騰したらアクを取る。",
    ]);
  });

  it("読点つきの連用中止も割る", () => {
    expect(splitStepText("玉ねぎを薄切りにして、フライパンで炒める。")).toEqual([
      "玉ねぎを薄切りにする。",
      "フライパンで炒める。",
    ]);
  });

  it("3つの作業が入っていれば3つに割れる", () => {
    expect(splitStepText("油を熱して肉を入れ、色が変わったら野菜を加える。")).toEqual([
      "油を熱する。",
      "肉を入れる。",
      "色が変わったら野菜を加える。",
    ]);
  });

  it("1作業しかない文は割らない", () => {
    expect(splitStepText("鶏肉に塩をふって10分おく。")).toEqual(["鶏肉に塩をふって10分おく。"]);
    expect(splitStepText("弱火にする。")).toEqual(["弱火にする。"]);
  });
});

describe("知らない動詞では割らない（安全側）", () => {
  it("「〜し」で終わる五段動詞をサ変と誤認しない", () => {
    // 表に無いまま割ると「フライパンにバターを溶かし。」という日本語にならない行が出ていた
    expect(
      splitStepText("フライパンにバター10gを溶かし、ウインナーを中火で炒める。"),
    ).toEqual(["フライパンにバター10gを溶かす。", "ウインナーを中火で炒める。"]);
  });

  it("表に無い動詞なら、割らずに1つのまま残す", () => {
    expect(splitStepText("具を端に寄せ、空いた所にケチャップを入れる。")).toEqual([
      "具を端に寄せ、空いた所にケチャップを入れる。",
    ]);
  });
});

describe("切り方の名詞を動詞に化けさせない", () => {
  it("「薄切り」「細切り」は連用中止形ではないので割らない", () => {
    // 「薄切る」「細切る」という日本語にならない語が出ていた（2026-07-31・実機のスクショで発覚）
    const out = splitStepText(
      "玉ねぎ1/4個は繊維に沿って薄切り、ピーマン1個は細切り、ウインナー3本は斜め切りにする。",
    );
    expect(out.join("")).not.toContain("薄切る");
    expect(out.join("")).not.toContain("細切る");
    expect(out).toEqual([
      "玉ねぎ1/4個は繊維に沿って薄切り、ピーマン1個は細切り、ウインナー3本は斜め切りにする。",
    ]);
  });
});
