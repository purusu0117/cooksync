"use client";

// サーバー(/api/store)をデータ源にする外部ストア。端末間で同期される。
//
// 【データ消失を防ぐ設計】
//  - 初回ロード(GET)が「成功」するまで hydrated にしない。失敗時は空で確定させない。
//  - hydrated になるまで書き込みを保留（空状態を保存してしまう事故を防ぐ）。
//  - 書き込み(PUT)は直列化して、サーバー側 read-modify-write の競合を防ぐ。
//  - サーバーが本当に空でローカル(localStorage)に既存データがあれば移行する。

import { useSyncExternalStore } from "react";
import {
  fridgeStore,
  shoppingStore,
  recipeStore,
  mealStore,
  accountStore,
  ratingStore,
  usageStore,
} from "./storage";

const ALL_STORES = [
  fridgeStore,
  shoppingStore,
  recipeStore,
  mealStore,
  accountStore,
  ratingStore,
  usageStore,
];

const mem = new Map<string, unknown[]>();
const listeners = new Set<() => void>();
const EMPTY: readonly never[] = [];

let hydrated = false;
let hydratePromise: Promise<void> | null = null;

function notify() {
  listeners.forEach((l) => l());
}

// PUT を直列化（前の書き込みが終わってから次を実行）＝サーバー競合回避
let writeChain: Promise<unknown> = Promise.resolve();
function queuePut(key: string, value: unknown[]) {
  writeChain = writeChain
    .catch(() => {})
    .then(() =>
      fetch("/api/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      }),
    )
    .catch(() => {
      /* オフライン等。メモリは保持され、次回操作で再送される */
    });
  return writeChain;
}

async function doHydrate() {
  const res = await fetch("/api/store");
  if (!res.ok) throw new Error(`store GET ${res.status}`);
  const server = (await res.json()) as Record<string, unknown>;
  for (const store of ALL_STORES) {
    const sv = server[store.key];
    if (Array.isArray(sv) && sv.length > 0) {
      mem.set(store.key, sv);
    } else {
      // サーバーが空 → ローカルの既存データがあれば移行
      const local = store.load();
      if (local.length > 0) {
        mem.set(store.key, local);
        void queuePut(store.key, local);
      } else {
        mem.set(store.key, Array.isArray(sv) ? sv : []);
      }
    }
  }
  hydrated = true; // ★成功時のみ確定
  notify();
}

// 実行中の hydrate Promise を共有し、完了を待てるようにする。
// 失敗時は hydratePromise を null に戻して再試行可能にする（hydrated は false のまま）。
function hydrate(): Promise<void> {
  if (hydrated || typeof window === "undefined") return Promise.resolve();
  if (!hydratePromise) {
    hydratePromise = doHydrate()
      .catch(() => {
        /* 失敗：空で確定しない。次回再試行 */
      })
      .finally(() => {
        hydratePromise = null;
      });
  }
  return hydratePromise;
}

export function useServerList<T>(
  key: string,
): [T[], (updater: T[] | ((prev: T[]) => T[])) => void] {
  const data = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      void hydrate();
      return () => {
        listeners.delete(cb);
      };
    },
    () => (mem.get(key) as T[]) ?? (EMPTY as unknown as T[]),
    () => EMPTY as unknown as T[],
  );

  function applyWrite(updater: T[] | ((prev: T[]) => T[])) {
    const prev = (mem.get(key) as T[]) ?? [];
    const next =
      typeof updater === "function"
        ? (updater as (p: T[]) => T[])(prev)
        : updater;
    mem.set(key, next);
    notify();
    void queuePut(key, next as unknown[]);
  }

  function setData(updater: T[] | ((prev: T[]) => T[])) {
    if (!hydrated) {
      // まだ読み込めていない時に書くと「空」を保存してしまう恐れ。
      // ロード完了を待ってから適用する（失敗時は安全のため破棄）。
      void hydrate().then(() => {
        if (hydrated) applyWrite(updater);
      });
      return;
    }
    applyWrite(updater);
  }

  return [data, setData];
}

/** 全データをサーバーから消す（リセット用） */
export async function clearAllServer() {
  for (const store of ALL_STORES) {
    mem.set(store.key, []);
    await queuePut(store.key, []);
  }
  notify();
}
