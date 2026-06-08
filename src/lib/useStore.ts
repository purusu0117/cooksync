"use client";

// localStorage を React の外部ストアとして購読するフック。
// useSyncExternalStore を使うことで SSR ハイドレーション安全（サーバーは空→クライアントで反映）、
// かつ同一ストアを参照する別コンポーネント・別タブ間でも同期する。

import { useSyncExternalStore } from "react";
import type { Store } from "./storage";
import { SEED_RECIPES } from "./seedRecipes";
import { recipeStore } from "./storage";
import type { Recipe } from "./recipe";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = () => cb();
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function notifyAll() {
  listeners.forEach((l) => l());
}

// getSnapshot は参照安定が必須（毎回新配列だと無限ループ）。生JSONをキーにキャッシュ。
const cache = new Map<string, { raw: string; value: unknown }>();
const EMPTY: readonly never[] = [];

function snapshot<T>(store: Store<T>): T[] {
  if (typeof window === "undefined") return EMPTY as unknown as T[];
  const raw = window.localStorage.getItem(store.key) ?? "";
  const cached = cache.get(store.key);
  if (cached && cached.raw === raw) return cached.value as T[];
  const value = store.load();
  cache.set(store.key, { raw, value });
  return value;
}

export function usePersistentList<T>(
  store: Store<T>,
): [T[], (updater: T[] | ((prev: T[]) => T[])) => void] {
  const data = useSyncExternalStore(
    subscribe,
    () => snapshot(store),
    () => EMPTY as unknown as T[],
  );

  function setData(updater: T[] | ((prev: T[]) => T[])) {
    const prev = snapshot(store);
    const next =
      typeof updater === "function"
        ? (updater as (p: T[]) => T[])(prev)
        : updater;
    store.save(next);
    cache.delete(store.key); // 次回 snapshot で再読込
    notifyAll();
  }

  return [data, setData];
}

/** シードレシピ＋保存レシピを統合してリアクティブに返す */
export function useAllRecipes(): Recipe[] {
  const [stored] = usePersistentList(recipeStore);
  const storedIds = new Set(stored.map((r) => r.id));
  return [...stored, ...SEED_RECIPES.filter((r) => !storedIds.has(r.id))];
}
