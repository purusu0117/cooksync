// レシピの手順（1ステップに長文が入っている）を「1作業＝1行」に割り、
// 調理中にチェックしながら進められる形にする。
//
// 例: 「玉ねぎ1/2個は薄切りにする。にんにく2かけはみじん切りにする。鶏肉は一口大に切る。」
//   → ①玉ねぎ1/2個は薄切りにする ②にんにく2かけはみじん切りにする ③鶏肉は一口大に切る

import type { RecipeStep } from "./recipe";

export interface CookTask {
  /** 安定したキー（ステップ番号-作業番号）。チェック状態の保存に使う */
  key: string;
  /** 元のステップ見出し（「1. 下準備」など） */
  group: string;
  groupIndex: number;
  /** 1つの作業 */
  text: string;
  /** そのステップのコツ（グループの最後の作業に付ける） */
  tip?: string;
}

// 箇条書き記号・番号を区切りに寄せる（①②/1)/・/- など）
const BULLET = /[\n\r]+|[①②③④⑤⑥⑦⑧⑨⑩]|(?:^|\s)[0-9]+[).、]\s*|(?:^|\s)[・･]\s*/g;

/** 句点で切る（後読み正規表現は古いiOS Safariで動かないので手で回す） */
function splitBySentence(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of s) {
    buf += ch;
    if (ch === "。" || ch === "！" || ch === "？") {
      out.push(buf);
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** 1つの手順テキストを、作業単位の文に割る */
export function splitStepText(text: string): string[] {
  const normalized = (text ?? "").replace(BULLET, " ");
  const chunks = normalized
    .split(" ")
    .flatMap(splitBySentence)
    .map((c) => c.trim())
    .filter(Boolean);

  // 短すぎる断片（「弱火で。」など）は直前の作業にくっつける＝読み飛ばし防止
  const out: string[] = [];
  for (const c of chunks) {
    const bare = c.replace(/[。！？\s]/g, "");
    if (out.length > 0 && bare.length < 8) {
      out[out.length - 1] = `${out[out.length - 1]}${c}`;
      continue;
    }
    out.push(c);
  }
  return out;
}

/** レシピの全ステップを、チェック可能な作業リストに変換する */
export function toCookTasks(steps: RecipeStep[]): CookTask[] {
  const tasks: CookTask[] = [];
  steps.forEach((step, gi) => {
    const parts = splitStepText(step.text);
    const list = parts.length > 0 ? parts : [step.title];
    list.forEach((text, ti) => {
      tasks.push({
        key: `${gi}-${ti}`,
        group: step.title,
        groupIndex: gi,
        text,
        // コツはそのステップの最後の作業に添える（作業ごとに繰り返さない）
        tip: ti === list.length - 1 ? step.tip : undefined,
      });
    });
  });
  return tasks;
}

/** 未チェックの先頭＝「いま作業中の場所」。全部終わっていれば null */
export function currentTaskKey(
  tasks: CookTask[],
  checked: Record<string, boolean>,
): string | null {
  const next = tasks.find((t) => !checked[t.key]);
  return next ? next.key : null;
}
