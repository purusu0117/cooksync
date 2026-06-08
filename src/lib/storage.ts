// localStorage への保存/読み込み。今はバックエンド無しで動かし、
// 後で API + DB に差し替えられるよう、この層に閉じ込めておく。

import type { FoodItem } from "./food";

const STORAGE_KEY = "fridge-app:items:v1";

export function loadItems(): FoodItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FoodItem[]) : [];
  } catch {
    return [];
  }
}

export function saveItems(items: FoodItem[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}
