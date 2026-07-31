import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  FREE_LIMITS,
  PREMIUM_LIMITS,
  checkLoginAttempt,
  consume,
  peek,
  quotaResponse,
  recentUsageMonths,
  refund,
} from "../quotaServer";
import { logAiCost } from "../aiCost";
import { quotaMessage, readApiError } from "../usage";

// 枠はローカルではデフォルト無効（大翔のローカルは原価0のため）。
// 検証のあいだだけ強制する。
const FILE = path.join(process.env.COOKSYNC_DATA_DIR ?? path.join(process.cwd(), ".data"), "usage-server.json");
const COST_FILE = path.join(process.env.COOKSYNC_DATA_DIR ?? path.join(process.cwd(), ".data"), "ai-cost.json");

async function clean() {
  await fs.rm(FILE, { force: true }).catch(() => {});
  await fs.rm(COST_FILE, { force: true }).catch(() => {});
}

beforeEach(async () => {
  process.env.COOKSYNC_ENFORCE_QUOTA = "1";
  process.env.COOKSYNC_USD_JPY = "155";
  await clean();
});
afterEach(async () => {
  delete process.env.COOKSYNC_ENFORCE_QUOTA;
  delete process.env.COOKSYNC_USD_JPY;
  delete process.env.COOKSYNC_MONTHLY_BUDGET_YEN;
  delete process.env.COOKSYNC_MONTHLY_AI_CAP;
  await clean();
});

