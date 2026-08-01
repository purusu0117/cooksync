// 管理用：登録ユーザー数・実利用状況・**AI原価の実測**をひと目で確認（大翔専用）。
// ?key=<秘密> で保護する。
//
// ⚠️ 鍵をソースに書かない（2026-07-31 修正）。
//    以前は `process.env.COOKSYNC_ADMIN_KEY || "cooksync-stats-7Qx2"` と既定値を持ち、
//    「リポジトリはプライベートだから外に出ない」というコメントが付いていた。
//    だが **このリポジトリは public** だった。環境変数を入れ忘れると、
//    誰でも既定の鍵で全ユーザーのメールアドレスと利用状況を読めてしまう。
//    → 既定値を廃止し、**未設定なら誰も通さない**（fail closed）。
import { timingSafeEqual } from "crypto";
import { redis } from "@/lib/kv";
import { avgYenPerCall, monthYenSpent, readCostSummary } from "@/lib/aiCost";
import { PARTNERS } from "@/lib/affiliate";
import { readAffiliateSummary } from "@/lib/affiliateStats";

export const dynamic = "force-dynamic";

/** 一致判定。長さの違いで早期returnしないよう、固定時間で比べる。 */
function keyMatches(given: string | null): boolean {
  const expected = process.env.COOKSYNC_ADMIN_KEY;
  // 未設定・短すぎる鍵では**開けない**。管理画面が見えないだけで実害は無いが、
  // 逆（誰でも見える）は個人情報の漏洩になるため。
  if (!expected || expected.length < 16) return false;
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface User {
  dataId: string;
  name?: string;
  createdAt?: number;
}

/** 原価は「1回いくらか」が分かる形で返す（プランの前提を実測で検算するため） */
async function costBlock(month: string) {
  const c = await readCostSummary(month);
  const per: Record<string, { calls: number; yenTotal: number; yenPerCall: number }> = {};
  for (const [feature, s] of Object.entries(c.byFeature)) {
    per[feature] = {
      calls: s.calls,
      yenTotal: Number(s.yen.toFixed(1)),
      yenPerCall: Number(avgYenPerCall(s).toFixed(2)),
    };
  }
  // CookSync自身の月間予算に対して今どこにいるか（組織全体の上限とは別物）
  const budget = Number(process.env.COOKSYNC_MONTHLY_BUDGET_YEN) || 3000;
  // null＝支出額が読めない（この状態のあいだAIは fail-closed で止まっている）
  const spent = await monthYenSpent(month);
  return {
    month: c.month,
    calls: c.total.calls,
    yenTotal: Number(c.total.yen.toFixed(1)),
    yenPerCall: Number(avgYenPerCall(c.total).toFixed(2)),
    webSearches: c.total.webSearches,
    budget:
      spent === null
        ? { yen: budget, unavailable: true }
        : {
            yen: budget,
            spentYen: Number(spent.toFixed(1)),
            remainingYen: Number(Math.max(0, budget - spent).toFixed(1)),
            usedPct: Number(((spent / budget) * 100).toFixed(1)),
          },
    byFeature: per,
  };
}

/**
 * 「まとめて買う」導線のクリック内訳。原価（cost）と並べて見るためにここに出す。
 * AI原価が支出、こちらが収入側の先行指標。どちらか片方だけ見ても収支の判断はできない。
 *
 * ⚠️ clicks は**成果件数ではない**。報酬が確定するのはASPの管理画面。
 *    CVR＝ASPの成果数 ÷ ここの clicks で見る。
 */
async function affiliateBlock(month: string) {
  const ids = PARTNERS.map((p) => p.id);
  const s = await readAffiliateSummary(month, ids);
  return {
    month: s.month,
    clicks: s.clicks,
    byPartner: s.byPartner,
    // 未設定の送客先は画面に出ないので、押されていない理由の切り分けに使う
    configured: PARTNERS.filter((p) => !!process.env[p.envKey]).map((p) => p.id),
  };
}

/**
 * 日次アクティブ（/api/store の GET で記録した cooksync:active:<日付> のSet）から
 * DAUと簡易の残存率を出す。ユーザー数が少ないうちは率より生の人数が読みやすいので両方返す。
 *   d1: 前日に開いた人のうち、その翌日も開いた人の割合（直近7ペアの平均）
 *   d7: 7日前に開いた人のうち、7日後にも開いた人の割合（直近7ペアの平均）
 */
async function activeBlock() {
  if (!redis) return null;
  const days: string[] = [];
  for (let i = 0; i < 15; i++) {
    days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }
  const sets = await Promise.all(
    days.map(async (d) => {
      try {
        return new Set((await redis!.smembers(`cooksync:active:${d}`)) ?? []);
      } catch {
        return new Set<string>();
      }
    }),
  );
  const retention = (gapDays: number): number | null => {
    let came = 0;
    let base = 0;
    // sets[0]=今日。基準日 j=gap..gap+6（データのある範囲だけ）
    for (let j = gapDays; j < Math.min(gapDays + 7, sets.length); j++) {
      for (const uid of sets[j]) {
        base += 1;
        if (sets[j - gapDays].has(uid)) came += 1;
      }
    }
    return base > 0 ? Number(((came / base) * 100).toFixed(1)) : null;
  };
  return {
    dau: days.map((date, i) => ({ date, users: sets[i].size })),
    d1Pct: retention(1),
    d7Pct: retention(7),
  };
}

export async function GET(request: Request) {
  if (!keyMatches(new URL(request.url).searchParams.get("key"))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const monthNow = new Date().toISOString().slice(0, 7);
  if (!redis) {
    // ローカルはClaude CLI経由＝原価0だが、API modeで動かしたときの実測は残る
    return Response.json({
      note: "local (no redis)",
      users: 0,
      cost: await costBlock(monthNow),
      affiliate: await affiliateBlock(monthNow),
    });
  }

  const month = monthNow;
  const aiThisMonth =
    (await redis.get<number>(`cooksync:aiquota:${month}`)) ?? 0;
  const usersHash =
    (await redis.hgetall<Record<string, unknown>>("cooksync:users")) ?? {};

  const accounts: Array<Record<string, unknown>> = [];
  for (const [email, raw] of Object.entries(usersHash)) {
    const u = (typeof raw === "string" ? JSON.parse(raw) : raw) as User;
    let fridge = 0;
    let recipes = 0;
    let meals = 0;
    try {
      const h =
        (await redis.hgetall<Record<string, unknown>>(
          `cooksync:u:${u.dataId}`,
        )) ?? {};
      const parse = (k: string) => {
        const v = h[k];
        const arr = typeof v === "string" ? JSON.parse(v) : v;
        return Array.isArray(arr) ? arr.length : 0;
      };
      fridge = parse("fridge-app:items:v2");
      recipes = parse("fridge-app:recipes:v1");
      meals = parse("fridge-app:meals:v1");
    } catch {
      /* noop */
    }
    accounts.push({
      email,
      name: u.name,
      createdAt: u.createdAt,
      fridge,
      recipes,
      meals,
    });
  }

  return Response.json({
    users: accounts.length,
    aiThisMonth,
    active: await activeBlock(),
    cost: await costBlock(month),
    affiliate: await affiliateBlock(month),
    accounts: accounts.sort(
      (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
    ),
  });
}
