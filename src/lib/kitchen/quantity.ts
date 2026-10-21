/** Exact, JSON-safe quantities. No ingredient-specific weights are inferred. */
export interface Fraction { n: string; d: string }
export interface Quantity { value: Fraction; unit: string }
const Z = BigInt(0), O = BigInt(1);
function gcd(a: bigint, b: bigint): bigint { while (b !== Z) [a, b] = [b, a % b]; return a < Z ? -a : a; }
export function fraction(n: bigint | number | string, d: bigint | number | string = 1): Fraction {
  let a = BigInt(n), b = BigInt(d);
  if (b === Z) throw new Error("数量の分母は0にできません");
  if (b < Z) { a = -a; b = -b; }
  const g = gcd(a, b); return { n: String(a / g), d: String(b / g) };
}
export const zero = (): Fraction => fraction(0);
export const add = (a: Fraction, b: Fraction) => fraction(BigInt(a.n) * BigInt(b.d) + BigInt(b.n) * BigInt(a.d), BigInt(a.d) * BigInt(b.d));
export const neg = (a: Fraction) => fraction(-BigInt(a.n), a.d);
export const sub = (a: Fraction, b: Fraction) => add(a, neg(b));
export const mul = (a: Fraction, b: Fraction) => fraction(BigInt(a.n) * BigInt(b.n), BigInt(a.d) * BigInt(b.d));
export const div = (a: Fraction, b: Fraction) => mul(a, fraction(b.d, b.n));
export const compare = (a: Fraction, b: Fraction): number => { const n = sub(a, b); return BigInt(n.n) < Z ? -1 : BigInt(n.n) > Z ? 1 : 0; };
export const min = (a: Fraction, b: Fraction) => compare(a, b) <= 0 ? a : b;
export const positive = (a: Fraction) => compare(a, zero()) > 0;
export const ceil = (a: Fraction): Fraction => { if (BigInt(a.n) < Z) throw new Error("負の購入量です"); return fraction((BigInt(a.n) + BigInt(a.d) - O) / BigInt(a.d)); };
export const format = (a: Fraction): string => a.d === "1" ? a.n : `${a.n}/${a.d}`;
const conversions: Record<string, [string, number]> = { kg: ["g", 1000], mg: ["g", 1], g: ["g", 1], L: ["ml", 1000], l: ["ml", 1000], mL: ["ml", 1], ml: ["ml", 1], cc: ["ml", 1] };
const unitPattern = "kg|mg|g|ml|mL|cc|L|l|個|本|枚|片|玉|束|房|株|袋|パック|缶|箱|尾|匹|切れ|粒|つ|丁|食|人前|皿|杯|大さじ|小さじ";
/** Unknown/ranges/approximation stay unknown; original text is retained by the caller. */
export function parseQuantity(input: string): Quantity | null {
  if (typeof input !== "string" || input.length > 100) return null;
  // Only non-quantitative storage/state notes may be separated from the exact amount.
  // Never discard arbitrary parentheses: they can change the quantity (e.g. 半分だけ).
  const state = "(?:冷蔵|冷凍|常温|解凍済み|調理済み|作り置き|開封済み|未開封)";
  const text = input.normalize("NFKC").trim().replace(/\s+/g, "")
    .replace(new RegExp(`\\(${state}(?:の${state})*(?:を使用)?\\)$`), "")
    .replace(/食分$/, "食")
    .replace(new RegExp(`^(大さじ|小さじ)(.+)$`), "$2$1");
  const match = text.match(new RegExp(`^(\\d+(?:\\.\\d{1,9})?(?:/\\d+)?)(?:(${unitPattern}))$`));
  if (!match || match[1].length > 30) return null;
  let value: Fraction;
  if (match[1].includes("/")) { const [n, d] = match[1].split("/"); if (n.includes(".") || BigInt(d) === Z) return null; value = fraction(n, d); }
  else if (match[1].includes(".")) { const [whole, dec] = match[1].split("."); value = fraction(whole + dec, BigInt(10) ** BigInt(dec.length)); }
  else value = fraction(match[1]);
  return { value, unit: match[2] };
}
export function convert(q: Quantity, unit: string): Quantity | null {
  if (q.unit === unit) return q;
  const from = conversions[q.unit], to = conversions[unit];
  if (!from || !to || from[0] !== to[0]) return null;
  const factor = (u: string, n: number) => u === "mg" ? fraction(1, 1000) : fraction(n);
  return { value: mul(q.value, div(factor(q.unit, from[1]), factor(unit, to[1]))), unit };
}
export const showQuantity = (q: Quantity | null) => q ? `${format(q.value)}${q.unit}` : "量不明";
/** Only a measured/explicitly estimated relation for this lot can produce a weight. */
export function evidencedWeight(use: Quantity, evidence?: { quantity: Quantity; grams: Quantity; estimated: boolean; basis: string }): string | null {
  if (!evidence?.basis || !positive(evidence.quantity.value)) return null;
  const amount = convert(use, evidence.quantity.unit), grams = convert(evidence.grams, "g");
  if (!amount || !grams) return null;
  return `${evidence.estimated ? "約" : ""}${showQuantity({ unit: "g", value: mul(grams.value, div(amount.value, evidence.quantity.value)) })}（${evidence.basis}）`;
}
export function remainingLabel(name: string, have: Quantity | null, use: Quantity | null): { primary: string; secondary: string } {
  if (!have || !use) return { primary: `${name}の量を確認`, secondary: "分量を確定すると使用量を表示します" };
  const amount = convert(use, have.unit);
  if (!amount) return { primary: `${name}の単位を確認`, secondary: showQuantity(use) };
  if (!positive(have.value)) return { primary: `${name}の在庫なし`, secondary: showQuantity(use) };
  if (compare(amount.value, have.value) > 0) return { primary: `${name}が不足しています`, secondary: showQuantity(use) };
  const ratio = div(amount.value, have.value);
  const words = format(ratio) === "1/2" ? "半分" : format(ratio) === "1" ? "全部" : format(ratio);
  return { primary: `残っている${name}の${words}を使う`, secondary: `${name}${showQuantity(use)}分` };
}
