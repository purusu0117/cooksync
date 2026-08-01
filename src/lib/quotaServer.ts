// AI無料枠の **サーバー側** 判定。原価が出る機能の可否はここだけで決める。
//
// なぜサーバーに置くか：
//   src/lib/usage.ts のカウンタは localStorage にあり、消せば復活する＝枠として機能しない。
//   公開したら「1人が無限にAIを叩ける」状態になり、原価を全部こちらが被る。
//
// 3つの軸で止める（1つ破られても次で止まる）:
//   ① uidごとの**週間**枠  … 通常のユーザー体験としての上限（2026-08-01に月次から変更）
//   ② IPごとの日次上限     … uidを作り直して枠をリセットする回避を潰す
//   ③ 全体の月間上限       … 最終防衛線（/api/research に既存のものをここへ集約）
//
// ⚠️ **①だけが週次。②は日次、③④(予算)は月次のまま。**
//    ①はユーザー体験の話（「また来週使える」と言えるようにする）で、
//    ③④は「1ヶ月に出ていく金額」の話。混ぜると、週の変わり目に予算が4回リセットされて
//    月の支出が4倍になる。期間を変えたのはユーザー枠だけ、というのがこの変更の要点。
//
// ⚠️ 現状 uid はクライアントが持つUUID（localStorage）なので **偽装できる**。
//    ①だけでは不十分で、だから②③がある。uidが偽装不能になるのは
//    Sign in with Apple / Google OAuth に移行した後（そのときは uid = OAuthのsubject）。
//    詳細は .secretary/Decisions/2026-07-31-cooksync-profitable-monetization.md

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { redis } from "./kv";
import { EST_YEN, monthYenSpent, preChargeYen, releasePreChargeYen } from "./aiCost";
import { PREMIUM_AI_COST_CAP_YEN } from "./pricing";
import {
  FREE_LIMITS,
  PREMIUM_LIMITS,
  QUOTA_PERIOD_LABEL,
  QUOTA_RESET_LABEL,
  weekKey,
  type AiKind,
} from "./aiLimits";

// 枠の数字と期間の定義は src/lib/aiLimits.ts に一本化（画面表示側 usage.ts と同じものを読む）。
export type { AiKind } from "./aiLimits";
export { FREE_LIMITS, PREMIUM_LIMITS } from "./aiLimits";

export const KIND_LABEL: Record<AiKind, string> = {
  research: "AIレシピ探索",
  scan: "写真で在庫登録",
  import: "写真・動画からレシピ",
};

// ⚠️ 上限値は**呼び出しのたびに env を読む**（モジュール読み込み時に固定しない）。
//    固定すると、環境変数を変えてもプロセスを再起動するまで効かず、テストでも差し替えられない。

/** 同一IPからの1日あたりAI呼び出し上限。uid作り直しによる枠リセットを潰す。
 *  家庭内の共有IPやモバイルのCGNATで実ユーザーを巻き込まない水準にする。 */
function ipDailyCap(): number {
  return Number(process.env.COOKSYNC_IP_DAILY_CAP) || 30;
}

/** 全体の月間**回数**上限（最終防衛線）。既存の COOKSYNC_MONTHLY_AI_CAP を踏襲。 */
function globalMonthlyCap(): number {
  return Number(process.env.COOKSYNC_MONTHLY_AI_CAP) || 300;
}

/**
 * 全体の月間**金額**上限（円）。回数上限より正確な最終防衛線。
 *
 * なぜ金額でも要るか：1回の原価は機能によって40倍違う（写真スキャン¥0.5 ↔ レシピ探索¥20）。
 * 「300回」だと、内訳次第で実際の支出が¥150にも¥6,000にもなる＝上限として意味をなさない。
 *
 * ⚠️ Anthropic Console の支出上限は **組織(Organization)単位** なので、
 *    同じ組織の他プロジェクト（CashSync等）と食い合う。
 *    **CookSync単体を止めるのはこの設定の役目**。組織側の設定に依存しない。
 *    （組織側で分けたい場合は Workspace ごとにAPIキーと上限を分ける）
 */
