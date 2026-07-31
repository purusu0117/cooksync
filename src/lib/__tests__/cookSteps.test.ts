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
