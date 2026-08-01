// 2026-08-01 のAI予算監査で見つかった穴の修正を固定するテスト。
//   監査2: Redisが落ちると¥3,000の天井が静かに消える → monthYenSpent は失敗時 null（fail-closed）
//   監査3: estimate-expiry が40件バッチを¥0.3で申告 → 件数でスケール
//   監査4: suggest/proofread/estimate-expiry にユーザーごとの枠が無い → 利用者日次上限
//   監査6: 非同期ルートのバーストで予算天井を超えうる → 見積もりの事前計上

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { consume, guardAi, refund } from "../quotaServer";
import {
  EST_YEN,
  estimateExpiryEstYen,
  logAiCost,
  monthYenSpent,
  resetPreCharge,
} from "../aiCost";

const DIR = process.env.COOKSYNC_DATA_DIR ?? path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "usage-server.json");
const COST_FILE = path.join(DIR, "ai-cost.json");

async function clean() {
  await fs.rm(FILE, { force: true }).catch(() => {});
  await fs.rm(COST_FILE, { force: true }).catch(() => {});
}

beforeEach(async () => {
  process.env.COOKSYNC_ENFORCE_QUOTA = "1";
  process.env.COOKSYNC_USD_JPY = "155";
  resetPreCharge();
  await clean();
});
afterEach(async () => {
  delete process.env.COOKSYNC_ENFORCE_QUOTA;
  delete process.env.COOKSYNC_USD_JPY;
  delete process.env.COOKSYNC_MONTHLY_BUDGET_YEN;
  delete process.env.COOKSYNC_TEXT_DAILY_CAP;
  resetPreCharge();
  await clean();
});

function req(ip: string): Request {
  return new Request("http://localhost/api/test", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("estimate-expiry の原価申告（監査3）", () => {
  it("1件なら従来の text 見積もり、40件なら件数ぶんスケールする", () => {
    expect(estimateExpiryEstYen(1)).toBe(EST_YEN.text);
    expect(estimateExpiryEstYen(40)).toBeCloseTo(6, 5);
    // 少件数でも最低ラインを割らない
    expect(estimateExpiryEstYen(0)).toBe(EST_YEN.text);
  });
});

describe("見積もりの事前計上（監査6・バースト対策）", () => {
  it("consume が通った時点で見積もりが支出に載る＝同時の次リクエストが天井を見られる", async () => {
    process.env.COOKSYNC_MONTHLY_BUDGET_YEN = "30";
    // 1本目: 残額¥30に見積¥22 → 通る。**AIを呼ぶ前に**¥22が計上される
    expect((await consume("burst-a", "research", req("10.9.0.1"))).ok).toBe(true);
    expect(await monthYenSpent()).toBeCloseTo(EST_YEN.research, 5);
    // 2本目（同時に来た別ユーザー想定）: 22+22 > 30 → 記録を待たずに止まる
    const second = await consume("burst-b", "research", req("10.9.0.2"));
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("budget");
  });

  it("実測が出たら見積もりは差し替えられる（二重計上しない）", async () => {
    expect((await consume("swap-a", "research", req("10.9.1.1"))).ok).toBe(true);
    // 実測 ¥19.6 相当の usage を記録 → 事前計上の¥22が実測に置き換わる
    await logAiCost("research", {
      model: "claude-sonnet-5",
      inputTokens: 11_000,
      outputTokens: 3_600,
      webSearches: 3,
    });
    const spent = await monthYenSpent();
    expect(spent).not.toBeNull();
    // ¥22（見積）+¥19.6（実測）の二重計上なら41.6になる。置き換えなら実測の19.6前後
    expect(spent!).toBeGreaterThan(15);
    expect(spent!).toBeLessThan(EST_YEN.research);
  });

  it("AIを呼ばずに終わったら refund が事前計上も取り消す", async () => {
    const r = req("10.9.2.1");
    expect((await consume("refund-a", "research", r)).ok).toBe(true);
    expect(await monthYenSpent()).toBeCloseTo(EST_YEN.research, 5);
    await refund("refund-a", "research", r);
    expect(await monthYenSpent()).toBeCloseTo(0, 5);
  });
});

describe("プレミアムの1人あたり月間原価上限（pricing.PREMIUM_AI_COST_CAP_YEN）", () => {
  it("プレミアム1人が全体予算を食い潰す前に、本人の¥220で止まる", async () => {
    // ローカルの premium 名簿に登録（quotaServer.isPremium はこのファイルを読む）
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      FILE,
      JSON.stringify({ usage: {}, ip: {}, global: {}, premium: ["cap-user"] }),
      "utf8",
    );
    // research の見積もりは¥22。¥220の上限なので10回目まで通り、11回目で止まる
    // （週次の回数上限15回より先に、金額の上限が効く＝採算が回数より優先される）
    for (let i = 1; i <= 10; i++) {
      const q = await consume("cap-user", "research", req(`10.9.6.${i}`));
      expect(q.ok, `${i}回目は通るはず`).toBe(true);
      expect(q.premium).toBe(true);
    }
    const over = await consume("cap-user", "research", req("10.9.6.11"));
    expect(over.ok).toBe(false);
    expect(over.reason).toBe("user");
    expect(over.message).toContain("公平利用");
  });

  it("無料ユーザーには金額上限を掛けない（週次枠だけで守る）", async () => {
    // 無料の research 週次枠は2回。金額上限で先に止まらないことを確認
    expect((await consume("free-cap", "research", req("10.9.7.1"))).ok).toBe(true);
    expect((await consume("free-cap", "research", req("10.9.7.1"))).ok).toBe(true);
    const third = await consume("free-cap", "research", req("10.9.7.1"));
    expect(third.ok).toBe(false);
    expect(third.message).toContain("無料枠");
  });
});

describe("guardAi の利用者日次上限（監査4）", () => {
  it("同じ利用者は日次上限で止まる（IPを変えても回避できない）", async () => {
    process.env.COOKSYNC_TEXT_DAILY_CAP = "2";
    expect((await guardAi(req("10.9.3.1"), EST_YEN.text, "text-user")).ok).toBe(true);
    expect((await guardAi(req("10.9.3.2"), EST_YEN.text, "text-user")).ok).toBe(true);
    const third = await guardAi(req("10.9.3.3"), EST_YEN.text, "text-user");
    expect(third.ok).toBe(false);
    expect(third.message).toContain("本日");
  });

  it("uidが無ければIP単位で数える（匿名でも無限にならない）", async () => {
    process.env.COOKSYNC_TEXT_DAILY_CAP = "1";
    expect((await guardAi(req("10.9.4.1"), EST_YEN.text)).ok).toBe(true);
    expect((await guardAi(req("10.9.4.1"), EST_YEN.text)).ok).toBe(false);
    // 別のIPなら別の匿名利用者として扱う
    expect((await guardAi(req("10.9.4.2"), EST_YEN.text)).ok).toBe(true);
  });

  it("guardAi も見積もりを事前計上する（テキスト経路のバーストも塞がる）", async () => {
    expect((await guardAi(req("10.9.5.1"), 10, "pre-user")).ok).toBe(true);
    expect(await monthYenSpent()).toBeCloseTo(10, 5);
  });
});