export function monthlyBudgetYen(): number {
  return Number(process.env.COOKSYNC_MONTHLY_BUDGET_YEN) || 3000;
}

/** 枠を実際に強制するか。
 *  既定は「公開時(redis有り)のみ」＝大翔のローカル(claude.exe spawn・原価0)は対象外。
 *  COOKSYNC_ENFORCE_QUOTA=1 でローカルでも強制できる（動作確認用）。 */
export function quotaEnforced(): boolean {
  if (process.env.COOKSYNC_ENFORCE_QUOTA === "1") return true;
  // 枠が要るのは **AIの利用料が発生するときだけ**。
  // ローカル版は claude.exe（Max枠）を叩くので1円も掛からず、数える意味が無い。
  // 以前は `!!redis` で判定していたが、Redisは保存先の話であって課金の話ではないので、
  // ローカルでRedisを繋いだ途端に上限が掛かってしまう作りだった。
  return !!process.env.ANTHROPIC_API_KEY;
}

function month(): string {
  return new Date().toISOString().slice(0, 10).slice(0, 7); // YYYY-MM
}
function day(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * ユーザー枠のカウンタキーに使う**期間**。2026-08-01 から週（JSTの月曜始まり）。
 * 定義は aiLimits.weekKey に置いてある（クライアント表示 usage.ts と**同じ関数**を読む）。
 */
function period(): string {
  return weekKey();
}

/** ユーザー枠キーのTTL。1週ぶん + 前週を見返す余地 + 時差の安全マージン。 */
const USER_QUOTA_TTL_SEC = 21 * 24 * 3600;

/**
 * AI利用カウンタのキーに使う**期間サフィックスの一覧**。アカウント削除で使う。
 *
 * ⚠️ 名前は `recentUsageMonths` のままだが、**月次キーと週次キーの両方**を返す。
 *    2026-08-01にユーザー枠を月次→週次へ移したとき、ここを月だけのままにしていると
 *    **アカウント削除で新しい週次カウンタが消し残る**（＝削除したはずの利用履歴が残る）。
 *    呼び出し側（/api/account/delete）は「返ってきた分だけ消す」作りなので、
 *    ここを広げるだけで削除側は無改修で追随する。
 *
 * ⚠️ 月の計算は month() と同じ基準（UTC）で作る。
 *    アカウント削除側で `new Date(y, m-1, 1).toISOString()` と書いていたため、
 *    JSTの1日0時がUTCで前日に巻き戻り、**常に「2ヶ月前」**を指していた。
 *    結果、前月のカウンタが一度も消えず残っていた（2026-08-01 監査 H-10(b)）。
 */
export function recentUsageMonths(): string[] {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  // 週次キーは直近4週ぶん（TTL 21日で自然消滅する範囲を全部カバーする）
  const weeks = [0, 1, 2, 3].map((i) => weekKey(new Date(now.getTime() - i * 7 * 86_400_000)));
  return [month(), prev.toISOString().slice(0, 7), ...weeks];
}

/** IPは生で保存しない（個人情報）。ソルト付きハッシュで持つ。
 *  ⚠️ 既定ソルトは**公開リポジトリに載っている**ので、公開時は必ず
 *     COOKSYNC_IP_SALT を設定すること。既定のままだとIPv4は総当たりで逆引きできる。 */
function hashIp(ip: string): string {
  const salt = process.env.COOKSYNC_IP_SALT || "cooksync-default-salt";
  return createHash("sha256").update(salt).update(ip).digest("hex").slice(0, 24);
}

/** リクエストから発信元IPを取り出す（Vercelは x-forwarded-for の先頭）。 */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

// ---- ローカル(ファイル)フォールバック ----
// 保存先。COOKSYNC_DATA_DIR で差し替えられる（テストが大翔の実データを壊さないため）。
// ⚠️ モジュール読み込み時に固定すると、テストが環境変数を設定する前に確定してしまい、
//    **実際に .data/ の中身が消える事故が起きた**（2026-08-01・監査で発覚）。呼び出しごとに読む。
function dataDir(): string {
  return process.env.COOKSYNC_DATA_DIR || path.join(process.cwd(), ".data");
}
const FILE = path.join(dataDir(), "usage-server.json");

interface LocalDb {
  usage: Record<string, Record<string, number>>; // "<uid>:<YYYY-MM>" -> {kind: n}
  ip: Record<string, number>; // "<ipHash>:<YYYY-MM-DD>" -> n
  global: Record<string, number>; // "<YYYY-MM>" -> n
  premium: string[];
}

async function readLocal(): Promise<LocalDb> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as Partial<LocalDb>;
    return {
      usage: raw.usage ?? {},
      ip: raw.ip ?? {},
      global: raw.global ?? {},
      premium: raw.premium ?? [],
    };
  } catch {
    return { usage: {}, ip: {}, global: {}, premium: [] };
  }
}

