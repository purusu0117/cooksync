// 管理用：登録ユーザー数と実利用状況をひと目で確認（大翔専用）。
// ?key=<秘密> で保護。リポジトリはプライベートなのでソース内の鍵は外部に出ない。
import { redis } from "@/lib/kv";

export const dynamic = "force-dynamic";

const ADMIN_KEY = "cooksync-stats-7Qx2"; // 後で外す/環境変数化してよい

interface User {
  dataId: string;
  name?: string;
  createdAt?: number;
}

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (key !== ADMIN_KEY) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!redis) {
    return Response.json({ note: "local (no redis)", users: 0 });
  }

  const month = new Date().toISOString().slice(0, 7);
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
    accounts: accounts.sort(
      (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
    ),
  });
}
