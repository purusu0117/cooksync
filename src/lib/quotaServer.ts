// AI無料枠の **サーバー側** 判定。原価が出る機能の可否はここだけで決める。
//
// なぜサーバーに置くか：
//   src/lib/usage.ts のカウンタは localStorage にあり、消せば復活する＝枠として機能しない。
//   公開したら「1人が無限にAIを叩ける」状態になり、原価を全部こちらが被る。
//
// 3つの軸で止める（1つ破られても次で止まる）:
//   ① uidごとの月間枠     … 通常のユーザー体験としての上限
//   ② IPごとの日次上限     … uidを作り直して枠をリセットする回避を潰す
//   ③ 全体の月間上限       … 最終防衛線（/api/research に既存のものをここへ集約）
//
// ⚠️ 現状 uid はクライアントが持つUUID（localStorage）なので **偽装できる**。
//    ①だけでは不十分で、だから②③がある。uidが偽装不能になるのは
//    Sign in with Apple / Google OAuth に移行した後（そのときは uid = OAuthのsubject）。
//    詳細は .secretary/Decisions/2026-07-31-cooksync-profitable-monetization.md

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { redis } from "./kv";
import { EST_YEN, monthYenSpent } from "./aiCost";

export type AiKind = "research" | "scan" | "import";

/**
 * 無料ユーザーの月間枠。
 *
 * ⚠️ **research はキャッシュミスのときしか減らない**（/api/research の①で共有プールを引き、
 *    当たれば原価0なので枠を消費しない）。つまりここの数字は「新規生成の回数」。
 *
 * 実測原価（1回あたり）: research ¥19.6 / scan ¥0.53 / import ¥12.8
 * 旧値は 3 / 5 / 2 だったが、日常使いには少なすぎて「課金しないと使えないアプリ」に
 * なっていた（大翔の指摘・2026-07-31）。原価に対して安全な範囲まで引き上げる。
 * 全体の損失は COOKSYNC_MONTHLY_BUDGET_YEN（既定¥3,000）で頭打ちになるので、
 * ここを緩めても青天井にはならない。
 */
export const FREE_LIMITS: Record<AiKind, number> = {
  research: 8, // 新規生成のみ。キャッシュヒットは無制限。最悪 ¥157/月
  scan: 25, // 原価が桁違いに安い（¥0.53）ので絞る意味が薄い。最悪 ¥13/月
  import: 5, // ¥12.8 × 5 = 最悪 ¥64/月
};