async function writeLocal(db: LocalDb): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(db), "utf8");
}

/** プレミアム判定。今は運用でRedisのSetに入れる想定（StoreKit連携は配信時）。 */
export async function isPremium(uid: string): Promise<boolean> {
  if (!uid || uid === "anon") return false;
  if (redis) return (await redis.sismember("cooksync:premium", uid)) === 1;
  const db = await readLocal();
  return db.premium.includes(uid);
}

export interface QuotaResult {
  ok: boolean;
  /** 拒否理由。UIのメッセージ出し分け用 */
  reason?: "user" | "ip" | "global" | "budget";
  used: number;
  limit: number;
  remaining: number;
  premium: boolean;
  message?: string;
}

// 拒否の返り値。Redis分岐とローカル分岐で文言がズレないよう1箇所にまとめる。
function denyGlobal(limit: number, premium: boolean): QuotaResult {
  return {
    ok: false,
    reason: "global",
    used: 0,
    limit,
    remaining: 0,
    premium,
    message: "ただいまAI機能が混み合っています。時間をおいてお試しください。",
  };
}
/**
 * 予算上限のときの文言。
 *
 * ⚠️ **これはユーザー個人の枠切れではない。** サービス全体の月間予算
 *    （COOKSYNC_MONTHLY_BUDGET_YEN・既定¥3,000）に当たった状態で、原因はこちら側にある。
 *    枠を週次にしたあとも「今月のAI利用が上限に達しました」のままだったので、
 *    **自分の週次枠がまだ残っている人にも「お前がもう使い切った」と読める**文言だった。
 *    主語をこちら側に戻し、いつ戻るかも書く。
 */
const BUDGET_MESSAGE =
  "ただいまAI機能の提供上限に達しています（アプリ側の都合です）。翌月1日に再開します。";

/**
 * 支出額が**読めない**ときの文言。
 *
 * ⚠️ 以前は monthYenSpent が失敗時に 0 を返し、Redis障害中は「1円も使っていない」扱いで
 *    **¥3,000 の天井が静かに消えていた**（2026-08-01 監査 2）。
 *    いくら使ったか分からない状態でAIを回すと損失に上限が無くなるので、fail-closed＝止める。
 *    「翌月1日に再開」は嘘になる（障害が直れば再開する）ので、文言も分ける。
 */
const BUDGET_UNKNOWN_MESSAGE =
  "ただいまAIの利用状況を確認できないため、一時的に停止しています。時間をおいてお試しください。";

