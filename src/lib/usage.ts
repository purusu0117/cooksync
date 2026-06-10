"use client";

// AI使用量の無料枠管理。原価が出るAI機能（探索/画像/写真認識）だけメーター制にする。
// ※クライアント側カウンタ＝MVP。公開時はサーバー側で厳密に enforce する。

import { usageStore, accountStore, type UsageRecord } from "./storage";
import { usePersistentList } from "./useStore";
import { todayISO } from "./food";

export type AiKind = "research" | "image" | "scan";

// 無料枠（月あたり）。ここを変えるだけで調整可能。プレミアムは無制限。
export const FREE_LIMITS: Record<AiKind, number> = {
  research: 10,
  image: 10,
  scan: 10,
};

export const AI_LABEL: Record<AiKind, string> = {
  research: "AIレシピ探索",
  image: "AI写真生成",
  scan: "写真で在庫登録",
};

export function currentMonth(): string {
  return todayISO().slice(0, 7); // "2026-06"
}

export function useUsage() {
  const [records, setRecords] = usePersistentList(usageStore);
  const [accounts] = usePersistentList(accountStore);
  const premium = accounts[0]?.premium ?? false;
  const month = currentMonth();
  const rec: UsageRecord =
    records.find((r) => r.month === month) ?? {
      month,
      research: 0,
      image: 0,
      scan: 0,
    };

  function used(kind: AiKind): number {
    return rec[kind];
  }
  function remaining(kind: AiKind): number {
    if (premium) return Infinity;
    return Math.max(0, FREE_LIMITS[kind] - rec[kind]);
  }
  function canUse(kind: AiKind): boolean {
    return premium || rec[kind] < FREE_LIMITS[kind];
  }
  function recordUse(kind: AiKind): void {
    setRecords((prev) => {
      const others = prev.filter((r) => r.month !== month);
      const cur =
        prev.find((r) => r.month === month) ??
        ({ month, research: 0, image: 0, scan: 0 } as UsageRecord);
      return [...others, { ...cur, [kind]: cur[kind] + 1 }];
    });
  }

  return { premium, used, remaining, canUse, recordUse };
}
