// AI原価の**実測**ログ。
//
// なぜ要るか：収益プラン（無料枠・プレミアム上限・広告の必要本数）は全部「1回いくらか」から
// 逆算している。そこが見積もりのままだと、プラン全体が机上の空論で終わる。
// 1リクエストごとに Anthropic が返す usage を記録して、実測で語れるようにする。
//
// 料金は 2026-07-31 時点の Anthropic 公式値。改定されたら PRICE を直す。
// 参照: .secretary/Decisions/2026-07-31-cooksync-profitable-monetization.md §1

import { promises as fs } from "fs";
import path from "path";
import { redis } from "./kv";

/** 100万トークンあたりのUSD単価 */
interface ModelPrice {
  input: number;
  output: number;
}

const PRICE: Record<string, ModelPrice> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** 未知のモデルIDが来たときの安全側（高い方）の単価。0円扱いにして油断しない。 */
const FALLBACK_PRICE: ModelPrice = { input: 5, output: 25 };

/** web_search ツールは $10 / 1,000回（トークン課金とは別建て） */
const WEB_SEARCH_USD = 10 / 1000;

/** プロンプトキャッシュ：読み出しは入力の0.1倍、書き込みは1.25倍（5分TTL） */
const CACHE_READ_RATE = 0.1;
const CACHE_WRITE_RATE = 1.25;

/** 為替。実請求はUSDなので、円表示はあくまで運用の目安。 */
function usdJpy(): number {
  return Number(process.env.COOKSYNC_USD_JPY) || 155;
}

export type AiFeature = "research" | "scan" | "import" | "text";

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
  webSearches?: number;
  /** トークンが分からないとき用の円建て見積もり。設定されていればこれを原価として使う
   *  （タイムアウトで usage が取れないが課金は発生している場合。監査 高-8）。 */
  estYen?: number;
}

/** 1回のAI呼び出しのUSD原価 */
export function costUsd(u: AiUsage): number {
  const p = PRICE[u.model] ?? FALLBACK_PRICE;
  const m = 1_000_000;
  return (
    (u.inputTokens / m) * p.input +
    (u.outputTokens / m) * p.output +
    ((u.cacheReadTokens ?? 0) / m) * p.input * CACHE_READ_RATE +
    ((u.cacheCreateTokens ?? 0) / m) * p.input * CACHE_WRITE_RATE +
    (u.webSearches ?? 0) * WEB_SEARCH_USD
  );
}

/** 1回のAI呼び出しの円原価（表示・上限設計用） */
export function costYen(u: AiUsage): number {
  // 見積もりが入っているときはそれを使う（トークンが取れない＝タイムアウト時）
  if (typeof u.estYen === "number" && u.estYen > 0) return u.estYen;
  return costUsd(u) * usdJpy();
}

/** Anthropic SDK のレスポンスから usage を取り出す（型に依存しすぎない形で） */
export function usageFrom(model: string, msg: unknown): AiUsage {
  const u = (msg as { usage?: Record<string, unknown> })?.usage ?? {};
  const n = (v: unknown): number => (typeof v === "number" ? v : 0);
  const server = u.server_tool_use as { web_search_requests?: unknown } | undefined;
  return {
    model,
    inputTokens: n(u.input_tokens),
    outputTokens: n(u.output_tokens),
    cacheReadTokens: n(u.cache_read_input_tokens),
    cacheCreateTokens: n(u.cache_creation_input_tokens),
    webSearches: n(server?.web_search_requests),
  };
}

// ---- 保存層 ----
// 保存先。COOKSYNC_DATA_DIR で差し替えられる（テストが大翔の実データを壊さないため）。
// ⚠️ モジュール読み込み時に固定すると、テストが環境変数を設定する前に確定してしまい、
//    **実際に .data/ の中身が消える事故が起きた**（2026-08-01・監査で発覚）。呼び出しごとに読む。
function dataDir(): string {
  return process.env.COOKSYNC_DATA_DIR || path.join(process.cwd(), ".data");
}
const FILE = path.join(dataDir(), "ai-cost.json");
const RECENT_MAX = 50;

