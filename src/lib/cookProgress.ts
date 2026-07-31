"use client";

// 調理の進捗（どの作業までチェックしたか）を端末に保存する。
// レシピ本体とは別ストア＝同期対象にしない（「今キッチンで作っている状態」は端末ローカルでよい）。
// アプリの他ストアと同じく useSyncExternalStore で購読する（SSR安全・エフェクトでsetStateしない）。

import { useSyncExternalStore } from "react";

const LS_KEY = "cooksync:cookProgress:v1";
// 「いつ触ったか」だけを持つ別キー。**本体(v1)の形は変えない**ので、
// 既に保存されている進捗はそのまま読める（時刻が無い分は「いつか分からない」として扱う）。
const META_KEY = "cooksync:cookProgress:meta:v1";

type Checked = Record<string, boolean>;
type AllProgress = Record<string, string[]>; // recipeId → チェック済みキー
type AllMeta = Record<string, number>; // recipeId → 最終更新(ms)

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

function readMeta(): AllMeta {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(META_KEY) || "{}") as AllMeta;
  } catch {
    return {};
  }
}

function writeMeta(meta: AllMeta): void {
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(meta));
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
    const meta = readMeta();
    const keys = Object.keys(checked).filter((k) => checked[k]);
    if (keys.length === 0) {
      delete all[recipeId];
      delete meta[recipeId];
    } else {
      all[recipeId] = keys;
      meta[recipeId] = Date.now(); // 「どれが作りかけか」を新しい順に出すために要る
    }
    writeAll(all);
    writeMeta(meta);
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

// ---- 「昨日の続き」に戻るための一覧 ----
//
// 進捗はずっと保存されていたのに、**ホームから戻る導線が無かった**。
// 途中まで刻んで手を止めた人が、次に開いたときに自分で
// 「レシピ →（どれだっけ）→ 一覧から探す」をやり直す必要があった。
// 中断は失敗ではなく普通のことなので、拾い直せる場所を1つ作る。

export interface CookProgressEntry {
  recipeId: string;
  /** チェック済みの作業数 */
  doneCount: number;
  /** 最終更新(ms)。旧データ（時刻を持たない）は 0 */
  updatedAt: number;
}

const EMPTY_LIST: CookProgressEntry[] = [];
let listSnapshot: CookProgressEntry[] = EMPTY_LIST;
let listSignature = "";

/** 保存されている進捗を新しい順に返す。**内容が同じなら同じ配列を返す**（再描画を起こさない） */
export function listCookProgress(): CookProgressEntry[] {
  if (typeof window === "undefined") return EMPTY_LIST;
  const all = readAll();
  const meta = readMeta();
  const next = Object.keys(all)
    .map((recipeId) => ({
      recipeId,
      doneCount: all[recipeId]?.length ?? 0,
      updatedAt: meta[recipeId] ?? 0,
    }))
    .filter((e) => e.doneCount > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.recipeId.localeCompare(b.recipeId));
  const sig = JSON.stringify(next);
  if (sig !== listSignature) {
    listSignature = sig;
    listSnapshot = next;
  }
  return listSnapshot;
}

export function useCookProgressList(): CookProgressEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    listCookProgress,
    () => EMPTY_LIST,
  );
}

/** 何日そのままなら「作りかけ」として出すのをやめるか。
 *  1週間前の刻みかけを「戻りますか？」と誘われても、もう作らない。 */
export const RESUMABLE_MAX_AGE_DAYS = 3;

/**
 * ホームに出す「作りかけ」を1つ選ぶ。**純粋関数**（テストしやすいように分けてある）。
 *
 * 出さない条件：
 *   ・全作業が終わっている（＝作り終えた。「作った」を押しても進捗は消えない作りなので、ここで判定する）
 *   ・レシピが見つからない／手順が無い（削除されたレシピの残骸）
 *   ・古すぎる（既定3日）。ただし時刻を持たない旧データは古さで捨てない
 */
export function pickResumable(
  entries: CookProgressEntry[],
  totalTasksOf: (recipeId: string) => number,
  now: number = Date.now(),
  maxAgeDays: number = RESUMABLE_MAX_AGE_DAYS,
): CookProgressEntry | null {
  const maxAge = maxAgeDays * 86_400_000;
  for (const e of entries) {
    const total = totalTasksOf(e.recipeId);
    if (total <= 0) continue;
    if (e.doneCount >= total) continue;
    if (e.updatedAt > 0 && now - e.updatedAt > maxAge) continue;
    return e;
  }
  return null;
}
