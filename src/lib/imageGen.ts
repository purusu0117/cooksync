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

// 画像生成が使えるか（公開=API=不可 / ローカル=Maxプランで可）。/api/health を一度だけ確認。
let imgEnabled: boolean | null = null;
let imgLoading = false;
const imgListeners = new Set<() => void>();
function ensureImgFlag() {
  if (imgEnabled !== null || imgLoading) return;
  imgLoading = true;
  fetch("/api/health")
    .then((r) => r.json())
    .then((j) => {
      imgEnabled = j?.aiProvider === "local";
    })
    .catch(() => {
      imgEnabled = false;
    })
    .finally(() => {
      imgLoading = false;
      imgListeners.forEach((l) => l());
    });
}
export function useImageGenEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      imgListeners.add(cb);
      ensureImgFlag();
      return () => imgListeners.delete(cb);
    },
    () => imgEnabled === true,
    () => false,
  );
}