/** IPごとの上限を分けるため、テストごとに違うIPを名乗る */
function req(ip: string): Request {
  return new Request("http://localhost/api/research", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("consume", () => {
  it("無料枠の回数まで通し、超えたら止める", async () => {
    const r = req("10.0.0.1");
    const limit = FREE_LIMITS.research; // 3
    for (let i = 1; i <= limit; i++) {
      const q = await consume("userA", "research", r);
      expect(q.ok).toBe(true);
      expect(q.used).toBe(i);
      expect(q.remaining).toBe(limit - i);
    }
    const over = await consume("userA", "research", r);
    expect(over.ok).toBe(false);
    expect(over.reason).toBe("user");
    expect(over.message).toContain("無料枠");
  });

  it("止めたときはカウントを増やさない（何度叩いても used は上限のまま）", async () => {
    const r = req("10.0.0.2");
    for (let i = 0; i < FREE_LIMITS.research; i++) await consume("userB", "research", r);
    await consume("userB", "research", r);
    await consume("userB", "research", r);
    const state = await peek("userB");
    expect(state.used.research).toBe(FREE_LIMITS.research);
  });

  it("機能ごとに枠は独立している", async () => {
    const r = req("10.0.0.3");
    for (let i = 0; i < FREE_LIMITS.research; i++) await consume("userC", "research", r);
    expect((await consume("userC", "research", r)).ok).toBe(false);
    // 探索を使い切っても写真スキャンは使える
    expect((await consume("userC", "scan", r)).ok).toBe(true);
  });

  it("別ユーザーの枠は独立している", async () => {
    const r = req("10.0.0.4");
    for (let i = 0; i < FREE_LIMITS.research; i++) await consume("userD", "research", r);
    expect((await consume("userD", "research", r)).ok).toBe(false);
    expect((await consume("userE", "research", req("10.0.0.5"))).ok).toBe(true);
  });

  it("uidを作り直しても同じIPなら日次上限で止まる（枠リセットの回避を潰す）", async () => {
    const r = req("10.0.0.99");
    // 上限は既定30/日。uidを毎回変えて31回叩く
    let blockedByIp = false;
    for (let i = 0; i < 31; i++) {
      const q = await consume(`throwaway-${i}`, "research", r);
      if (!q.ok && q.reason === "ip") {
        blockedByIp = true;
        break;
      }
    }
    expect(blockedByIp).toBe(true);
  });

  it("未ログイン(anon)はIP単位で数える＝匿名連打で枠が無限にならない", async () => {
    const r = req("10.0.0.6");
    for (let i = 0; i < FREE_LIMITS.research; i++) {
      expect((await consume("anon", "research", r)).ok).toBe(true);
    }
    expect((await consume("anon", "research", r)).ok).toBe(false);
  });
});

describe("月間予算の上限（金額ベースの最終防衛線）", () => {
  // Anthropic Console の支出上限は**組織単位**で他プロジェクト（CashSync等）と食い合う。
  // CookSync単体を止めるのはこちらの役目。組織側の設定に依存しない。
  it("使った金額が予算に達したら、枠が残っていても止める", async () => {
    process.env.COOKSYNC_MONTHLY_BUDGET_YEN = "50";
    const r = req("10.1.0.1");
    // 予算50円に対して1回¥19.6の探索を積む
    for (let i = 0; i < 3; i++) {
      await logAiCost("research", {
        model: "claude-sonnet-5",
        inputTokens: 11_000,
        outputTokens: 3_600,
        webSearches: 3,
      });
    }
    const q = await consume("budgetUser", "research", r);
    expect(q.ok).toBe(false);
    expect(q.reason).toBe("budget");
  });

  it("予算を跨がないよう、**これから使う分を足して**判定する（上振れしない）", async () => {
    process.env.COOKSYNC_MONTHLY_BUDGET_YEN = "30";
    const r = req("10.1.0.2");
    // 既に¥19.6使用。次の探索(見積¥22)を足すと¥41.6で予算¥30を超える → 呼ばせない
    await logAiCost("research", {
      model: "claude-sonnet-5",
      inputTokens: 11_000,
      outputTokens: 3_600,
      webSearches: 3,
    });
    expect((await consume("budgetUser2", "research", r)).reason).toBe("budget");
    // 安い機能(写真スキャン・見積¥1)なら同じ残額でも通る＝機能ごとの単価差を見ている
    expect((await consume("budgetUser2", "scan", r)).ok).toBe(true);
  });

  it("予算内なら普通に通る", async () => {
    process.env.COOKSYNC_MONTHLY_BUDGET_YEN = "3000";
    const r = req("10.1.0.3");
    expect((await consume("budgetUser3", "research", r)).ok).toBe(true);
  });
});

describe("refund", () => {
  it("AIが失敗したときに枠を戻す", async () => {
    const r = req("10.0.0.7");
    await consume("userF", "research", r);
    expect((await peek("userF")).used.research).toBe(1);
    await refund("userF", "research", r);
    expect((await peek("userF")).used.research).toBe(0);
  });

  it("戻しすぎてマイナスにならない", async () => {
    const r = req("10.0.0.8");
    await refund("userG", "research", r);
    await refund("userG", "research", r);
    expect((await peek("userG")).used.research).toBe(0);
  });
});

describe("クライアント表示との文言一致", () => {
  // 事前チェック(usage.ts)で弾いたときと、サーバーが429を返したときで文言が違うと、
  // 同じ枠切れなのに押すタイミングで説明が変わってしまう。両者を突き合わせて固定する。
  it("無料ユーザーの枠切れ文言が usage.quotaMessage と一致する", async () => {
    const r = req("10.2.0.1");
    for (let i = 0; i < FREE_LIMITS.research; i++) await consume("msgFree", "research", r);
    const over = await consume("msgFree", "research", r);
    expect(over.ok).toBe(false);
    expect(over.message).toBe(quotaMessage("research", FREE_LIMITS.research, false));
  });

  it("プレミアムの上限到達の文言も usage.quotaMessage と一致する", async () => {
    // プレミアムはローカルではファイルの premium リストで表現される
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(
      FILE,
      JSON.stringify({ usage: {}, ip: {}, global: {}, premium: ["msgPaid"] }),
      "utf8",
    );
    const r = req("10.2.0.2");
    for (let i = 0; i < PREMIUM_LIMITS.import; i++) await consume("msgPaid", "import", r);
    const over = await consume("msgPaid", "import", r);
    expect(over.ok).toBe(false);
    expect(over.premium).toBe(true);
    expect(over.message).toBe(quotaMessage("import", PREMIUM_LIMITS.import, true));
  });

  it("429のボディから readApiError がサーバーの文言と枠情報を取り出せる", async () => {
    const r = req("10.2.0.3");
    for (let i = 0; i < FREE_LIMITS.scan; i++) await consume("msgRead", "scan", r);
    const over = await consume("msgRead", "scan", r);
    const body = await quotaResponse(over, "scan").json();

    const fail = readApiError(body, "認識に失敗しました");
    expect(fail.message).toBe(over.message); // クライアントは上書きしない
    expect(fail.quota?.reason).toBe("user");
    expect(fail.quota?.limit).toBe(FREE_LIMITS.scan);
  });
});

describe("H-2 拒否したリクエストは全体の枠を食わない", () => {
  // 枠切れのユーザーが連打するだけで全体カウンタが積み上がり、
  // 原価が1円も出ていないのに **300回で全ユーザーが月末まで停止**していた。
  it("枠切れユーザーがいくら連打しても、他の人の分が減らない", async () => {
    process.env.COOKSYNC_MONTHLY_AI_CAP = String(FREE_LIMITS.research + 2);
    const r = req("10.3.0.1");
    // userX が自分の月間枠を使い切る（＝全体カウンタは FREE_LIMITS.research だけ進む）
    for (let i = 0; i < FREE_LIMITS.research; i++) {
      expect((await consume("userX", "research", r)).ok).toBe(true);
    }
    // 拒否されるだけの連打（原価0）。ここで全体を消費してはいけない
    for (let i = 0; i < 30; i++) {
      expect((await consume("userX", "research", r)).reason).toBe("user");
    }
    // 全体上限のうち実際に使ったのは FREE_LIMITS.research 回だけ。別のユーザーはまだ通る
    expect((await consume("userY", "research", req("10.3.0.2"))).ok).toBe(true);
  });

  it("全体の上限に達したら、そのときのユーザー枠・IPは消費されない（戻す）", async () => {
    process.env.COOKSYNC_MONTHLY_AI_CAP = "1";
    const r = req("10.3.0.3");
    expect((await consume("userZ", "research", r)).ok).toBe(true);
    const denied = await consume("userZ", "research", r);
    expect(denied.reason).toBe("global");
    // 使えなかったのだから、その人の使用回数は増えていない
    expect((await peek("userZ")).used.research).toBe(1);
  });

  it("IP日次上限で拒否したときもユーザー枠は減らない", async () => {
    process.env.COOKSYNC_IP_DAILY_CAP = "2";
    const r = req("10.3.0.4");
    await consume("ipUser", "scan", r);
    await consume("ipUser", "scan", r);
    expect((await consume("ipUser", "scan", r)).reason).toBe("ip");
    expect((await peek("ipUser")).used.scan).toBe(2);
    delete process.env.COOKSYNC_IP_DAILY_CAP;
  });
});

describe("H-1 ログイン総当たり制限は課金枠と切り離して常時有効", () => {
  it("ANTHROPIC_API_KEY も COOKSYNC_ENFORCE_QUOTA も無い環境で効く", async () => {
    // ← ここが監査で見つかった穴。quotaEnforced() は ANTHROPIC_API_KEY の有無で決まるので、
    //    キー未設定の環境ではログイン試行の制限が**丸ごと無効**だった。
    delete process.env.COOKSYNC_ENFORCE_QUOTA;
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = req("10.4.0.1");
      for (let i = 0; i < 10; i++) expect(await checkLoginAttempt(r)).toBe(true);
      expect(await checkLoginAttempt(r)).toBe(false);
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });

  it("IPごとに独立している（他人のログインを巻き込まない）", async () => {
    delete process.env.COOKSYNC_ENFORCE_QUOTA;
    const a = req("10.4.0.2");
    for (let i = 0; i < 11; i++) await checkLoginAttempt(a);
    expect(await checkLoginAttempt(a)).toBe(false);
    expect(await checkLoginAttempt(req("10.4.0.3"))).toBe(true);
  });
});

describe("H-10(b) 利用カウンタの月キー", () => {
  it("当月と**直前の月**を返す（2ヶ月前を指して消し残さない）", () => {
    const [cur, prev] = recentUsageMonths();
    const now = new Date();
    expect(cur).toBe(now.toISOString().slice(0, 7));
    const expectedPrev = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
    )
      .toISOString()
      .slice(0, 7);
    expect(prev).toBe(expectedPrev);
    expect(prev).not.toBe(cur);
  });
});

describe("quotaEnforced", () => {
  it("ローカル(強制オフ)では素通しする＝大翔の手元の利用は制限しない", async () => {
    delete process.env.COOKSYNC_ENFORCE_QUOTA;
    const r = req("10.0.0.9");
    for (let i = 0; i < 50; i++) {
      expect((await consume("userH", "research", r)).ok).toBe(true);
    }
  });
});
