"use client";

// AI使用量の無料枠**表示**。原価が出るAI機能（レシピ探索/写真認識/レシピ取込）のメーター。
// ※AI写真生成は廃止したので枠も持たない（2026-07-31）。
//
// ⚠️ ここは「残り何回かを即座に見せる」ための表示用カウンタで、**判定の権限はない**。
//    localStorageなので消せば復活する＝これを関門にすると枠として機能しない。
//    実際の可否は必ずサーバー(src/lib/quotaServer.ts)が決め、超過は429で返る。
//    数値は quotaServer.FREE_LIMITS と一致させること（ズレるとUIが嘘をつく）。

import { usageStore, accountStore, type UsageRecord } from "./storage";
import { AI_LABEL, FREE_LIMITS, PREMIUM_LIMITS, type AiKind } from "./aiLimits";
import { usePersistentList } from "./useStore";
import { todayISO } from "./food";

// 枠の数字は src/lib/aiLimits.ts に一本化した（ここに書くとサーバー側とズレる）。
export type { AiKind } from "./aiLimits";
export { FREE_LIMITS, PREMIUM_LIMITS, AI_LABEL } from "./aiLimits";
// AI_LABEL はこのファイル内でも使うので値としてimportしてある

export function currentMonth(): string {
  return todayISO().slice(0, 7); // "2026-06"
}

/** サーバーが429で返す枠情報（quotaServer.quotaResponse の `quota`）。 */
export interface ServerQuota {
  kind?: AiKind;
  /** 拒否理由。"user" だけが「その人の枠を使い切った」。他は本人の枠は減っていない */
  reason?: "user" | "ip" | "global" | "budget";
  used?: number;
  limit?: number;
  premium?: boolean;
}

/**
 * 枠切れの文言。**quotaServer.ts の denyUser と同じ言い回しにすること**。
 * クライアントの事前チェックとサーバーの429で文言が違うと、
 * 同じ「枠切れ」なのに押すタイミングで説明が変わり、ユーザーはどちらが本当か分からなくなる。
 */
export function quotaMessage(kind: AiKind, limit: number, premium: boolean): string {
  return premium
    ? `今月の${AI_LABEL[kind]}が上限（${limit}回）に達しました。来月またご利用ください。`
    : `今月の無料枠（${AI_LABEL[kind]} ${limit}回）を使い切りました。`;
}

/**
 * APIの失敗レスポンスから、画面に出す文言と枠情報を取り出す。
 *
 * 429（枠切れ）は**サーバーの文言をそのまま出す**。
 * 理由がIP日次なのか全体なのか金額なのかはサーバーしか知らず、
 * こちらで「無料枠を使い切りました」と書くと嘘になることがあるため。
 */
export function readApiError(
  data: unknown,
  fallback: string,
): { message: string; quota?: ServerQuota } {
  const d = (data ?? {}) as { error?: unknown; quota?: ServerQuota };
  const message = typeof d.error === "string" && d.error.trim() ? d.error : fallback;
  return { message, quota: d.quota };
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
  // 今月のレコードを1つだけ書き換える共通処理（無ければ作る）
  function update(kind: AiKind, next: (n: number) => number): void {
    setRecords((prev) => {
      const others = prev.filter((r) => r.month !== month);
      const cur =
        prev.find((r) => r.month === month) ??
        ({ month, research: 0, scan: 0 } as UsageRecord);
      return [...others, { ...cur, [kind]: Math.max(0, next(cur[kind] ?? 0)) }];
    });
  }

  function recordUse(kind: AiKind): void {
    update(kind, (n) => n + 1);
  }

  /** 先に数えた1回を取り消す。サーバーもAI失敗時は refund するので、それに合わせる。 */
  function undoUse(kind: AiKind): void {
    update(kind, (n) => n - 1);
  }

  /** 事前チェックで弾くときの文言。サーバーの429と同じ言い回しを使う。 */
  function limitMessage(kind: AiKind): string {
    return quotaMessage(kind, limits[kind], premium);
  }

  /**
   * サーバーの応答に合わせて表示カウンタを直す。**判定はあくまでサーバー**で、
   * ここは「メーターの見た目がサーバーと食い違わないようにする」だけ。
   *   枠切れ(reason:"user") … 本当に使い切っているのでメーターも満杯にする
   *   それ以外               … 本人の枠は減っていないので、先に数えた1回を戻す
   */
  function syncFromServer(kind: AiKind, quota?: ServerQuota): void {
    if (quota?.reason === "user") {
      update(kind, () => quota.limit ?? limits[kind]);
      return;
    }
    undoUse(kind);
  }

  return {
    premium,
    used,
    limitOf,
    remaining,
    canUse,
    recordUse,
    undoUse,
    limitMessage,
    syncFromServer,
  };
}
