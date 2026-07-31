// 買い物リストを**売り場の順**に並べるための純粋ロジック。AIは使わない。
//
// なぜ要るか：
//   価値を感じる瞬間の1位は「帰宅途中 50.4%」「買い物中 50.1%」。**店の中で開くアプリ**。
//   なのにリストは追加した順に並んでいて、野菜売り場で「牛乳・玉ねぎ・鶏肉・にんじん」を
//   上から下まで読み直し、店内を行ったり来たりすることになる。
//   売り場順に固まっているだけで、上から順に取っていけば1周で買い終わる。
//
// 分類は `guessCategory`（既存の辞書）をそのまま使う。**新しい推定を足さない**：
//   冷蔵庫の分類と食い違うと「同じ食材なのに画面ごとに別のもの扱い」になるため。

import { guessCategory } from "./guess";
import type { Category } from "./food";

/**
 * 日本のスーパーの一般的な回遊順。入口の青果から、生鮮 → 日配 → 主食 → 調味料 → 飲料。
 * 完全一致する店は無いが、**固まっていること**自体に意味がある
 * （同じ売り場のものが1箇所にまとまれば、順番が多少違っても往復は消える）。
 */
export const AISLE_ORDER: Category[] = [
  "野菜",
  "肉・魚",
  "乳製品・卵",
  "主食",
  "調味料",
  "飲料",
  "その他",
];

/** 売り場の呼び名。冷蔵庫のカテゴリ名より、店の看板に近い言葉にする。 */
export const AISLE_LABEL: Record<Category, string> = {
  野菜: "野菜・果物",
  "肉・魚": "肉・魚",
  "乳製品・卵": "牛乳・卵・豆腐",
  主食: "米・パン・麺",
  調味料: "調味料・乾物",
  飲料: "飲みもの",
  その他: "その他",
};

export interface AisleGroup<T> {
  category: Category;
  label: string;
  items: T[];
}

/**
 * 売り場ごとにまとめる。**中身の順番は元のまま**（追加した順を保つ）。
 * 空の売り場は返さない。
 */
export function groupByAisle<T>(
  items: T[],
  nameOf: (item: T) => string,
): AisleGroup<T>[] {
  const buckets = new Map<Category, T[]>();
  for (const item of items) {
    const c = guessCategory(nameOf(item));
    const list = buckets.get(c);
    if (list) list.push(item);
    else buckets.set(c, [item]);
  }
  return AISLE_ORDER.filter((c) => buckets.has(c)).map((c) => ({
    category: c,
    label: AISLE_LABEL[c],
    items: buckets.get(c) as T[],
  }));
}
