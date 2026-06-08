// Notion 冷蔵庫リスト（2026-06-08 スナップショット）をCookSyncに取り込むための初期データ。
// Notion側は消さず、こちらに複製するだけ。冷蔵庫画面の「Notionから取り込む」で追加。

import { type Category, type FridgeItem, zoneForCategory } from "./food";

interface RawItem {
  name: string;
  quantity: string;
  category: Category;
  expiresOn: string; // 目安期限（Notion記載 or 推定）
}

// 2026-06-08 時点の Notion 冷蔵庫リスト
const RAW: RawItem[] = [
  // 🥩 生鮮品
  { name: "生姜", quantity: "1かけ", category: "野菜", expiresOn: "2026-06-22" },
  { name: "梅干し", quantity: "", category: "調味料", expiresOn: "2026-12-05" },
  { name: "有塩バター", quantity: "残り", category: "乳製品・卵", expiresOn: "2026-07-08" },
  { name: "卵", quantity: "6個", category: "乳製品・卵", expiresOn: "2026-06-15" },
  // 🥫 乾物・調味料
  { name: "スパゲッティ ガロファロ 1.7mm", quantity: "残り", category: "主食", expiresOn: "2026-10-06" },
  { name: "片栗粉", quantity: "", category: "調味料", expiresOn: "2026-12-05" },
  { name: "醤油", quantity: "", category: "調味料", expiresOn: "2026-12-05" },
  { name: "白ワイン", quantity: "", category: "調味料", expiresOn: "2026-12-05" },
  { name: "赤ワイン", quantity: "", category: "調味料", expiresOn: "2026-12-05" },
  { name: "唐辛子オイル", quantity: "", category: "調味料", expiresOn: "2026-12-05" },
  { name: "ラー油", quantity: "", category: "調味料", expiresOn: "2026-12-05" },
  { name: "小麦粉", quantity: "", category: "調味料", expiresOn: "2026-12-05" },
  { name: "米", quantity: "約1.85kg", category: "主食", expiresOn: "2026-10-06" },
  { name: "固形コンソメ", quantity: "1箱", category: "調味料", expiresOn: "2026-12-05" },
  { name: "にんにくチューブ", quantity: "残り", category: "調味料", expiresOn: "2026-12-05" },
  { name: "米油", quantity: "", category: "調味料", expiresOn: "2026-12-05" },
  { name: "ケチャップ", quantity: "", category: "調味料", expiresOn: "2026-09-06" },
];

/** 取り込み用の FridgeItem 配列を生成（id/createdAt付与） */
export function buildFridgeImport(): FridgeItem[] {
  const today = "2026-06-08";
  return RAW.map((r) => ({
    id: crypto.randomUUID(),
    name: r.name,
    quantity: r.quantity,
    category: r.category,
    zone: zoneForCategory(r.category),
    purchasedOn: today,
    expiresOn: r.expiresOn,
    createdAt: Date.now(),
  }));
}

export const FRIDGE_IMPORT_NAMES = RAW.map((r) => r.name);
