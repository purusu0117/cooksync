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
  const spent = await monthYenSpent(month);
  return {
    month: c.month,
    calls: c.total.calls,
    yenTotal: Number(c.total.yen.toFixed(1)),
    yenPerCall: Number(avgYenPerCall(c.total).toFixed(2)),
    webSearches: c.total.webSearches,
    budget: {
      yen: budget,
      spentYen: Number(spent.toFixed(1)),
      remainingYen: Number(Math.max(0, budget - spent).toFixed(1)),
      usedPct: Number(((spent / budget) * 100).toFixed(1)),
    },
    byFeature: per,
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
    cost: await costBlock(month),
    accounts: accounts.sort(
      (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
    ),
  });
}
