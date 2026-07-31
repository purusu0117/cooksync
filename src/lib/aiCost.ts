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
  const m = month();
  try {
    if (redis) {
      const k = `cooksync:cost:${m}`;
      await Promise.all([
        redis.hincrby(k, "calls", 1),
        redis.hincrbyfloat(k, "yen", yen),
        redis.hincrby(k, "inputTokens", u.inputTokens),
        redis.hincrby(k, "outputTokens", u.outputTokens),
        redis.hincrby(k, "webSearches", u.webSearches ?? 0),
        redis.hincrby(k, `${feature}:calls`, 1),
        redis.hincrbyfloat(k, `${feature}:yen`, yen),
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
    cur.total = addStat(cur.total, u, yen);
    cur.byFeature[feature] = addStat(cur.byFeature[feature] ?? emptyStat(), u, yen);
    cur.recent = [
      { at: new Date().toISOString(), feature, model: u.model, yen: Number(yen.toFixed(4)) },
      ...cur.recent,
    ].slice(0, RECENT_MAX);
    db[m] = cur;
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(db), "utf8");
  } catch {
    /* 計測の失敗で本流を止めない */
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

/** 今月これまでに使った金額（円）。予算判定用に軽く読む。 */
export async function monthYenSpent(m: string = month()): Promise<number> {
  try {
    if (redis) {
      const v = await redis.hget<unknown>(`cooksync:cost:${m}`, "yen");
      return Number(v ?? 0) || 0;
    }
    const db = await readFile();
    return db[m]?.total.yen ?? 0;
  } catch {
    return 0; // 読めないときに止めるとサービスが死ぬので通す（上位の回数上限が残る）
  }
}
