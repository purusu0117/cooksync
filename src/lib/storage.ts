// 永続化層。今は localStorage で動かし、将来 API + DB に差し替えられるよう
// Store<T> インターフェースに閉じ込めておく（Phase 3 で apiStore に1ファイル差し替え）。

import { type FoodItem, type FridgeItem, zoneForCategory } from "./food";
import type { ShoppingItem } from "./shopping";
import type { Recipe } from "./recipe";
import type { MealEntry } from "./mealplan";
import type { Account } from "./account";

export interface Store<T> {
  load(): T[];
  save(items: T[]): void;
  key: string;
}

function localStore<T>(key: string): Store<T> {
  return {
    key,
    load(): T[] {
      if (typeof window === "undefined") return [];
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as T[]) : [];
      } catch {
        return [];
      }
    },
    save(items: T[]): void {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(key, JSON.stringify(items));
    },
  };
}

const FRIDGE_KEY = "fridge-app:items:v2";
const FRIDGE_KEY_V1 = "fridge-app:items:v1";

const baseFridgeStore = localStore<FridgeItem>(FRIDGE_KEY);

/** v1（zoneなしFoodItem）→ v2（FridgeItem）へ一度だけ移行 */
function migrateV1toV2(): FridgeItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FRIDGE_KEY_V1);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const migrated: FridgeItem[] = (parsed as FoodItem[]).map((it) => ({
      ...it,
      zone: zoneForCategory(it.category),
    }));
    baseFridgeStore.save(migrated);
    window.localStorage.removeItem(FRIDGE_KEY_V1);
    return migrated;
  } catch {
    return null;
  }
}

export const fridgeStore: Store<FridgeItem> = {
  key: FRIDGE_KEY,
  load(): FridgeItem[] {
    if (typeof window === "undefined") return [];
    const existing = window.localStorage.getItem(FRIDGE_KEY);
    if (existing == null) {
      const migrated = migrateV1toV2();
      if (migrated) return migrated;
    }
    // 念のため zone を補完（手書き/欠損データ対策）
    return baseFridgeStore.load().map((it) => ({
      ...it,
      zone: it.zone ?? zoneForCategory(it.category),
    }));
  },
  save: baseFridgeStore.save,
};

export const shoppingStore = localStore<ShoppingItem>(
  "fridge-app:shopping:v1",
);
export const recipeStore = localStore<Recipe>("fridge-app:recipes:v1");
export const mealStore = localStore<MealEntry>("fridge-app:meals:v1");
// アカウントは0〜1件のリストとして保持（usePersistentListで扱う）
export const accountStore = localStore<Account>("cooksync:account:v1");

// レシピの星評価（recipeId→stars 1〜5）。レシピ本体と別ストアで保持。
export interface RatingEntry {
  recipeId: string;
  stars: number;
}
export const ratingStore = localStore<RatingEntry>("cooksync:ratings:v1");

// 後方互換（旧 FridgeApp が import していた API）
export function loadItems(): FridgeItem[] {
  return fridgeStore.load();
}
export function saveItems(items: FridgeItem[]): void {
  fridgeStore.save(items);
}