export interface FeatureStat {
  calls: number;
  yen: number;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
}

export interface CostSummary {
  month: string;
  total: FeatureStat;
  byFeature: Record<string, FeatureStat>;
  /** 直近の生ログ（スポット確認用） */
  recent: { at: string; feature: string; model: string; yen: number }[];
}

function emptyStat(): FeatureStat {
  return { calls: 0, yen: 0, inputTokens: 0, outputTokens: 0, webSearches: 0 };
}

function addStat(s: FeatureStat, u: AiUsage, yen: number): FeatureStat {
  return {
    calls: s.calls + 1,
    yen: s.yen + yen,
    inputTokens: s.inputTokens + u.inputTokens,
    outputTokens: s.outputTokens + u.outputTokens,
    webSearches: s.webSearches + (u.webSearches ?? 0),
  };
}

function month(): string {
  return new Date().toISOString().slice(0, 7);
}

async function readFile(): Promise<Record<string, CostSummary>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

/**
 * 1回分を記録する。**失敗しても本流を止めない**（計測のためにユーザー体験を壊さない）。
 * ローカルのCLI経路は原価0なので呼ばない。
 */
/**
 * AI呼び出しが**タイムアウト/例外で終わったとき**の原価を、見積もりで記録する。
 *
 * ⚠️ これが無いと月間予算の上限が静かに破られる（2026-08-01 の監査 高-8）。
 * `logAiCost` は成功した応答の usage からしか計上できないが、タイムアウトしても
 * Anthropic側の生成は完走していることが多く、**課金は発生している**。
 * さらに maxRetries により1回自動再実行されるので、1操作で最大2回分が未記録で課金される。
 * 実測が取れない以上、**見積もり(EST_YEN)で記録して安全側に倒す**。
 * 少なく見積もって上限を破るより、多めに数えて早く止まる方がよい。
 */
export async function logAiCostEstimated(feature: AiFeature): Promise<void> {
  const yen = EST_YEN[feature] ?? 0;
  if (yen <= 0) return;
  // 円だけを積む（トークン数は分からないので0のまま）
  await logAiCost(feature, { model: "unknown-timeout", inputTokens: 0, outputTokens: 0, estYen: yen });
}

export async function logAiCost(feature: AiFeature, u: AiUsage): Promise<number> {
  const yen = costYen(u);
  // 事前計上（preChargeYen）があれば、見積もりを実測で置き換える＝**差分だけ**足す。
  // 事前計上が無い呼び出し（テスト等）では est=0 になり、従来どおり全額を足す。
  const est = prepaid[feature].shift() ?? 0;
  const delta = yen - est;
  const m = month();
  try {
    if (redis) {
      const k = `cooksync:cost:${m}`;
      await Promise.all([
        redis.hincrby(k, "calls", 1),
        redis.hincrbyfloat(k, "yen", delta),
        redis.hincrby(k, "inputTokens", u.inputTokens),
        redis.hincrby(k, "outputTokens", u.outputTokens),
        redis.hincrby(k, "webSearches", u.webSearches ?? 0),
        redis.hincrby(k, `${feature}:calls`, 1),
        redis.hincrbyfloat(k, `${feature}:yen`, delta),
        redis.hincrby(k, `${feature}:inputTokens`, u.inputTokens),
        redis.hincrby(k, `${feature}:outputTokens`, u.outputTokens),
        redis.hincrby(k, `${feature}:webSearches`, u.webSearches ?? 0),
      ]);
      await redis.expire(k, 400 * 24 * 3600);
      return yen;
    }
    const db = await readFile();
    const cur: CostSummary = db[m] ?? {
      month: m,
      total: emptyStat(),
      byFeature: {},
      recent: [],
    };
    cur.total = addStat(cur.total, u, delta);
    cur.byFeature[feature] = addStat(cur.byFeature[feature] ?? emptyStat(), u, delta);
    cur.recent = [
      { at: new Date().toISOString(), feature, model: u.model, yen: Number(yen.toFixed(4)) },
      ...cur.recent,
    ].slice(0, RECENT_MAX);
    db[m] = cur;
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(db), "utf8");
  } catch (e) {
    // 書けなかった分をインスタンス内で覚えておき、monthYenSpent に足す。
    // 以前はここで握り潰していたため、書き込み失敗が続くと天井が消えていた（監査 2）。
    unloggedYen += delta;
    console.error("[aiCost] 原価の記録に失敗（インスタンス内で応急計上）", e);
  }
  return yen;
}