/** プレミアムのフェアユース上限（無制限にすると原価が手取りを超えるので必ず置く）。 */
export const PREMIUM_LIMITS: Record<AiKind, number> = {
  research: 60,
  scan: 300,
  import: 20,
};

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
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "usage-server.json");

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
  await fs.mkdir(DIR, { recursive: true });
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
function denyBudget(limit: number, premium: boolean): QuotaResult {
  return {
    ok: false,
    reason: "budget",
    used: 0,
    limit,
    remaining: 0,
    premium,
    message: "今月のAI利用が上限に達しました。来月またご利用ください。",
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
function denyUser(kind: AiKind, limit: number, premium: boolean): QuotaResult {
  return {
    ok: false,
    reason: "user",
    used: limit,
    limit,
    remaining: 0,
    premium,
    message: premium
      ? `今月の${KIND_LABEL[kind]}が上限（${limit}回）に達しました。来月またご利用ください。`
      : `今月の無料枠（${KIND_LABEL[kind]} ${limit}回）を使い切りました。`,
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

  const m = month();
  const d = day();
  const ipk = hashIp(clientIp(request));
  const id = uid && uid !== "anon" ? uid : `ip-${ipk}`; // 未ログインはIP単位で数える

  // ④ 金額の最終防衛線。**これから使う分を足しても予算内か**で判定するので上振れしない。
  //    原価ログは呼び出し後に付くため、事前の見積もり(EST_YEN)を足して先に見る。
  const spent = await monthYenSpent(m);
  if (spent + EST_YEN[kind] > monthlyBudgetYen()) return denyBudget(limit, premium);

  if (redis) {
    // ③ 全体の回数上限
    const gk = `cooksync:aiquota:${m}`;
    const g = await redis.incr(gk);
    if (g === 1) await redis.expire(gk, 40 * 24 * 3600);
    if (g > globalMonthlyCap()) return denyGlobal(limit, premium);

    // ② IP日次上限
    const ik = `cooksync:ipday:${ipk}:${d}`;
    const i = await redis.incr(ik);
    if (i === 1) await redis.expire(ik, 2 * 24 * 3600);
    if (i > ipDailyCap()) return denyIp(limit, premium);

    // ① uidごとの月間枠
    const uk = `cooksync:usage:${id}:${m}`;
    const used = await redis.hincrby(uk, kind, 1);
    if (used === 1) await redis.expire(uk, 70 * 24 * 3600);
    if (used > limit) {
      await redis.hincrby(uk, kind, -1); // 使わせないので戻す
      return denyUser(kind, limit, premium);
    }
    return { ok: true, used, limit, remaining: Math.max(0, limit - used), premium };
  }

  // ローカルでの強制（動作確認用）。Redis分岐と同じ判定・同じ文言を返す。
  const db = await readLocal();
  db.global[m] = (db.global[m] ?? 0) + 1;
  if (db.global[m] > globalMonthlyCap()) {
    await writeLocal(db);
    return denyGlobal(limit, premium);
  }
  const ikey = `${ipk}:${d}`;
  db.ip[ikey] = (db.ip[ikey] ?? 0) + 1;
  if (db.ip[ikey] > ipDailyCap()) {
    await writeLocal(db);
    return denyIp(limit, premium);
  }
  const ukey = `${id}:${m}`;
  const rec = (db.usage[ukey] ??= {});
  const used = (rec[kind] ?? 0) + 1;
  if (used > limit) {
    await writeLocal(db);
    return denyUser(kind, limit, premium);
  }
  rec[kind] = used;
  await writeLocal(db);
  return { ok: true, used, limit, remaining: Math.max(0, limit - used), premium };
}

/**
 * IP日次上限だけを見る軽量チェック。
 * 共有プールから返せるとき（＝AI原価が0のとき）に使う。原価が出ないのに月間枠を
 * 減らすのは筋が悪いので枠は消費せず、連打への最低限の歯止めだけかける。
 */
export async function checkIpOnly(request: Request): Promise<boolean> {
  if (!quotaEnforced()) return true;
  const ipk = hashIp(clientIp(request));
  const d = day();
  try {
    if (redis) {
      const k = `cooksync:ipday:${ipk}:${d}`;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, 2 * 24 * 3600);
      return n <= ipDailyCap();
    }
    const db = await readLocal();
    const key = `${ipk}:${d}`;
    db.ip[key] = (db.ip[key] ?? 0) + 1;
    const ok = db.ip[key] <= ipDailyCap();
    await writeLocal(db);
    return ok;
  } catch {
    return true; // 計測できないときは通す（本流を止めない）
  }
}

/** AI呼び出しが失敗したときに枠を戻す（ユーザーに損をさせない）。 */
export async function refund(uid: string, kind: AiKind, request: Request): Promise<void> {
  if (!quotaEnforced()) return;
  const m = month();
  const ipk = hashIp(clientIp(request));
  const id = uid && uid !== "anon" ? uid : `ip-${ipk}`;
  try {
    if (redis) {
      await redis.hincrby(`cooksync:usage:${id}:${m}`, kind, -1);
      return;
    }
    const db = await readLocal();
    const rec = db.usage[`${id}:${m}`];
    if (rec && rec[kind]) rec[kind] = Math.max(0, rec[kind] - 1);
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
  const m = month();
  if (redis) {
    const h = await redis.hgetall<Record<string, number>>(`cooksync:usage:${uid}:${m}`);
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
  const rec = db.usage[`${uid}:${m}`] ?? {};
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
        `今月の${KIND_LABEL[kind]}の枠（${q.limit}回）を使い切りました。`,
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
