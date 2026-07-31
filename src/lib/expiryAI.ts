"use client";

// 賞味期限のAI推定（クライアント側の入口）。
// 決定論テーブル（guess.ts）に無い食材だけを /api/estimate-expiry に投げ、
// 結果は端末にもキャッシュして同じ食材を二度聞かない。

export interface ExpiryEstimate {
  name: string;
  days: number;
  storage?: string;
  note?: string;
}

const LS_KEY = "cooksync:expiryAI:v1";

type CacheMap = Record<string, ExpiryEstimate>;

function keyOf(name: string, opened: boolean): string {
  return `${name.trim()}|${opened ? "opened" : "sealed"}`;
}

function readCache(): CacheMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(LS_KEY) || "{}") as CacheMap;
  } catch {
    return {};
  }
}

function writeCache(c: CacheMap): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(c));
  } catch {
    /* 容量超過などは無視（次回また聞くだけ） */
  }
}

/** キャッシュ済みの推定を同期で引く（表示用） */
export function cachedEstimate(name: string, opened = false): ExpiryEstimate | null {
  return readCache()[keyOf(name, opened)] ?? null;
}

/**
 * 食材の日持ちをAIに推定してもらう。キャッシュにあるものは即返す。
 * 失敗しても例外は投げない（決定論の推定のままでアプリは動く）。
 */
export async function estimateExpiryDays(
  items: { name: string; opened?: boolean }[],
): Promise<Record<string, ExpiryEstimate>> {
  const cache = readCache();
  const out: Record<string, ExpiryEstimate> = {};
  const ask: { name: string; opened?: boolean }[] = [];

  for (const i of items) {
    const k = keyOf(i.name, !!i.opened);
    if (cache[k]) out[i.name] = cache[k];
    else ask.push(i);
  }
  if (ask.length === 0) return out;

  try {
    const res = await fetch("/api/estimate-expiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: ask }),
    });
    const data = (await res.json()) as { results?: ExpiryEstimate[] };
    for (const r of data.results ?? []) {
      if (!r || typeof r.days !== "number" || r.days <= 0) continue;
      const src = ask.find((a) => a.name === r.name);
      cache[keyOf(r.name, !!src?.opened)] = r;
      out[r.name] = r;
    }
    writeCache(cache);
  } catch {
    /* オフライン等 → 決定論の推定のまま */
  }
  return out;
}
