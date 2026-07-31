// AIの無料枠・プレミアム枠の**唯一の定義**と、枠が回復する**期間の定義**。
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

/**
 * 無料ユーザーの**週間**枠。**2026-08-01に月次から週次へ変更した。**
 *
 * なぜ月次をやめたか：
 *   月8回だと、**月初に使い切った人はそこから3週間なにもできない**。
 *   「開いても何もできない」期間が3週間あるアプリは開かれなくなる。
 *   Food&Drink カテゴリの継続率は全カテゴリ最下位（Day1 16.5% / Day7 7% / Day30 3.9%）で、
 *   1,000DL取っても30日後に残るのは40人。ここで3週間の空白を作るのは致命的。
 *
 * 週次にすると **原価は変わらないのに「毎週月曜に戻ってくる理由」ができる**。
 * 月あたりの回数もほぼ同じ（週2回 × 約4.35週 = 8.7回 ≒ 月8回）。
 *
 * 最悪ケースの原価（1人・1ヶ月）:
 *   research 2×4.35=8.7回 ¥170 / scan 6×4.35=26回 ¥14 / import 2×4.35=8.7回 ¥111
 * 旧・月次（8/25/5 = ¥157/¥13/¥64）より import が増えるが、
 * **実際に出ていく金額の上限は COOKSYNC_MONTHLY_BUDGET_YEN（既定¥3,000）で変わらない**。
 * import を週1にすると「レシピ本を数ページまとめて取り込む」使い方が成立しないので2にした。
 */
export const FREE_LIMITS: Record<AiKind, number> = {
  research: 2,
  scan: 6,
  import: 2,
};

/** プレミアムのフェアユース**週間**上限。**無制限にはしない**（原価が手取りを超えるため）。
 *  旧・月次（60/300/20）を4で割った値。月あたりでは少し増える（4.35週あるため）。 */
export const PREMIUM_LIMITS: Record<AiKind, number> = {
  research: 15,
  scan: 75,
  import: 5,
};

export const AI_LABEL: Record<AiKind, string> = {
  research: "AIレシピ探索",
  scan: "写真で在庫登録",
  import: "写真・動画からレシピ",
};

// ---- 枠が回復する期間（週） ----
//
// ⚠️ **クライアントとサーバーで必ず同じ答えになること**が要件。
//    クライアントは端末のタイムゾーン、サーバー(Vercel)はUTCで動くので、
//    素直に書くと最大9時間ズレて「画面は残り2回なのにサーバーは0回」になる。
//    旧・月次のときも同じズレが月末に1回だけ起きていた。週次にすると4倍の頻度で起きる。
//    なので **どちらの環境でも明示的にJSTへ寄せてから**週を決める。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * その時刻が属する週のキー。**JSTの月曜0:00始まり**。
 * 形式は `W2026-07-27`（その週の月曜の日付）。
 *
 * 旧・月次キー（`2026-08`）とは頭の `W` で確実に区別できる形にしてある。
 * 移行のとき、古い月次レコードと新しい週次レコードが同じ配列に並んでも取り違えない。
 */
export function weekKey(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const dow = (jst.getUTCDay() + 6) % 7; // 月曜=0 … 日曜=6
  const monday = new Date(jst.getTime() - dow * DAY_MS);
  return `W${monday.toISOString().slice(0, 10)}`;
}

/** 週次キーかどうか（＝旧・月次レコードと見分ける） */
export function isWeekKey(key: string): boolean {
  return /^W\d{4}-\d{2}-\d{2}$/.test(key);
}

/** 次に枠が戻るまであと何日か（0=今日中に戻る…ではなく「今日が月曜」の意味では使わない）。
 *  月曜0:00 JST が次の回復時刻。日曜なら1、月曜なら7を返す。 */
export function daysUntilQuotaReset(now: Date = new Date()): number {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const dow = (jst.getUTCDay() + 6) % 7; // 月曜=0
  return 7 - dow;
}

/** 枠の期間を指す言葉。画面とサーバーの文言を揃えるために1箇所に置く。 */
export const QUOTA_PERIOD_LABEL = "今週";
/** いつ戻るか。**枠切れの文言には必ずこれを添える**（「また来られる日」を伝えるのが目的）。 */
export const QUOTA_RESET_LABEL = "月曜";