function denyBudget(limit: number, premium: boolean, message = BUDGET_MESSAGE): QuotaResult {
  return {
    ok: false,
    reason: "budget",
    used: 0,
    limit,
    remaining: 0,
    premium,
    message,
  };
}
function denyIp(limit: number, premium: boolean): QuotaResult {
  return {
    ok: false,
    reason: "ip",
    used: 0,
    limit,
    remaining: 0,
    premium,
    message: "この回線からのAI利用が今日の上限に達しました。明日またお試しください。",
  };
}
/**
 * 枠切れの文言。**「いつ戻るか」を必ず書く。**
 *
 * 月次のころは「来月またご利用ください」＝最悪3週間先で、実質「もう来なくていい」だった。
 * 週次にした一番の目的は、断るときに **「月曜にまた2回使えます」と言えること**。
 * 断り文句を再訪の約束に変える。
 * ⚠️ この文言は usage.quotaMessage と1字一句そろえること（テストで固定してある）。
 */
function denyUser(kind: AiKind, limit: number, premium: boolean): QuotaResult {
  return {
    ok: false,
    reason: "user",
    used: limit,
    limit,
    remaining: 0,
    premium,
    message: premium
      ? `${QUOTA_PERIOD_LABEL}の${KIND_LABEL[kind]}が上限（${limit}回）に達しました。${QUOTA_RESET_LABEL}になると、また${limit}回使えます。`
      : `${QUOTA_PERIOD_LABEL}の無料枠（${KIND_LABEL[kind]} ${limit}回）を使い切りました。${QUOTA_RESET_LABEL}になると、また${limit}回使えます。`,
  };
}

/**
 * 枠を1つ消費する。**AIを呼ぶ前に呼び、ok:false ならAIを呼ばない。**
 * 消費してからAIが失敗した場合は refund() で戻す。
 */
