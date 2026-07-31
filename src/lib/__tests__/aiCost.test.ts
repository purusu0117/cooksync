import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  avgYenPerCall,
  costUsd,
  costYen,
  logAiCost,
  readCostSummary,
  usageFrom,
} from "../aiCost";

const FILE = path.join(process.env.COOKSYNC_DATA_DIR ?? path.join(process.cwd(), ".data"), "ai-cost.json");

beforeEach(async () => {
  process.env.COOKSYNC_USD_JPY = "155"; // 為替でテストが揺れないよう固定
  await fs.rm(FILE, { force: true }).catch(() => {});
});
afterEach(async () => {
  delete process.env.COOKSYNC_USD_JPY;
  await fs.rm(FILE, { force: true }).catch(() => {});
});

describe("costUsd", () => {
  it("Sonnet 5 の入出力単価（$3 / $15 per MTok）", () => {
    const usd = costUsd({
      model: "claude-sonnet-5",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(usd).toBeCloseTo(3, 6);
    expect(
      costUsd({ model: "claude-sonnet-5", inputTokens: 0, outputTokens: 1_000_000 }),
    ).toBeCloseTo(15, 6);
  });

  it("Haiku 4.5 は Sonnet 5 の 1/3（$1 / $5）", () => {
    const h = costUsd({ model: "claude-haiku-4-5", inputTokens: 1_000_000, outputTokens: 0 });
    const s = costUsd({ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0 });
    expect(h).toBeCloseTo(1, 6);
    expect(s / h).toBeCloseTo(3, 6);
  });

  it("web_search は $10 / 1,000回 でトークンとは別建て", () => {
    const usd = costUsd({
      model: "claude-sonnet-5",
      inputTokens: 0,
      outputTokens: 0,
      webSearches: 3,
    });
    expect(usd).toBeCloseTo(0.03, 6);
  });

  it("キャッシュ読み出しは入力の0.1倍、書き込みは1.25倍", () => {
    const base = costUsd({ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0 });
    const read = costUsd({
      model: "claude-sonnet-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    const write = costUsd({
      model: "claude-sonnet-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 1_000_000,
    });
    expect(read / base).toBeCloseTo(0.1, 6);
    expect(write / base).toBeCloseTo(1.25, 6);
  });

  it("未知のモデルは安全側（高い方）の単価で計上する＝原価を過小評価しない", () => {
    const unknown = costUsd({ model: "claude-future-9", inputTokens: 1_000_000, outputTokens: 0 });
    const sonnet = costUsd({ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0 });
    expect(unknown).toBeGreaterThan(sonnet);
  });
});

describe("costYen", () => {
  it("プラン試算どおりの桁になる：レシピ探索1回 ≒ ¥18", () => {
    // Decisionノート §1 の内訳（dynamic filtering 版）
    const yen = costYen({
      model: "claude-sonnet-5",
      inputTokens: 11_000, // プロンプト3K + 絞り込み後の検索結果8K
      outputTokens: 3_600, // レシピ3件
      webSearches: 3,
    });
    expect(yen).toBeGreaterThan(15);
    expect(yen).toBeLessThan(21);
  });

  it("写真で在庫登録は Haiku なら1円未満", () => {
    const yen = costYen({
      model: "claude-haiku-4-5",
      inputTokens: 1_900, // 画像1,568 + プロンプト
      outputTokens: 300,
    });
    expect(yen).toBeLessThan(1);
  });

  it("為替を変えると比例して動く", () => {
    const u = { model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0 };
    process.env.COOKSYNC_USD_JPY = "155";
    const a = costYen(u);
    process.env.COOKSYNC_USD_JPY = "310";
    expect(costYen(u)).toBeCloseTo(a * 2, 4);
  });
});

describe("usageFrom", () => {
  it("SDKのレスポンスから必要な数字を取り出す", () => {
    const u = usageFrom("claude-sonnet-5", {
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 5,
        server_tool_use: { web_search_requests: 2 },
      },
    });
    expect(u).toEqual({
      model: "claude-sonnet-5",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 7,
      cacheCreateTokens: 5,
      webSearches: 2,
    });
  });

  it("usage が無い・欠けていても落ちない（0で埋める）", () => {
    expect(usageFrom("m", {}).inputTokens).toBe(0);
    expect(usageFrom("m", null).outputTokens).toBe(0);
    expect(usageFrom("m", { usage: { input_tokens: "x" } }).inputTokens).toBe(0);
  });
});

describe("logAiCost / readCostSummary", () => {
  it("機能ごとに積み上がり、1回あたりの平均が取れる", async () => {
    await logAiCost("research", {
      model: "claude-sonnet-5",
      inputTokens: 11_000,
      outputTokens: 3_600,
      webSearches: 3,
    });
    await logAiCost("research", {
      model: "claude-sonnet-5",
      inputTokens: 11_000,
      outputTokens: 3_600,
      webSearches: 3,
    });
    await logAiCost("scan", {
      model: "claude-haiku-4-5",
      inputTokens: 1_900,
      outputTokens: 300,
    });

    const s = await readCostSummary();
    expect(s.total.calls).toBe(3);
    expect(s.byFeature.research.calls).toBe(2);
    expect(s.byFeature.scan.calls).toBe(1);
    expect(s.total.webSearches).toBe(6);
    // 探索の平均は写真スキャンよりはるかに高い＝振り分けの効果が数字で見える
    expect(avgYenPerCall(s.byFeature.research)).toBeGreaterThan(
      avgYenPerCall(s.byFeature.scan) * 10,
    );
  });

  it("直近ログを残す（スポット確認用）", async () => {
    await logAiCost("import", {
      model: "claude-sonnet-5",
      inputTokens: 20_000,
      outputTokens: 1_500,
    });
    const s = await readCostSummary();
    expect(s.recent[0].feature).toBe("import");
    expect(s.recent[0].yen).toBeGreaterThan(0);
  });
});
