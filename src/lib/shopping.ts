// 買い物リストのドメインモデルと純粋ロジック。

import { todayISO } from "./food";

export interface ShoppingItem {
  id: string;
  name: string;
  amount: string; // 買い物単位「1切」「1パック」
  note?: string; // 用途「夜の油淋鶏用」
  checked: boolean; // [x]
  addedAt: number; // 3日超クリーンアップ用
  fromRecipeId?: string; // 由来（整合チェックに使う）
}

const DAY_MS = 86_400_000;

function parseDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** 追加から指定日数以上経った未チェック項目（クリーンアップ候補） */
export function staleItems(
  items: ShoppingItem[],
  days = 3,
  now: number = Date.now(),
): ShoppingItem[] {
  return items.filter(
    (i) => !i.checked && now - i.addedAt >= days * DAY_MS,
  );
}

/** 今日より前に追加された未チェック項目（addedAtが無い古いデータ向けの日付版） */
export function staleByDate(
  items: ShoppingItem[],
  today: string = todayISO(),
  days = 3,
): ShoppingItem[] {
  const cutoff = parseDate(today) - days * DAY_MS;
  return items.filter((i) => !i.checked && i.addedAt <= cutoff);
}

export interface Shortfall {
  name: string;
  amount: string;
  note?: string;
}

/**
 * 不足食材を計算：レシピの「買い足し or 在庫に無い」材料のうち、
 * 既に持っている名前(haveNames)・既に買い物リストにある名前(onListNames)を除く。
 */
export function shortfall(
  needed: { name: string; amount: string; note?: string }[],
  haveNames: string[],
  onListNames: string[] = [],
  matches: (a: string, b: string) => boolean = (a, b) => a === b,
): Shortfall[] {
  return needed.filter(
    (n) =>
      !haveNames.some((h) => matches(h, n.name)) &&
      !onListNames.some((l) => matches(l, n.name)),
  );
}
