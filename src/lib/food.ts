// 食材の型・賞味期限ロジックをまとめたドメインモジュール。
// UI から切り離しておくと、後で献立提案やバーコード入力を足すときに使い回せる。

export type Category =
  | "野菜"
  | "肉・魚"
  | "乳製品・卵"
  | "主食"
  | "調味料"
  | "飲料"
  | "その他";

export const CATEGORIES: Category[] = [
  "野菜",
  "肉・魚",
  "乳製品・卵",
  "主食",
  "調味料",
  "飲料",
  "その他",
];

export const CATEGORY_EMOJI: Record<Category, string> = {
  野菜: "🥬",
  "肉・魚": "🍖",
  "乳製品・卵": "🥚",
  主食: "🍚",
  調味料: "🧂",
  飲料: "🧃",
  その他: "🍱",
};

export interface FoodItem {
  id: string;
  name: string;
  quantity: string; // 「2個」「約150g」など自由入力
  category: Category;
  purchasedOn: string; // 購入日 yyyy-mm-dd
  expiresOn: string; // 賞味/消費期限 yyyy-mm-dd
  createdAt: number;
}

// 🔴 期限切れ / 🟡 期限が近い / 🟢 余裕あり
export type Freshness = "expired" | "soon" | "fresh";

// 「あと何日」でこの日数以下なら 🟡 扱い
export const SOON_THRESHOLD_DAYS = 3;

/** ローカルタイムの今日を yyyy-mm-dd で返す */
export function todayISO(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 期限まであと何日か（マイナスなら過ぎている）。日付単位で計算する */
export function daysUntil(expiresOn: string, today: string = todayISO()): number {
  const diff = parseDate(expiresOn).getTime() - parseDate(today).getTime();
  return Math.round(diff / 86_400_000);
}

export function freshnessOf(
  expiresOn: string,
  today: string = todayISO(),
): Freshness {
  const left = daysUntil(expiresOn, today);
  if (left < 0) return "expired";
  if (left <= SOON_THRESHOLD_DAYS) return "soon";
  return "fresh";
}

export interface FreshnessStyle {
  emoji: string;
  label: (daysLeft: number) => string;
  badge: string; // バッジの Tailwind クラス
  border: string; // カード枠線の Tailwind クラス
}

export const FRESHNESS: Record<Freshness, FreshnessStyle> = {
  expired: {
    emoji: "🔴",
    label: (l) => `期限切れ${Math.abs(l)}日`,
    badge: "bg-red-100 text-red-700",
    border: "border-red-300",
  },
  soon: {
    emoji: "🟡",
    label: (l) => (l === 0 ? "今日まで" : `あと${l}日`),
    badge: "bg-amber-100 text-amber-700",
    border: "border-amber-300",
  },
  fresh: {
    emoji: "🟢",
    label: (l) => `あと${l}日`,
    badge: "bg-emerald-100 text-emerald-700",
    border: "border-emerald-200",
  },
};

/** 期限が近い順（期限切れが先頭）に並べ替える */
export function sortByExpiry(
  items: FoodItem[],
  today: string = todayISO(),
): FoodItem[] {
  return [...items].sort(
    (a, b) => daysUntil(a.expiresOn, today) - daysUntil(b.expiresOn, today),
  );
}
