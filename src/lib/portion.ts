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

// 調理時の計量単位＝店で量り買いできない（小さじ/大さじ/カップ/cm 等）→「1本」で買う
const COOKING_MEASURE = [
  "大さじ",
  "小さじ",
  "カップ",
  "杯",
  "滴",
  "振り",
  "ふり",
  "つまみ",
  "cm",
  "mm",
];

/** 買い物リスト用に "買える量" へ丸める。個数=切り上げ、調味料の計量単位=「1本」、重量等=そのまま、適量等=そのまま。 */
export function toBuyableAmount(amount: string): string {
  const a = (amount ?? "").trim();
  // 「大さじ2」「小さじ1/2」「カップ1」「5cm」など計量単位は店で量り買い不可 → 1本で買う。
  // ※「大さじ2」は“単位→数字”でparseAmountが解釈できないため、文字列含有でも判定する。
  if (COOKING_MEASURE.some((u) => a.includes(u))) return "1本";
  const p = parseAmount(a);
  if (!p.ok || !isFinite(p.num)) return amount; // 「適量」「お好みで」等はそのまま
  if (COUNTABLE.includes(p.unit)) {
    const whole = Math.max(1, Math.ceil(p.num - 1e-9));
    return `${whole}${p.unit}`;
  }
  // 重量・容量（g/ml/kg）・単位なしは数値そのまま（範囲は上限に整理済み）
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
