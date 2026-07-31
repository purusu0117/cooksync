// 食材カテゴリのアイコン（絵文字🥬🍖🥚…の置き換え）。
// ホームの冷蔵庫チップと冷蔵庫カードで同じ絵柄を使う。

import {
  Apple,
  Beef,
  Carrot,
  CupSoda,
  Egg,
  Soup,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import type { Category } from "@/lib/food";

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  野菜: Carrot,
  "肉・魚": Beef,
  "乳製品・卵": Egg,
  主食: Wheat,
  調味料: Soup,
  飲料: CupSoda,
  その他: Apple,
};
