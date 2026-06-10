"use client";

// 「今このレシピの写真を生成中」をアプリ全体で共有する軽量ストア（同一タブ内）。
// 生成はMealWizard/RecipeDetailから起動し、レシピ一覧・詳細のサムネで「生成中…」表示に使う。

import { useSyncExternalStore } from "react";

const generating = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: string[] = [];
const EMPTY: string[] = [];

function emit() {
  snapshot = [...generating];
  listeners.forEach((l) => l());
}

export function startGenerating(id: string) {
  generating.add(id);
  emit();
}
export function stopGenerating(id: string) {
  generating.delete(id);
  emit();
}

export function useGeneratingIds(): string[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => EMPTY,
  );
}

export function useIsGenerating(id: string): boolean {
  return useGeneratingIds().includes(id);
}