/** 今月（または指定月）の集計を読む。管理画面・確認用。 */
export async function readCostSummary(m: string = month()): Promise<CostSummary> {
  const empty: CostSummary = { month: m, total: emptyStat(), byFeature: {}, recent: [] };
  try {
    if (redis) {
      const h = await redis.hgetall<Record<string, string | number>>(`cooksync:cost:${m}`);
      if (!h) return empty;
      const num = (k: string) => Number(h[k] ?? 0);
      const out: CostSummary = {
        month: m,
        total: {
          calls: num("calls"),
          yen: num("yen"),
          inputTokens: num("inputTokens"),
          outputTokens: num("outputTokens"),
          webSearches: num("webSearches"),
        },
        byFeature: {},
        recent: [],
      };
      for (const f of ["research", "scan", "import", "text"]) {
        if (!h[`${f}:calls`]) continue;
        out.byFeature[f] = {
          calls: num(`${f}:calls`),
          yen: num(`${f}:yen`),
          inputTokens: num(`${f}:inputTokens`),
          outputTokens: num(`${f}:outputTokens`),
          webSearches: num(`${f}:webSearches`),
        };
      }
      return out;
    }
    const db = await readFile();
    return db[m] ?? empty;
  } catch {
    return empty;
  }
}

/** 1回あたりの平均原価（プラン設計の裏取りに使う） */
export function avgYenPerCall(s: FeatureStat): number {
  return s.calls > 0 ? s.yen / s.calls : 0;
}

/**
 * 機能ごとの想定原価（円）。**予算判定を呼び出しの前にやる**ために使う。
 * 実測（2026-07-31）に少し余裕を持たせた安全側の値。
 * 実測が動いたら `/api/admin/stats` の yenPerCall を見てここを更新する。
 */
export const EST_YEN: Record<AiFeature, number> = {
  research: 22, // 実測 ¥19.6
  scan: 1, // 実測 ¥0.53
  import: 15, // 実測 ¥12.8（4枚）
  text: 0.3,
};

/**
 * estimate-expiry の見積もり原価（円）。
 *
 * ⚠️ EST_YEN.text（¥0.3）は「1件の短い問い合わせ」の値。estimate-expiry は
 *    **1リクエストで最大40件**をまとめてプロンプトに載せるので、固定値で申告すると
 *    実原価の何倍も安い値で予算チェックを通ってしまう（2026-08-01 監査 3）。
 *    件数でスケールさせる。1件あたり¥0.15は安全側（入出力とも件数にほぼ比例する）。
 */
export function estimateExpiryEstYen(count: number): number {
  return Math.max(EST_YEN.text, count * 0.15);
}

// ---- 事前計上（予算のバースト超過対策・2026-08-01 監査 6） ----
//
// チェック通過と同時に**見積もり額を先に計上**し、実測が出たら差分で置き換える。
// 以前は「チェック→（数十秒のAI呼び出し）→記録」の順だったので、天井付近で
// N本が同時に来ると全部がチェックを通過してから記録され、バーストで予算を超えられた。
// 事前計上なら、同時のリクエストにも計上済みの見積もりが spent として見える。
//
// ペアリングは機能ごとの金額FIFOで持つ。同じ機能の並行リクエストで順序が入れ替わっても
// 「積んだ見積もりの合計」と「引く見積もりの合計」は一致するので、集計は狂わない。
// 途中でインスタンスが死んだ場合は見積もりが残る＝**多めに数えて早く止まる**側に倒れる。
const prepaid: Record<AiFeature, number[]> = { research: [], scan: [], import: [], text: [] };

