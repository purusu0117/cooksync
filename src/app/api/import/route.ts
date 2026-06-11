// 既存データの取り込み（移行）用。メールが未登録なら作成、登録済みならパスワード一致時のみ。
// 大翔のローカルデータを公開アカウントへ移すための一回限りの導線。
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
function userDataKey(dataId: string): string {
  return `cooksync:u:${dataId}`;
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
    if (!redis) {
      return Response.json({ error: "import is only for the deployed (redis) env" }, { status: 400 });
    }
    const { email, password, name, data } = (await request.json()) as {
      email?: string;
      password?: string;
      name?: string;
      data?: Record<string, unknown[]>;
    };
    const em = norm(email || "");
    if (!em || !password || !data || typeof data !== "object") {
      return Response.json({ error: "email, password, data required" }, { status: 400 });
    }

    let user = await getUser(em);
    if (user) {
      if (user.password !== password) {
        return Response.json({ error: "password mismatch" }, { status: 401 });
      }
    } else {
      user = {
        dataId: globalThis.crypto.randomUUID(),
        name: (name || "").trim() || em,
        password,
        createdAt: Date.now(),
      };
      await putUser(em, user);
    }

    // 各ストアを書き込み（store routeと同じ形式：hash field=storeKey, value=JSON文字列）
    const key = userDataKey(user.dataId);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      fields[k] = JSON.stringify(v);
    }
    if (Object.keys(fields).length > 0) {
      await redis.hset(key, fields);
    }

    return Response.json({
      ok: true,
      dataId: user.dataId,
      imported: Object.keys(fields),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "import failed" },
      { status: 500 },
    );
  }
}
