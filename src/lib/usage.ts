"use client";

// AI使用量の無料枠**表示**。原価が出るAI機能（レシピ探索/写真認識/レシピ取込）のメーター。
// ※AI写真生成は廃止したので枠も持たない（2026-07-31）。
//
// ⚠️ ここは「残り何回かを即座に見せる」ための表示用カウンタで、**判定の権限はない**。
//    localStorageなので消せば復活する＝これを関門にすると枠として機能しない。
//    実際の可否は必ずサーバー(src/lib/quotaServer.ts)が決め、超過は429で返る。
//    数値は quotaServer.FREE_LIMITS と一致させること（ズレるとUIが嘘をつく）。

import { usageStore, accountStore, type UsageRecord } from "./storage";
import {
  AI_LABEL,
  FREE_LIMITS,
  PREMIUM_LIMITS,
  QUOTA_PERIOD_LABEL,
  QUOTA_RESET_LABEL,
  daysUntilQuotaReset,
  weekKey,
  type AiKind,
} from "./aiLimits";
import { usePersistentList } from "./useStore";
import { todayISO } from "./food";

// 枠の数字と期間は src/lib/aiLimits.ts に一本化した（ここに書くとサーバー側とズレる）。
export type { AiKind } from "./aiLimits";
export { FREE_LIMITS, PREMIUM_LIMITS, AI_LABEL } from "./aiLimits";
// AI_LABEL はこのファイル内でも使うので値としてimportしてある

/** @deprecated 枠は週次になった。期間キーは currentPeriod() を使う。
 *  （旧レコードの読み取り・移行の説明のために残してある） */
export function currentMonth(): string {
  return todayISO().slice(0, 7); // "2026-06"
}

/**
 * 表示カウンタの**期間キー**。サーバー(quotaServer.period)と同じ aiLimits.weekKey を読む。
 *
 * ⚠️ ここで `todayISO()`（端末ローカル日付）から週を作ってはいけない。
 *    サーバーはUTCで動くので、端末のタイムゾーン次第で週がズレて
 *    「画面は残り2回なのにサーバーは0回」になる。weekKey は両側でJSTに寄せている。
 */
export function currentPeriod(): string {
  return weekKey();
}

/**
 * あと何日で枠が戻るか。「また来る理由」を画面に出すために使う。
 * ⚠️ 断るときは残量ではなく**いつ戻るか**を伝える。それが再訪の約束になる。
 */
export function resetHint(now: Date = new Date()): string {
  const d = daysUntilQuotaReset(now);
  return d === 1 ? `明日（${QUOTA_RESET_LABEL}）に戻ります` : `${QUOTA_RESET_LABEL}に戻ります`;
}

/**
 * マイページの残量メーターの見出しと説明。
 *
 * ⚠️ **MyPage.tsx はまだ「今月のAI利用」「毎月1日リセット」と書いてある**（＝枠は週次なので嘘）。
 *    あのファイルは文言部門が並行で触っているのでこちらからは変更していない。
 *    差し替えは import 2つで済むよう、ここに文言を用意してある：
 *      <h2>{QUOTA_METER_TITLE}</h2> ／ <p>{quotaMeterNote(usage.premium)}</p>
 */
export const QUOTA_METER_TITLE = `${QUOTA_PERIOD_LABEL}のAI利用`;

export function quotaMeterNote(premium: boolean): string {
  return premium
    ? `プレミアム：たっぷり使えます（公平利用のため上限あり）。毎週${QUOTA_RESET_LABEL}リセット。`
    : `無料枠は毎週${QUOTA_RESET_LABEL}にリセットされます。使い切っても、次の${QUOTA_RESET_LABEL}にはまた使えます。`;
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
    ? `${QUOTA_PERIOD_LABEL}の${AI_LABEL[kind]}が上限（${limit}回）に達しました。${QUOTA_RESET_LABEL}になると、また${limit}回使えます。`
    : `${QUOTA_PERIOD_LABEL}の無料枠（${AI_LABEL[kind]} ${limit}回）を使い切りました。${QUOTA_RESET_LABEL}になると、また${limit}回使えます。`;
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

/**
 * 月次→週次の移行方針（**既存ユーザーの記録を1件も消さない**）
 *
 * UsageRecord は `{ month: string; research; scan; import? }` という形で
 * localStorage＋サーバー同期に載っている。`month` は**ただの期間キー文字列**なので、
 * 週次では同じ欄に `W2026-07-27` を入れる。型もストアも変えない＝
 * `storage.ts` / `syncStore.ts`（データ保全部門の担当）に一切手を入れずに移行できる。
 *
 * 既存の月次レコード（`2026-08`）は **消さずにそのまま残す**。
 *   - 消さないので、万一この変更を巻き戻しても月次の数字が正しく復元される
 *   - 現在の週キーには一致しないので、移行直後の残量は「週の枠まるごと」から始まる
 *     ＝ **移行によって使えなくなる人は1人も出ない**（枠切れの人はむしろその場で解放される）
 *   - 逆に移行の週だけ最大「月枠の残り＋週枠」を使えるが、
 *     出ていく金額は月間予算(COOKSYNC_MONTHLY_BUDGET_YEN)とIP日次上限で従来どおり頭打ち
 *
 * この性質は usage.test.ts / quotaServer.test.ts で固定している。
 */
export function useUsage() {
  const [records, setRecords] = usePersistentList(usageStore);
  const [accounts] = usePersistentList(accountStore);
  const premium = accounts[0]?.premium ?? false;
  const month = currentPeriod();
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
  // 今週のレコードを1つだけ書き換える共通処理（無ければ作る）。
  // ⚠️ others に**古い月次レコードも含まれる**＝そのまま残る。消さないのが移行方針。
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