/** Redisに書けなかった原価（このインスタンスで把握している分）。天井を静かに消さないための応急記録。 */
let unloggedYen = 0;

/**
 * 見積もり額を先に計上する。**false を返したら呼び出し側は AI を呼ばない**
 * （計上できない＝いくら使ったか分からなくなるので、安全側＝止める）。
 */
export async function preChargeYen(
  feature: AiFeature,
  estYen: number = EST_YEN[feature],
): Promise<boolean> {
  const m = month();
  try {
    if (redis) {
      const k = `cooksync:cost:${m}`;
      await redis.hincrbyfloat(k, "yen", estYen);
      await redis.hincrbyfloat(k, `${feature}:yen`, estYen);
      await redis.expire(k, 400 * 24 * 3600);
    } else {
      const db = await readFile();
      const cur: CostSummary = db[m] ?? {
        month: m,
        total: emptyStat(),
        byFeature: {},
        recent: [],
      };
      cur.total.yen += estYen;
      const f = (cur.byFeature[feature] ??= emptyStat());
      f.yen += estYen;
      db[m] = cur;
      await fs.mkdir(dataDir(), { recursive: true });
      await fs.writeFile(FILE, JSON.stringify(db), "utf8");
    }
    prepaid[feature].push(estYen);
    return true;
  } catch (e) {
    console.error("[aiCost] 事前計上に失敗", e);
    return false;
  }
}

/**
 * 事前計上を取り消す（枠は通ったがAIを呼ばずに終わった場合＝quotaServer.refund から）。
 * すでに logAiCost が実測で置き換えた後なら FIFO が空なので何もしない。
 */
export async function releasePreChargeYen(feature: AiFeature): Promise<void> {
  const est = prepaid[feature].shift();
  if (!est) return;
  const m = month();
  try {
    if (redis) {
      const k = `cooksync:cost:${m}`;
      await redis.hincrbyfloat(k, "yen", -est);
      await redis.hincrbyfloat(k, `${feature}:yen`, -est);
      return;
    }
    const db = await readFile();
    const cur = db[m];
    if (!cur) return;
    cur.total.yen = Math.max(0, cur.total.yen - est);
    const f = cur.byFeature[feature];
    if (f) f.yen = Math.max(0, f.yen - est);
    await fs.writeFile(FILE, JSON.stringify(db), "utf8");
  } catch {
    // 取り消せなかった＝多めに数えたまま。安全側なので放置してよい
  }
}

/** テスト用。事前計上のFIFOと未記録分を空に戻す（テスト間の持ち越し防止）。 */
export function resetPreCharge(): void {
  for (const k of Object.keys(prepaid) as AiFeature[]) prepaid[k] = [];
  unloggedYen = 0;
}

/**
 * 今月これまでに使った金額（円）。予算判定用に軽く読む。
 *
 * ⚠️ **読めないときは 0 ではなく null を返す。**
 *    以前は失敗時に 0 を返していたため、Redisが落ちると「まだ1円も使っていない」ことになり、
 *    **¥3,000 の天井が静かに消えていた**（2026-08-01 監査 2）。
 *    null を受けた側（consume / guardAi）は fail-closed＝AIを止める。
 *    お金の判定は「分からないなら止まる」が正しい向き（逆だと損失が無限になる）。
 */
export async function monthYenSpent(m: string = month()): Promise<number | null> {
  try {
    if (redis) {
      const v = await redis.hget<unknown>(`cooksync:cost:${m}`, "yen");
      return (Number(v ?? 0) || 0) + unloggedYen;
    }
    const db = await readFile();
    return (db[m]?.total.yen ?? 0) + unloggedYen;
  } catch {
    return null;
  }
}
