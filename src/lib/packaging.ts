// 「店で売っている単位」の辞書。
// レシピの使用量（ミニトマト5個・にんにく2かけ・小ねぎ少々）をそのまま買い物リストに載せても
// 店では買えないので、実際の販売単位（1パック・1玉・1束）に変換するために使う。
// 在庫登録でも「1パック＝約何個か分からない」問題の受け皿になる（数量チップ／単位換算）。
//
// 数値の出典（2026-07 リサーチ）:
//  - ミニトマト1パック＝100〜200g・12〜20個前後（楽天/生活知恵袋）
//  - 卵は6個入りと10個入りが主流（一人暮らしは6個が基本）
//  - 固形コンソメ1個＝約5g＝顆粒小さじ2弱（cojicaji/デリッシュキッチン）
//  - 長ねぎは1本売り／1束＝2本（東急ストアネットスーパー）

import { normalizeName } from "./recipe";
import { parseAmount, toBuyableAmount } from "./portion";

export interface PackSpec {
  /** 売っている単位の助数詞（パック/袋/束/本/個/玉/箱/丁/斤） */
  unit: string;
  /** 1単位に入っている個数（分かるものだけ） */
  perPack?: number;
  /** perPack の助数詞（個/本/枚/かけ/玉） */
  countUnit?: string;
  /** 1単位のおおよその重さ(g) */
  grams?: number;
  /** 買い物リストに添える補足（「約15個入り」など） */
  hint?: string;
}

// 上から部分一致（正規化後）。より具体的な食材を先に置く。
const PACKS: [string[], PackSpec][] = [
  // --- 個数が数えづらい代表格 ---
  [["ミニトマト", "プチトマト"], { unit: "パック", perPack: 15, countUnit: "個", grams: 200, hint: "1パック約15個・200g" }],
  [["卵"], { unit: "パック", perPack: 6, countUnit: "個", hint: "6個入り（10個入りもあり）" }],
  [["固形コンソメ", "コンソメキューブ"], { unit: "箱", perPack: 8, countUnit: "個", hint: "1箱約8個・1個=顆粒小さじ2弱(約5g)" }],
  [["大葉", "青じそ"], { unit: "パック", perPack: 10, countUnit: "枚", hint: "1パック約10枚" }],
  [["にんにく"], { unit: "玉", perPack: 6, countUnit: "かけ", hint: "1玉＝約6かけ" }],
  [["しょうが"], { unit: "個", grams: 80, hint: "1かけ＝約15g" }],

  // --- パック・袋で売られるもの ---
  [["しめじ", "えのき", "まいたけ", "エリンギ", "しいたけ", "マッシュルーム"], { unit: "パック", grams: 100, hint: "1パック約100g" }],
  [["納豆"], { unit: "パック", perPack: 3, countUnit: "個", hint: "3個入り" }],
  [["豆腐"], { unit: "丁", grams: 300, hint: "1丁約300g" }],
  [["油揚げ"], { unit: "袋", perPack: 3, countUnit: "枚", hint: "1袋約3枚" }],
  [["もやし"], { unit: "袋", grams: 200, hint: "1袋約200g" }],
  [["豆苗"], { unit: "パック" }],
  [["ベーコン"], { unit: "パック", grams: 80, hint: "1パック約80g" }],
  [["ウインナー", "ソーセージ"], { unit: "袋", grams: 120, hint: "1袋約120g" }],
  [["ピザ用チーズ", "とろけるチーズ"], { unit: "袋", grams: 200, hint: "1袋約200g" }],
  [["スライスチーズ"], { unit: "袋", perPack: 7, countUnit: "枚", hint: "1袋約7枚" }],
  [["ライスペーパー"], { unit: "袋", perPack: 20, countUnit: "枚", hint: "1袋約20枚" }],
  [["春巻きの皮"], { unit: "袋", perPack: 10, countUnit: "枚", hint: "1袋約10枚" }],
  [["餃子の皮"], { unit: "袋", perPack: 25, countUnit: "枚", hint: "1袋約25枚" }],
  [["食パン"], { unit: "斤", perPack: 6, countUnit: "枚", hint: "1斤＝6枚切り等" }],
  [["うどん", "そば", "焼きそば", "中華麺", "ラーメン"], { unit: "袋", perPack: 3, countUnit: "玉", hint: "1袋約3玉" }],
  [["パスタ", "スパゲ"], { unit: "袋", grams: 500, hint: "1袋約500g" }],

  // --- 束で売られる葉物・薬味 ---
  [["小ねぎ", "万能ねぎ", "青ねぎ", "わけぎ"], { unit: "束", grams: 100, hint: "1束約100g" }],
  [["ほうれん草", "小松菜", "水菜", "春菊", "チンゲン菜", "ニラ"], { unit: "束", grams: 200, hint: "1束約200g" }],
  [["長ねぎ", "白ねぎ"], { unit: "本", hint: "1本（1束＝2本のことも）" }],

  // --- 1個/1本から買えるもの（半端な分量を切り上げる用） ---
  [["キャベツ"], { unit: "個", grams: 1200, hint: "1玉（1/2・1/4カットも）" }],
  [["白菜"], { unit: "個", grams: 2000, hint: "1玉（1/4カットが買いやすい）" }],
  [["レタス"], { unit: "個", grams: 400 }],
  [["ブロッコリー"], { unit: "個", grams: 300 }],
  [["大根"], { unit: "本", grams: 1000, hint: "1本（1/2カットも）" }],
  [["にんじん"], { unit: "本", grams: 150, hint: "1本（3本入り袋も）" }],
  [["じゃがいも", "玉ねぎ"], { unit: "個", grams: 200, hint: "1個（3〜5個入り袋も）" }],
  [["さつまいも", "かぼちゃ", "れんこん", "ごぼう", "長芋"], { unit: "個" }],
  [["きゅうり", "なす"], { unit: "本", grams: 100, hint: "1本（3本入り袋も）" }],
  [["ピーマン"], { unit: "袋", perPack: 4, countUnit: "個", hint: "1袋約4個" }],
  [["パプリカ", "アボカド", "レモン", "トマト"], { unit: "個" }],
  [["牛乳", "豆乳"], { unit: "本", hint: "1本＝1L" }],
];

