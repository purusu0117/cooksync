"use client";

// localStorage を React の外部ストアとして購読するフック。
// useSyncExternalStore を使うことで SSR ハイドレーション安全（サーバーは空→クライアントで反映）、
// かつ同一ストアを参照する別コンポーネント・別タブ間でも同期する。

import type { Store } from "./storage";
import { SEED_RECIPES } from "./seedRecipes";
import { recipeStore } from "./storage";
import { useServerList } from "./syncStore";
import type { Recipe } from "./recipe";

// 保存先はサーバー(/api/store)＝端末間同期。store.key だけ使い、実体は syncStore に委譲。
export function usePersistentList<T>(
  store: Store<T>,
): [T[], (updater: T[] | ((prev: T[]) => T[])) => void] {
  return useServerList<T>(store.key);
}

/** シードレシピ＋保存レシピを統合してリアクティブに返す */
export function useAllRecipes(): Recipe[] {
  const [stored] = usePersistentList(recipeStore);
  const storedIds = new Set(stored.map((r) => r.id));
  // 初期デフォルトはサンプル6件のみ。移植22件は「取り込み」でユーザーデータ(recipeStore)に入る。
  return [...stored, ...SEED_RECIPES.filter((r) => !storedIds.has(r.id))];
}
