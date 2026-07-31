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

/**
 * 「〜て」で終わる連用形を終止形に戻す表。
 * 「調味料を入れて煮立ったら弱火で煮る」を割るとき、前半が「調味料を入れて」のままだと
 * チェックリストの1行として読み下せないので「調味料を入れる」にする。
 * 料理の動詞は数が限られているので、表で持てば誤変換しない。
 */
const TE_TO_PLAIN: [RegExp, string][] = [
  [/入れて$/, "入れる"],
  [/加えて$/, "加える"],
  [/混ぜて$/, "混ぜる"],
  [/和えて$/, "和える"],
  [/炒めて$/, "炒める"],
  [/焼いて$/, "焼く"],
  [/煮て$/, "煮る"],
  [/茹でて$/, "茹でる"],
  [/ゆでて$/, "ゆでる"],
  [/揚げて$/, "揚げる"],
  [/蒸して$/, "蒸す"],
  [/切って$/, "切る"],
  [/刻んで$/, "刻む"],
  [/洗って$/, "洗う"],
  [/剥いて$/, "剥く"],
  [/むいて$/, "むく"],
  [/振って$/, "振る"],
  [/ふって$/, "ふる"],
  [/並べて$/, "並べる"],
  [/敷いて$/, "敷く"],
  [/注いで$/, "注ぐ"],
  [/沸かして$/, "沸かす"],
  [/溶かして$/, "溶かす"],
  [/戻して$/, "戻す"],
  [/取り出して$/, "取り出す"],
  [/温めて$/, "温める"],
  [/冷まして$/, "冷ます"],
  [/絞って$/, "絞る"],
  [/つぶして$/, "つぶす"],
  [/まぶして$/, "まぶす"],
  [/絡めて$/, "絡める"],
  [/からめて$/, "からめる"],
  [/のせて$/, "のせる"],
  [/載せて$/, "載せる"],
  [/包んで$/, "包む"],
  [/こねて$/, "こねる"],
  [/漬けて$/, "漬ける"],
  [/熱して$/, "熱する"],
  // サ変（「加熱して」「味付けして」など）の総まくり。上の個別表で拾えなかったものだけ当たる。
  [/して$/, "する"],
];

/**
 * 読点で文をつなぐ連用中止形（「肉を入れ、…」の「入れ」）を終止形に戻す表。
 * て形の表と同じ動詞だけを対象にする（知らない動詞は割らない＝安全側）。
 */
const RENYO_TO_PLAIN: [RegExp, string][] = [
  [/入れ$/, "入れる"],
  [/加え$/, "加える"],
  [/混ぜ$/, "混ぜる"],
  [/和え$/, "和える"],
  [/炒め$/, "炒める"],
  [/焼き$/, "焼く"],
  [/煮$/, "煮る"],
  [/茹で$/, "茹でる"],
  [/ゆで$/, "ゆでる"],
  [/揚げ$/, "揚げる"],
  [/蒸し$/, "蒸す"],
  // ⚠️ 「切り」は入れてはいけない。「薄切り」「細切り」「千切り」「斜め切り」は
  //    連用中止形ではなく**切り方を指す名詞**なので、「薄切る」という日本語にならない語に化ける
  //    （実測で発生：「玉ねぎは繊維に沿って薄切り、…」→「玉ねぎは繊維に沿って薄切る。」）。
  //    取りこぼす分には害が無い（割らずに1つのまま残るだけ）ので、入れない方を選ぶ。
  [/刻み$/, "刻む"],
  [/並べ$/, "並べる"],
  [/のせ$/, "のせる"],
  [/載せ$/, "載せる"],
  [/絡め$/, "絡める"],
  [/からめ$/, "からめる"],
  [/まぶし$/, "まぶす"],
  [/温め$/, "温める"],
  [/熱し$/, "熱する"],
  // 「〜し」で終わる五段動詞。サ変の「〜し」と見分けがつかないので必ず表で持つ。
  [/溶かし$/, "溶かす"],
  [/沸かし$/, "沸かす"],
  [/戻し$/, "戻す"],
  [/冷まし$/, "冷ます"],
  [/つぶし$/, "つぶす"],
  [/取り出し$/, "取り出す"],
];

/**
 * 節の先頭部分を終止形に直す。て形・連用中止形の両方を試す。
 *
 * **直せなかったら null を返し、呼び出し側は割るのをやめる。**
 * ここを「直せなければそのまま返す」にしていたら、
 * 「フライパンにバターを溶かし、…」の「溶かし」が サ変の「〜し」と誤認されて
 * 「フライパンにバターを溶かし。」という日本語にならない行が出た。
 * 変換できた＝知っている動詞、のときだけ割るのが安全側。
 */
function toPlainForm(s: string): string | null {
  const body = s.replace(/[、。\s]+$/, "");
  for (const [re, rep] of [...TE_TO_PLAIN, ...RENYO_TO_PLAIN]) {
    if (re.test(body)) return body.replace(re, rep);
  }
  return null;
}

/**
 * 1文の中に複数の作業が入っているものを、作業の切れ目で割る。
 *
 * 料理中に一番困るのは「待ち」が他の作業と同居しているとき。
 *   例: 「調味料を入れて煮立ったら弱火で10分煮る。」
 *     → ①調味料を入れる ②煮立ったら弱火で10分煮る
 * 「〜たら」は状態の変化を待つ合図なので、その手前で必ず割る。
 */
function splitByClause(sentence: string): string[] {
  // 「…て」＋「…たら」の形。「たら」は次の作業側に残す（待ってから何をするかが1行になる）
  const m = sentence.match(/^(.+?て)(.+?(?:たら|だら).+)$/);
  if (m) {
    const head = toPlainForm(m[1]);
    // 割った結果どちらかが短すぎるなら、割らない方が読みやすい
    if (head && head.replace(/\s/g, "").length >= 5 && m[2].replace(/\s/g, "").length >= 5) {
      return [`${head}。`, ...splitByClause(m[2].trim())];
    }
  }
  // 読点つきの連用中止「〜て、」「〜し、」も作業の切れ目
  const c = sentence.match(/^(.+?)、(.+)$/);
  if (c && c[2].replace(/\s/g, "").length >= 6) {
    const head = toPlainForm(c[1]);
    // 「肉を入れ」のように短くても、動詞が表にあるなら1作業として成立する
    if (head && head.replace(/\s/g, "").length >= 4) {
      return [`${head}。`, ...splitByClause(c[2].trim())];
    }
  }
  return [sentence];
}

/** 1つの手順テキストを、作業単位の文に割る */
export function splitStepText(text: string): string[] {
  const normalized = (text ?? "").replace(BULLET, " ");
  const chunks = normalized
    .split(" ")
    .flatMap(splitBySentence)
    .map((c) => c.trim())
    .filter(Boolean);

  // 短すぎる断片（「弱火で。」など）は直前の作業にくっつける＝読み飛ばし防止。
  // これは文単位で先にやる。節の分割より後に回すと、意図して割った作業まで
  // 「短いから」という理由で再びくっついてしまう。
  const merged: string[] = [];
  for (const c of chunks) {
    const bare = c.replace(/[。！？\s]/g, "");
    if (merged.length > 0 && bare.length < 8) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}${c}`;
      continue;
    }
    merged.push(c);
  }

  // そのうえで、1文に複数の作業が入っているものを作業の切れ目で割る
  return merged.flatMap((s) => splitByClause(s)).map((c) => c.trim()).filter(Boolean);
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