const NORMALIZED: [string[], PackSpec][] = PACKS.map(([kws, spec]) => [
  kws.map((k) => normalizeName(k)),
  spec,
]);

// 加工品は生鮮と売り方が違う（にんにくチューブ＝1玉ではない／トマト缶＝1個ではない）。
// ベース名を含んでしまうので、この語を含むものは辞書を引かない。
const PROCESSED = ["チューブ", "パウダー", "缶", "ペースト", "乾燥", "冷凍", "ソース", "ドレッシング", "だし", "つゆ"];

/** 食材名から販売単位の情報を引く（無ければ null） */
export function packOf(name: string): PackSpec | null {
  const raw = (name ?? "").replace(/\s|　/g, "");
  if (PROCESSED.some((p) => raw.includes(p))) return null;
  const n = normalizeName(name);
  if (!n) return null;
  for (const [kws, spec] of NORMALIZED) {
    if (kws.some((k) => n.includes(k))) return spec;
  }
  return null;
}

// 店で量り買いできない調理用の計量単位（大さじ等）は既存ロジック側で「1本」に丸める
const COOKING_MEASURE = ["大さじ", "小さじ", "カップ", "杯", "滴", "振り", "ふり", "つまみ"];

export interface Buyable {
  amount: string; // 「1パック」「2本」
  hint?: string; // 「1パック約15個・200g」
}

/**
 * 買い物リスト用に「店で買える単位」へ変換する。
 * 例：ミニトマト5個→1パック / にんにく2かけ→1玉 / 小ねぎ少々→1束 / 長ねぎ1/2本→1本
 */
export function toBuyableFor(name: string, amount: string): Buyable {
  const spec = packOf(name);
  const raw = (amount ?? "").trim();
  if (!spec) return { amount: toBuyableAmount(raw) };
  // 「大さじ2」等は調味料の使い方＝販売単位に換算しない（既存の丸めに任せる）
  if (COOKING_MEASURE.some((u) => raw.includes(u))) {
    return { amount: toBuyableAmount(raw) };
  }

  const p = parseAmount(raw);
  const packs = (n: number) => `${Math.max(1, Math.ceil(n - 1e-9))}${spec.unit}`;

  // 「適量」「少々」「お好みで」など数値が読めない → 1単位買う
  if (!p.ok || !isFinite(p.num)) return { amount: `1${spec.unit}`, hint: spec.hint };

  const unit = p.unit.trim();
  // 既に販売単位で書かれている（1パック・2本）→ 切り上げるだけ
  if (unit === spec.unit) return { amount: packs(p.num), hint: spec.hint };
  // 中身の個数で書かれている（ミニトマト5個・にんにく2かけ）→ 何単位必要か
  if (spec.perPack && unit === spec.countUnit) {
    return { amount: packs(p.num / spec.perPack), hint: spec.hint };
  }
  // 重さで書かれている（ミニトマト100g）→ 何単位必要か
  if (spec.grams && (unit === "g" || unit === "ｇ")) {
    return { amount: packs(p.num / spec.grams), hint: spec.hint };
  }
  // 単位なしの数字（「2」）や想定外の単位 → 安全側で1単位
  return { amount: `1${spec.unit}`, hint: spec.hint };
}

/**
 * 在庫の数量を、レシピ側の単位に換算する（1パック→15個 など）。
 * 換算できないときは null（呼び出し側は「比較しない＝在庫あり扱い」にする）。
 */
export function convertAmount(
  name: string,
  amount: string,
  targetUnit: string,
): number | null {
  const p = parseAmount(amount);
  if (!p.ok || !isFinite(p.num)) return null;
  const from = p.unit.trim();
  const to = targetUnit.trim();
  if (from === to) return p.num;
  const spec = packOf(name);
  if (!spec) return null;
  if (spec.perPack && from === spec.unit && to === spec.countUnit) {
    return p.num * spec.perPack;
  }
  if (spec.perPack && from === spec.countUnit && to === spec.unit) {
    return p.num / spec.perPack;
  }
  if (spec.grams && from === spec.unit && (to === "g" || to === "ｇ")) {
    return p.num * spec.grams;
  }
  return null;
}

/** 在庫登録の数量チップ（食材名から「よく買う単位」を提案する） */
export function quantitySuggestions(name: string): string[] {
  const spec = packOf(name);
  if (!spec) return [];
  const out = [`1${spec.unit}`, `2${spec.unit}`];
  if (spec.perPack && spec.countUnit) out.push(`${spec.perPack}${spec.countUnit}`);
  if (spec.unit !== "個" && spec.perPack === undefined && spec.grams) {
    out.push(`${spec.grams}g`);
  }
  return out;
}