export async function consume(
  uid: string,
  kind: AiKind,
  request: Request,
): Promise<QuotaResult> {
  const premium = await isPremium(uid);
  const limit = premium ? PREMIUM_LIMITS[kind] : FREE_LIMITS[kind];

  if (!quotaEnforced()) {
    // ローカル開発：原価が出ないので数えるだけ無駄。素通しする。
    return { ok: true, used: 0, limit, remaining: limit, premium };
  }

  const m = month(); // ③全体の回数・④予算は**月**のまま（金額の話なので週にしない）
  const p = period(); // ①ユーザー枠は**週**
  const d = day();
  const ipk = hashIp(clientIp(request));
  const id = uid && uid !== "anon" ? uid : `ip-${ipk}`; // 未ログインはIP単位で数える

  // ④ 金額の最終防衛線。**これから使う分を足しても予算内か**で判定するので上振れしない。
  //    原価ログは呼び出し後に付くため、事前の見積もり(EST_YEN)を足して先に見る。
  //    支出額が読めない（null）ときは fail-closed＝止める（監査 2）。
  const spent = await monthYenSpent(m);
  if (spent === null) return denyBudget(limit, premium, BUDGET_UNKNOWN_MESSAGE);
  if (spent + EST_YEN[kind] > monthlyBudgetYen()) return denyBudget(limit, premium);

  // ①b プレミアムの**1人あたり月間原価上限**（¥220・pricing.PREMIUM_AI_COST_CAP_YEN）。
  //    採算の要：¥480の手取り¥371に対し、枠フル使用の原価は¥1,730＝回数だけでは赤字。
  //    回数上限は「使い方の目安」、こちらが「お金の上限」（設計は pricing.ts のコメント）。
  //    見積もり(EST_YEN)ベースで数える＝安全側。無料ユーザーには掛けない
  //    （無料の週次枠をフルに使うと月¥296 > ¥220 で、正当な利用を止めてしまうため。
  //      無料側の上限は週次枠そのものが担っている）。
  const capMsg = `今月の${KIND_LABEL[kind]}が公平利用の上限に達しました。来月1日に戻ります。`;
  const denyUserCap = (): QuotaResult => ({
    ok: false,
    reason: "user",
    used: limit,
    limit,
    remaining: 0,
    premium,
    message: capMsg,
  });

  // ⚠️ **判定は内側（ユーザー）から外側（全体）の順に行い、拒否したら必ず戻す。**
  //    以前は外側の「全体の月間回数」を最初に incr していて、**拒否しても戻していなかった**。
  //    そのため枠切れのユーザーが連打するだけで全体カウンタが積み上がり、
  //    原価が1円も出ていないのに 300回で**全ユーザーのAI機能が月末まで止まった**
  //    （2026-08-01 監査 H-2）。1人の連打で全員を巻き込むのは防御ではなく自爆。
  if (redis) {
    // ① uidごとの週間枠（一番内側＝その人だけの話）
    // 旧・月次キー（cooksync:usage:<id>:2026-08）は放置してよい。TTL 70日で自然に消え、
    // 新しい週次キーとは名前が違うので**取り違えない**。移行のために消す作業は不要。
    const uk = `cooksync:usage:${id}:${p}`;
    const used = await redis.hincrby(uk, kind, 1);
    if (used === 1) await redis.expire(uk, USER_QUOTA_TTL_SEC);
    if (used > limit) {
      await redis.hincrby(uk, kind, -1); // 使わせないので戻す
      return denyUser(kind, limit, premium);
    }

    // ①b プレミアムの1人あたり月間原価上限（見積もりベース・月次）
    const ck = `cooksync:uyen:${id}:${m}`;
    if (premium) {
      const cy = Number(await redis.incrbyfloat(ck, EST_YEN[kind]));
      if (cy <= EST_YEN[kind] + 1e-9) await redis.expire(ck, 70 * 24 * 3600);
      if (cy > PREMIUM_AI_COST_CAP_YEN) {
        await redis.incrbyfloat(ck, -EST_YEN[kind]);
        await redis.hincrby(uk, kind, -1);
        return denyUserCap();
      }
    }
    const rollbackCap = async () => {
      if (premium) await redis!.incrbyfloat(ck, -EST_YEN[kind]);
    };

    // ② IP日次上限
    const ik = `cooksync:ipday:${ipk}:${d}`;
    const i = await redis.incr(ik);
    if (i === 1) await redis.expire(ik, 2 * 24 * 3600);
    if (i > ipDailyCap()) {
      await redis.decr(ik);
      await rollbackCap();
      await redis.hincrby(uk, kind, -1);
      return denyIp(limit, premium);
    }

    // ③ 全体の回数上限（最終防衛線。**実際に使わせるものだけ数える**）
    const gk = `cooksync:aiquota:${m}`;
    const g = await redis.incr(gk);
    if (g === 1) await redis.expire(gk, 40 * 24 * 3600);
    if (g > globalMonthlyCap()) {
      await redis.decr(gk);
      await redis.decr(ik);
      await rollbackCap();
      await redis.hincrby(uk, kind, -1);
      return denyGlobal(limit, premium);
    }

    // ⑤ 見積もり額を**先に計上**する（バースト超過対策・監査 6）。
    //    これで同時に来た次のリクエストの④に、この1回ぶんの見積もりが見える。
    //    計上できない＝支出を追えなくなるので、通さずに全カウンタを戻す。
    if (!(await preChargeYen(kind))) {
      await redis.decr(gk);
      await redis.decr(ik);
      await rollbackCap();
      await redis.hincrby(uk, kind, -1);
      return denyBudget(limit, premium, BUDGET_UNKNOWN_MESSAGE);
    }
    return { ok: true, used, limit, remaining: Math.max(0, limit - used), premium };
  }

  // ローカルでの強制（動作確認用）。Redis分岐と同じ順序・同じ文言を返す。
  // ローカルは read-modify-write なので、**通ったときだけ**まとめて書けばロールバック不要。
  const db = await readLocal();
  const ukey = `${id}:${p}`;
  const rec = (db.usage[ukey] ??= {});
  const used = (rec[kind] ?? 0) + 1;
  if (used > limit) return denyUser(kind, limit, premium);

  // ①b プレミアムの1人あたり月間原価上限（Redis分岐と同じ。通ったときだけ最後に書く）
  const capKey = `uyen:${id}:${m}`;
  const capYen = (db.ip[capKey] ?? 0) + EST_YEN[kind];
  if (premium && capYen > PREMIUM_AI_COST_CAP_YEN) return denyUserCap();

  const ikey = `${ipk}:${d}`;
  const ipCount = (db.ip[ikey] ?? 0) + 1;
  if (ipCount > ipDailyCap()) return denyIp(limit, premium);

  const globalCount = (db.global[m] ?? 0) + 1;
  if (globalCount > globalMonthlyCap()) return denyGlobal(limit, premium);

  // 見積もり額の事前計上（Redis分岐の⑤と同じ理由）。失敗したら書かずに止める。
  if (!(await preChargeYen(kind))) return denyBudget(limit, premium, BUDGET_UNKNOWN_MESSAGE);

  rec[kind] = used;
  if (premium) db.ip[capKey] = capYen;
  db.ip[ikey] = ipCount;
  db.global[m] = globalCount;
  await writeLocal(db);
  return { ok: true, used, limit, remaining: Math.max(0, limit - used), premium };
}

