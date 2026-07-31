"use client";

// AI使用量の無料枠**表示**。原価が出るAI機能（レシピ探索/写真認識/レシピ取込）のメーター。
// ※AI写真生成は廃止したので枠も持たない（2026-07-31）。
//
// ⚠️ ここは「残り何回かを即座に見せる」ための表示用カウンタで、**判定の権限はない**。
//    localStorageなので消せば復活する＝これを関門にすると枠として機能しない。
//    実際の可否は必ずサーバー(src/lib/quotaServer.ts)が決め、超過は429で返る。
//    数値は quotaServer.FREE_LIMITS と一致させること（ズレるとUIが嘘をつく）。

import { usageStore, accountStore, type UsageRecord } from "./storage";
import { usePersistentList } from "./useStore";
import { todayISO } from "./food";

export type AiKind = "research" | "scan" | "import";

// 無料枠（月あたり）。原価の裏付けは
// .secretary/Decisions/2026-07-31-cooksync-profitable-monetization.md §3
export const FREE_LIMITS: Record<AiKind, number> = {
  research: 3,
  scan: 5,
  import: 2,
};

// プレミアムのフェアユース上限。**無制限ではない**。
// 無制限にすると1人の月間原価(最大¥497)が手取り(¥371)を超えて赤字になるため。
export const PREMIUM_LIMITS: Record<AiKind, number> = {
  research: 30,
  scan: 150,
  import: 8,
};

export const AI_LABEL: Record<AiKind, string> = {
  research: "AIレシピ探索",
  scan: "写真で在庫登録",
  import: "写真・動画からレシピ",
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
      scan: 0,
    };

  const limits = premium ? PREMIUM_LIMITS : FREE_LIMITS;

  function used(kind: AiKind): number {
    return rec[kind] ?? 0;
  }
  function limitOf(kind: AiKind): number {
    return limits[kind];
  }
  function remaining(kind: AiKind): number {
    return Math.max(0, limits[kind] - (rec[kind] ?? 0));
  }
  function canUse(kind: AiKind): boolean {
    return (rec[kind] ?? 0) < limits[kind];
  }
  function recordUse(kind: AiKind): void {
    setRecords((prev) => {
      const others = prev.filter((r) => r.month !== month);
      const cur =
        prev.find((r) => r.month === month) ??
        ({ month, research: 0, scan: 0 } as UsageRecord);
      return [...others, { ...cur, [kind]: (cur[kind] ?? 0) + 1 }];
    });
  }

  return { premium, used, limitOf, remaining, canUse, recordUse };
}
