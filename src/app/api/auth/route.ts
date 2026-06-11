// メール＋パスワードのサーバー認証。email → dataId をレジストリに保存し、
// どの端末/コンテキストからでも同じデータ(dataId)に辿り着けるようにする。
//  - 公開：Redis hash `cooksync:users`（field=email, value=JSON）
//  - ローカル：.data/users.json
// ※MVP：パスワードは平文比較（既存モデル踏襲）。本番強化時はハッシュ化。
import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/kv";

export const dynamic = "force-dynamic";

const USERS_KEY = "cooksync:users";
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "users.json");

interface User {
  dataId: string;
  name: string;
  password: string;
  createdAt: number;
}

function norm(email: string): string {
  return email.trim().toLowerCase();
}

async function getUser(email: string): Promise<User | null> {
  if (redis) {
    const v = await redis.hget<unknown>(USERS_KEY, email);
    if (!v) return null;
    return (typeof v === "string" ? JSON.parse(v) : v) as User;
  }
  try {
    const all = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, User>;
    return all[email] ?? null;
  } catch {
    return null;
  }
}

async function putUser(email: string, u: User): Promise<void> {
  if (redis) {
    await redis.hset(USERS_KEY, { [email]: JSON.stringify(u) });
    return;
  }
  await fs.mkdir(DIR, { recursive: true });
  let all: Record<string, User> = {};
  try {
    all = JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    /* 初回 */
  }
  all[email] = u;
  await fs.writeFile(FILE, JSON.stringify(all), "utf8");
}

export async function POST(request: Request) {
  try {
    const { action, name, email, password } = (await request.json()) as {
      action?: string;
      name?: string;
      email?: string;
      password?: string;
    };
    const em = norm(email || "");
    if (!em || !password) {
      return Response.json(
        { error: "メールとパスワードを入力してください。" },
        { status: 400 },
      );
    }

    if (action === "register") {
      if (!name || !name.trim()) {
        return Response.json({ error: "お名前を入力してください。" }, { status: 400 });
      }
      const existing = await getUser(em);
      if (existing) {
        return Response.json(
          { error: "このメールは既に登録済みです。ログインしてください。" },
          { status: 409 },
        );
      }
      const dataId = globalThis.crypto.randomUUID();
      await putUser(em, { dataId, name: name.trim(), password, createdAt: Date.now() });
      return Response.json({ ok: true, dataId, name: name.trim(), email: em });
    }

    // login
    const u = await getUser(em);
    if (!u || u.password !== password) {
      return Response.json(
        { error: "メールアドレスかパスワードが違います。" },
        { status: 401 },
      );
    }
    return Response.json({ ok: true, dataId: u.dataId, name: u.name, email: em });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "auth failed" },
      { status: 500 },
    );
  }
}
