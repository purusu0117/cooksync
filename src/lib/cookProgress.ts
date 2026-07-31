"use client";

// 調理の進捗（どの作業までチェックしたか）を端末に保存する。
// レシピ本体とは別ストア＝同期対象にしない（「今キッチンで作っている状態」は端末ローカルでよい）。
// アプリの他ストアと同じく useSyncExternalStore で購読する（SSR安全・エフェクトでsetStateしない）。

import { useSyncExternalStore } from "react";

const LS_KEY = "cooksync:cookProgress:v1";

type Checked = Record<string, boolean>;
type AllProgress = Record<string, string[]>; // recipeId → チェック済みキー

const EMPTY: Checked = {};
const snapshots = new Map<string, Checked>();
const listeners = new Set<() => void>();

function readAll(): AllProgress {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(LS_KEY) || "{}") as AllProgress;
  } catch {
    return {};
  }
}

function writeAll(all: AllProgress): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* 容量超過は無視 */
  }
}

/** そのレシピのチェック状態を読む（同じ内容なら同じオブジェクトを返す＝再描画を起こさない） */
export function loadCookProgress(recipeId: string): Checked {
  const cached = snapshots.get(recipeId);
  if (cached) return cached;
  if (typeof window === "undefined") return EMPTY;
  const keys = readAll()[recipeId] ?? [];
  const out: Checked = {};
  for (const k of keys) out[k] = true;
  snapshots.set(recipeId, out);
  return out;
}

/** そのレシピのチェック状態を保存する（空なら丸ごと消す） */
export function saveCookProgress(recipeId: string, checked: Checked): void {
  snapshots.set(recipeId, checked);
  if (typeof window !== "undefined") {
    const all = readAll();
    const keys = Object.keys(checked).filter((k) => checked[k]);
    if (keys.length === 0) delete all[recipeId];
    else all[recipeId] = keys;
    writeAll(all);
  }
  listeners.forEach((l) => l());
}

/** レシピの調理進捗を購読する */
export function useCookProgress(recipeId: string): Checked {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => loadCookProgress(recipeId),
    () => EMPTY,
  );
}
