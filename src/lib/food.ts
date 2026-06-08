// 食材の型・賞味期限ロジックをまとめたドメインモジュール。
// UI から切り離してあるので、献立提案・買い物・消費推定など他のロジックから使い回せる。

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

// 冷蔵庫リストの「保存ゾーン」。Step 0b の消費推定ルールを駆動する。
// 生鮮=料理後に全量消費とみなす / 野菜=量を確認 / 調味料=自動削除しない / 冷凍=残量確認。
export type StorageZone = "生鮮" | "野菜" | "乾物・調味料" | "冷凍" | "その他";

/** Category から既定の保存ゾーンを導く（手動上書き可） */
export function zoneForCategory(category: Category): StorageZone {
  switch (category) {
    case "肉・魚":
      return "生鮮";
    case "野菜":
      return "野菜";
    case "調味料":
    case "主食":
      return "乾物・調味料";
    case "乳製品・卵":
    case "飲料":
      return "生鮮"; // 牛乳・卵など要期限管理
    default:
      return "その他";
  }
}

export interface FoodItem {
  id: string;
  name: string;
  quantity: string; // 「2個」「約150g」など自由入力
  category: Category;
  purchasedOn: string; // 購入日 yyyy-mm-dd
  expiresOn: string; // 賞味/消費期限 yyyy-mm-dd
  createdAt: number;
}

// 冷蔵庫の保存単位。FoodItem を土台に、消費推定と加工日トラッキングを足す。
export interface FridgeItem extends FoodItem {
  zone: StorageZone;
  cutOn?: string; // 切った日（あると期限を切ってから2〜5日で再計算できる）
  openedOn?: string; // 開封日
}

// 🔴 expired(期限切れ) / 🔴 urgent(0-2日) / 🟡 soon(3-5日) / 🟢 fresh(6日以上)
// 内部は4状態で精度を持たせ、表示は🔴🟡🟢の3バケツにまとめる（SUMMARY参照）。
export type Freshness = "expired" | "urgent" | "soon" | "fresh";

// 「あと何日」でこの日数以下なら 🔴 超優先（urgent）扱い
export const URGENT_THRESHOLD_DAYS = 2;
// 「あと何日」でこの日数以下なら 🟡 優先（soon）扱い
export const SOON_THRESHOLD_DAYS = 5;

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
  if (left <= URGENT_THRESHOLD_DAYS) return "urgent";
  if (left <= SOON_THRESHOLD_DAYS) return "soon";
  return "fresh";
}

/** 🔴 超優先（今日明日中に使いたい）＝期限切れ or あと2日以内 */
export function isPriorityConsume(
  expiresOn: string,
  today: string = todayISO(),
): boolean {
  const f = freshnessOf(expiresOn, today);
  return f === "expired" || f === "urgent";
}

export interface FreshnessStyle {
  emoji: string;
  label: (daysLeft: number) => string;
  badge: string; // バッジの Tailwind クラス
  border: string; // カード枠線の Tailwind クラス
  ring: string; // 強調リングの Tailwind クラス
}

export const FRESHNESS: Record<Freshness, FreshnessStyle> = {
  expired: {
    emoji: "🔴",
    label: (l) => `期限切れ${Math.abs(l)}日`,
    badge: "bg-red-100 text-red-700",
    border: "border-red-300",
    ring: "ring-red-300",
  },
  urgent: {
    emoji: "🔴",
    label: (l) => (l === 0 ? "今日まで" : `あと${l}日・要消費`),
    badge: "bg-red-100 text-red-700",
    border: "border-red-300",
    ring: "ring-red-300",
  },
  soon: {
    emoji: "🟡",
    label: (l) => `あと${l}日`,
    badge: "bg-amber-100 text-amber-700",
    border: "border-amber-300",
    ring: "ring-amber-300",
  },
  fresh: {
    emoji: "🟢",
    label: (l) => `あと${l}日`,
    badge: "bg-emerald-100 text-emerald-700",
    border: "border-emerald-200",
    ring: "ring-emerald-200",
  },
};

// 表示用の3バケツ（スキルの「超優先 / 優先 / 余裕」に対応）
export type FreshnessBucket = "priority" | "soon" | "fresh";

export function bucketOf(
  expiresOn: string,
  today: string = todayISO(),
): FreshnessBucket {
  const f = freshnessOf(expiresOn, today);
  if (f === "expired" || f === "urgent") return "priority";
  if (f === "soon") return "soon";
  return "fresh";
}

export const BUCKETS: { key: FreshnessBucket; emoji: string; label: string }[] = [
  { key: "priority", emoji: "🔴", label: "超優先" },
  { key: "soon", emoji: "🟡", label: "優先" },
  { key: "fresh", emoji: "🟢", label: "余裕あり" },
];

/** 期限が近い順（期限切れが先頭）に並べ替える */
export function sortByExpiry<T extends { expiresOn: string }>(
  items: T[],
  today: string = todayISO(),
): T[] {
  return [...items].sort(
    (a, b) => daysUntil(a.expiresOn, today) - daysUntil(b.expiresOn, today),
  );
}

// 加工・購入からの賞味期限の目安（日数）。切った/開封した食材の期限再計算に使う。
// 冷蔵庫リストの「賞味期限の目安」テーブルを移植。
export const EXPIRY_ESTIMATE_DAYS: Record<string, number> = {
  切った玉ねぎ: 4,
  切ったアボカド: 3,
  カット野菜: 3,
  開封ミニトマト: 6,
  開封牛乳: 4,
  開封スライスチーズ: 10,
  卵: 14,
  生姜: 18,
  冷凍: 90,
};

/** 加工日（切った/開封した日）＋目安日数 で新しい期限を返す */
export function estimateExpiry(fromISO: string, days: number): string {
  const base = parseDate(fromISO);
  base.setDate(base.getDate() + days);
  const offsetMs = base.getTimezoneOffset() * 60_000;
  return new Date(base.getTime() - offsetMs).toISOString().slice(0, 10);
}