/**
 * IP日次上限だけを見る軽量チェック。
 * 共有プールから返せるとき（＝AI原価が0のとき）に使う。原価が出ないのに月間枠を
 * 減らすのは筋が悪いので枠は消費せず、連打への最低限の歯止めだけかける。
 */
/** 補助AI（suggest/proofread/estimate-expiry）の、1人あたり日次上限。 */
function textDailyCap(): number {
  return Number(process.env.COOKSYNC_TEXT_DAILY_CAP) || 30;
}

/**
 * 補助AIの**利用者ごと**の日次カウンタ。+1して上限内なら true。
 *
 * ⚠️ 以前この3ルートの制限はIP日次上限（全AI共用・30/日）だけだった（監査 4・5）。
 *    CGNATや共有回線では「攻撃者には緩すぎ、同居人には厳しすぎる」ので、
 *    利用者単位（uid、無ければIP）でも別に数える。uidは偽装できるが、
 *    偽装してuidを回しても外側のIP日次上限と月間予算で止まる（防御の多層は維持）。
 */
async function bumpTextDaily(id: string): Promise<boolean> {
  const d = day();
  try {
    if (redis) {
      const k = `cooksync:textday:${id}:${d}`;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, 2 * 24 * 3600);
      if (n > textDailyCap()) {
        await redis.decr(k);
        return false;
      }
      return true;
    }
    const db = await readLocal();
    const key = `text:${id}:${d}`;
    const n = (db.ip[key] ?? 0) + 1;
    if (n > textDailyCap()) return false;
    db.ip[key] = n;
    await writeLocal(db);
    return true;
  } catch {
    return true; // 数えられないときは通す（この経路の上限はまだ予算とIPが残る）
  }
}

async function unbumpTextDaily(id: string): Promise<void> {
  const d = day();
  try {
    if (redis) {
      await redis.decr(`cooksync:textday:${id}:${d}`);
      return;
    }
    const db = await readLocal();
    const key = `text:${id}:${d}`;
    if (db.ip[key]) db.ip[key] = Math.max(0, db.ip[key] - 1);
    await writeLocal(db);
  } catch {
    /* 戻せなくても致命傷ではない */
  }
}

