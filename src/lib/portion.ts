// 買い物・在庫の「現実的な数量」を扱う純ヘルパ。
//  - 買い物リストは "買える単位" に丸める（1/2個や半端は切り上げて 1個。半端な数字は店で買えないため）。
//  - 「作った」時はレシピで使う分だけ在庫から引き、残り（例：1個買って1/4使う→3/4）を在庫に残す。
import { parseNum, formatNum } from "./recipeScale";

// 個数で数える単位（切り上げて丸める対象）
const COUNTABLE = [
  "個","本","枚","片","玉","束","房","株","袋","パック","缶","箱","尾","匹","切れ","かけ","粒","つ","丁","パ",
];
// 重量・容量・さじ等（丸めず、範囲なら上限を採用）
const MEASURE = [
  "kg","mg","g","ml","mL","cc","L","l","カップ","合","杯","大さじ","小さじ","cm","mm","滴","振り","ふり",
];

const NUM = "\\d+(?:\\.\\d+)?(?:と\\d+/\\d+)?|\\d+/\\d+";
const UNIT_ALT = [...COUNTABLE, ...MEASURE]
  .sort((a, b) => b.length - a.length) // 長い単位を先に（kg を g より先に）
  .join("|");

interface Parsed {
  num: number;
  unit: string;
  ok: boolean;
}

/** 「1/2個」「160〜180g」「大さじ1」などを {num, unit} に分解。範囲は上限を採用。解釈不能は ok:false */
export function parseAmount(amount: string): Parsed {
  const s = (amount ?? "").trim();
  const range = s.match(new RegExp(`^(?:${NUM})\\s*[〜～~]\\s*(${NUM})\\s*(${UNIT_ALT})?$`));
  if (range) {
    return { num: parseNum(range[1]), unit: range[2] ?? "", ok: true };
  }
  const single = s.match(new RegExp(`^(${NUM})\\s*(${UNIT_ALT})?$`));
  if (single) {
    return { num: parseNum(single[1]), unit: single[2] ?? "", ok: true };
  }
  return { num: NaN, unit: "", ok: false };
}

/** 買い物リスト用に "買える量" へ丸める。個数単位は切り上げ（最低1）、重量等は範囲上限のみ採用、適量等はそのまま。 */
export function toBuyableAmount(amount: string): string {
  const p = parseAmount(amount);
  if (!p.ok || !isFinite(p.num)) return amount; // 「適量」「お好みで」等はそのまま
  if (COUNTABLE.includes(p.unit)) {
    const whole = Math.max(1, Math.ceil(p.num - 1e-9));
    return `${whole}${p.unit}`;
  }
  // 重量・容量・単位なしは数値はそのまま（範囲は上限に整理済み）
  return `${formatNum(p.num)}${p.unit}`;
}

/** 在庫 have からレシピ使用量 use を引いた残量を返す。同単位のときだけ計算。使い切り(0以下)は ""（＝削除目印）。 */
export function subtractAmount(have: string, use: string): string {
  const h = parseAmount(have);
  const u = parseAmount(use);
  if (!h.ok || !isFinite(h.num)) return have; // 在庫量が読めない→触らない
  if (!u.ok || !isFinite(u.num)) return have; // 使用量が「適量」等→引けないので在庫維持
  if ((h.unit || "") !== (u.unit || "")) return have; // 単位が違う→安全側で在庫維持
  const rem = h.num - u.num;
  if (rem <= 1e-6) return ""; // 使い切り
  return `${formatNum(rem)}${h.unit}`;
}
