"use client";

// サーバー(/api/store)をデータ源にする外部ストア。端末間で同期される。
// 初回ハイドレート時、サーバーが空でローカル(localStorage)に既存データがあれば
// それをサーバーへ移行（＝今までPCに溜めたデータを引き継ぐ）。

import { useSyncExternalStore } from "react";
import {
  fridgeStore,
  shoppingStore,
  recipeStore,
  mealStore,
  accountStore,
} from "./storage";

const ALL_STORES = [
  fridgeStore,
  shoppingStore,
  recipeStore,
  mealStore,
  accountStore,
];

const mem = new Map<string, unknown[]>();
const listeners = new Set<() => void>();
const EMPTY: readonly never[] = [];

let hydrated = false;
let hydrating = false;

function notify() {
  listeners.forEach((l) => l());
}

async function putKey(key: string, value: unknown[]) {
  try {
    await fetch("/api/store", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  } catch {
    /* オフライン時はメモリのみ。次回書き込みで再送される */
  }
}

async function hydrate() {
  if (hydrated || hydrating || typeof window === "undefined") return;
  hydrating = true;
  try {
    const res = await fetch("/api/store");
    const server: Record<string, unknown> = res.ok ? await res.json() : {};
    for (const store of ALL_STORES) {
      const sv = server[store.key];
      if (Array.isArray(sv) && sv.length > 0) {
        mem.set(store.key, sv);
      } else {
        // サーバーが空 → ローカルの既存データを移行
        const local = store.load();
        if (local.length > 0) {
          mem.set(store.key, local);
          void putKey(store.key, local);
        } else {
          mem.set(store.key, Array.isArray(sv) ? sv : []);
        }
      }
    }
    hydrated = true;
    notify();
  } finally {
    hydrating = false;
  }
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

  function setData(updater: T[] | ((prev: T[]) => T[])) {
    const prev = (mem.get(key) as T[]) ?? [];
    const next =
      typeof updater === "function"
        ? (updater as (p: T[]) => T[])(prev)
        : updater;
    mem.set(key, next);
    notify();
    void putKey(key, next as unknown[]);
  }

  return [data, setData];
}

/** 全データをサーバーから消す（リセット用） */
export async function clearAllServer() {
  for (const store of ALL_STORES) {
    mem.set(store.key, []);
    await putKey(store.key, []);
  }
  notify();
}