/**
 * ユーザー枠を持たないAI経路の防御。**月間予算 → 利用者日次 → IP日次** の順に見る。
 *
 * ⚠️ これが無かったせいで、AIを呼ぶ7つのAPIのうち4つ
 *    （suggest / estimate-expiry / proofread / import-video）が
 *    **月間予算¥3,000の上限を完全に迂回していた**（2026-08-01 監査で発覚）。
 *    予算チェックは consume() の中にしか無く、consume を通らない経路は無防備だった。
 *    ＝「損失は¥3,000で頭打ち」という前提そのものが成立していなかった。
 *
 * @param estYen この呼び出しの見積もり原価（円）。予算判定に足して先に見る。
 *               estimate-expiry のように件数で原価が変わる経路は、呼び出し側でスケールさせる。
 * @param uid 利用者ID（`x-cooksync-uid` ヘッダ等）。無ければIP単位で数える。
 */
export async function guardAi(
  request: Request,
  estYen: number,
  uid?: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!quotaEnforced()) return { ok: true };

  // 支出額が読めないときは fail-closed（監査 2。consume の④と同じ向き）
  const spent = await monthYenSpent(month());
  if (spent === null) return { ok: false, message: BUDGET_UNKNOWN_MESSAGE };
  if (spent + estYen > monthlyBudgetYen()) {
    return { ok: false, message: BUDGET_MESSAGE };
  }

  const id = uid && uid !== "anon" ? uid : `ip-${hashIp(clientIp(request))}`;
  if (!(await bumpTextDaily(id))) {
    return {
      ok: false,
      message: "本日のAI補助機能の利用が上限に達しました。明日またお試しください。",
    };
  }

  if (!(await checkIpOnly(request))) {
    await unbumpTextDaily(id); // 使わせなかった分は戻す（consume と同じ方針）
    return {
      ok: false,
      message: "この回線からのAI利用が今日の上限に達しました。明日またお試しください。",
    };
  }

  // 見積もり額の事前計上（バースト超過対策・監査 6）。計上できなければ止める。
  if (!(await preChargeYen("text", estYen))) {
    await unbumpTextDaily(id);
    return { ok: false, message: BUDGET_UNKNOWN_MESSAGE };
  }
  return { ok: true };
}

/**
 * ログイン試行のレート制限（総当たり対策）。
 *
 * ⚠️ 監査（2026-08-01）まで **試行回数の制限も遅延も一切無かった**。
 *    パスワードは8文字以上という条件しかないので、辞書攻撃を延々と試せる状態だった。
 *    scrypt で保存しているので漏れても即解読はされないが、
 *    「何回でも試せる」こと自体が穴なので入口で止める。
 *
 * IPごとに15分あたり `limit` 回まで。超えたら false。
 * 数えられない（Redis障害等）ときは通す＝ログインできなくなる方が困るため。
 *
 * ⚠️ **課金枠のスイッチ（quotaEnforced）に相乗りしてはいけない**（2026-08-01 監査 H-1）。
 *    quotaEnforced() は `ANTHROPIC_API_KEY` の有無で決まる＝AI原価の話であって認証の話ではない。
 *    そこにぶら下げていたせいで、キー未設定の環境では総当たり制限が**丸ごと無効**だった。
 *    認証の防御は原価と無関係に **常時有効**にする。
 */
export async function checkLoginAttempt(request: Request, limit = 10): Promise<boolean> {
  const ipk = hashIp(clientIp(request));
  // 15分の窓。エポックを900秒で割って窓IDにする（スライドではないが十分）
  const win = Math.floor(Date.now() / (15 * 60 * 1000));
  try {
    if (redis) {
      const k = `cooksync:login:${ipk}:${win}`;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, 16 * 60);
      return n <= limit;
    }
    const db = await readLocal();
    const key = `login:${ipk}:${win}`;
    db.ip[key] = (db.ip[key] ?? 0) + 1;
    const ok = db.ip[key] <= limit;
    await writeLocal(db);
    return ok;
  } catch {
    return true;
  }
}

