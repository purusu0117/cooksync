// AIの無料枠・プレミアム枠の**唯一の定義**。
//
// ⚠️ 以前は同じ数字を `quotaServer.ts`（サーバー判定）と `usage.ts`（画面表示）の
//    2箇所に書いていた。案の定サーバー側だけ 8/25/5 に上げて表示側が 3/5/2 のまま残り、
//    「無料枠が依然として3・5・2になってる」と大翔に指摘された（2026-08-01）。
//    数字を持つ場所はここ1つにして、両方から読む。
//
// このファイルは **node固有のものを一切importしない**。
// そうしないとクライアントコンポーネント（usage.ts は "use client"）から読めない。
//
// 実測原価（1回あたり）: research ¥19.6 / scan ¥0.53 / import ¥12.8
// research は共有プールに当たれば原価0で、その場合は枠を消費しない
// （/api/research が先にプールを引く）。なのでこの数字は「新規生成の回数」。

export type AiKind = "research" | "scan" | "import";

/** 無料ユーザーの月間枠。最悪ケースでも COOKSYNC_MONTHLY_BUDGET_YEN で頭打ちになる。 */
export const FREE_LIMITS: Record<AiKind, number> = {
  research: 8, // 最悪 ¥157/月
  scan: 25, // 最悪 ¥13/月
  import: 5, // 最悪 ¥64/月
};

/** プレミアムのフェアユース上限。**無制限にはしない**（原価が手取りを超えるため）。 */
export const PREMIUM_LIMITS: Record<AiKind, number> = {
  research: 60,
  scan: 300,
  import: 20,
};

export const AI_LABEL: Record<AiKind, string> = {
  research: "AIレシピ探索",
  scan: "写真で在庫登録",
  import: "写真・動画からレシピ",
};