export async function checkIpOnly(request: Request): Promise<boolean> {
  if (!quotaEnforced()) return true;
  const ipk = hashIp(clientIp(request));
  const d = day();
  try {
    if (redis) {
      const k = `cooksync:ipday:${ipk}:${d}`;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, 2 * 24 * 3600);
      // 拒否した分は戻す（consume と同じ方針。使わせなかった呼び出しは数えない）
      if (n > ipDailyCap()) {
        await redis.decr(k);
        return false;
      }
      return true;
    }
    const db = await readLocal();
    const key = `${ipk}:${d}`;
    const n = (db.ip[key] ?? 0) + 1;
    if (n > ipDailyCap()) return false; // 増やさずに拒否
    db.ip[key] = n;
    await writeLocal(db);
    return true;
  } catch {
    return true; // 計測できないときは通す（本流を止めない）
  }
}

/** AI呼び出しが失敗したときに枠を戻す（ユーザーに損をさせない）。 */
export async function refund(uid: string, kind: AiKind, request: Request): Promise<void> {
  if (!quotaEnforced()) return;
  // AIを呼ばずに終わった（＝原価が出ていない）ので、事前計上した見積もりも取り消す。
  // すでに logAiCost が実測で置き換えた後なら何もしない（FIFOが空）。
  await releasePreChargeYen(kind);
  const p = period();
  const m = month();
  const ipk = hashIp(clientIp(request));
  const id = uid && uid !== "anon" ? uid : `ip-${ipk}`;
  try {
    // プレミアムの月間原価カウンタ（①b）も見積もりぶん戻す（使っていないので）
    const prem = await isPremium(uid);
    if (redis) {
      await redis.hincrby(`cooksync:usage:${id}:${p}`, kind, -1);
      if (prem) await redis.incrbyfloat(`cooksync:uyen:${id}:${m}`, -EST_YEN[kind]);
      return;
    }
    const db = await readLocal();
    const rec = db.usage[`${id}:${p}`];
    if (rec && rec[kind]) rec[kind] = Math.max(0, rec[kind] - 1);
    if (prem) {
      const capKey = `uyen:${id}:${m}`;
      if (db.ip[capKey]) db.ip[capKey] = Math.max(0, db.ip[capKey] - EST_YEN[kind]);
    }
    await writeLocal(db);
  } catch {
    /* 戻せなくても致命傷ではない */
  }
}

/** 現在の残量を返す（UI表示用。消費はしない）。 */
export async function peek(uid: string): Promise<{
  premium: boolean;
  limits: Record<AiKind, number>;
  used: Record<AiKind, number>;
}> {
  const premium = await isPremium(uid);
  const limits = premium ? PREMIUM_LIMITS : FREE_LIMITS;
  const empty: Record<AiKind, number> = { research: 0, scan: 0, import: 0 };
  if (!quotaEnforced() || !uid || uid === "anon") {
    return { premium, limits, used: empty };
  }
  const p = period();
  if (redis) {
    const h = await redis.hgetall<Record<string, number>>(`cooksync:usage:${uid}:${p}`);
    return {
      premium,
      limits,
      used: {
        research: Number(h?.research ?? 0),
        scan: Number(h?.scan ?? 0),
        import: Number(h?.import ?? 0),
      },
    };
  }
  const db = await readLocal();
  const rec = db.usage[`${uid}:${p}`] ?? {};
  return {
    premium,
    limits,
    used: {
      research: rec.research ?? 0,
      scan: rec.scan ?? 0,
      import: rec.import ?? 0,
    },
  };
}

/** 枠切れの 429 レスポンスを組み立てる（各APIで同じ形を返すため）。 */
export function quotaResponse(q: QuotaResult, kind: AiKind): Response {
  return Response.json(
    {
      error:
        q.message ??
        `${QUOTA_PERIOD_LABEL}の${KIND_LABEL[kind]}の枠（${q.limit}回）を使い切りました。`,
      quota: {
        kind,
        reason: q.reason,
        used: q.used,
        limit: q.limit,
        premium: q.premium,
      },
    },
    { status: 429 },
  );
}
