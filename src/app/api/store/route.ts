// データ保存先。
//  - ローカル（大翔のPC）：単一JSONファイル .data/store.json（Tailscaleが安全境界）。
//  - 公開（Vercel）：Upstash Redis（環境変数 UPSTASH_REDIS_REST_URL があれば自動でこちら）。
//    ディスク不可のVercelでも永続化＋ユーザーごとに分離（キー `cooksync:u:<uid>` のhash）。
//
// === DEPLOY SEAM (B) ===
//   公開のユーザー識別は簡易（クライアントが localStorage の uid を送る）＝6人テスト向けMVP。
//   本格運用では Auth.js/Supabase 等のサーバー認証に置き換える。

import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/kv";
import { identify } from "@/lib/session";

export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "store.json");

// ---- ローカル(ファイル) ----
async function fileReadAll(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}
let writeLock: Promise<unknown> = Promise.resolve();
async function fileSetKey(key: string, value: unknown) {
  const op = writeLock.catch(() => {}).then(async () => {
    await fs.mkdir(DIR, { recursive: true });
    const all = await fileReadAll();
    all[key] = value;
    const tmp = `${FILE}.${key.replace(/[^a-z0-9]/gi, "")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all), "utf8");
    await fs.rename(tmp, FILE);
  });
  writeLock = op;
  await op;
}

// ---- 公開(Redis) ユーザーごと hash: cooksync:u:<uid> ----
function userKey(uid: string): string {
  const safe = uid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anon";
  return `cooksync:u:${safe}`;
}
/**
 * このリクエストが読み書きしてよいデータ領域を決める。
 *
 * ⚠️ 以前は `?u=` のクエリをそのまま信用していた（2026-08-01 の監査で発覚）。
 *    uid を知っていれば **誰でも他人の冷蔵庫・レシピ・献立・買い物リストを読めて、
 *    書き換えもできた**。認証チェックが1つも無かった。
 *    uid はUUIDなので総当たりは非現実的だが、漏れれば即アウトで、
 *    そもそも「知っていれば読める」は認可ではない。
 *
 * → **ログイン済み（セッションCookieがある）なら、必ずその人の dataId を使う。**
 *    クエリの u は無視する＝他人のIDを指定しても自分のデータしか触れない。
 *    未ログインは従来どおり端末のUUIDを使う（その端末だけのデータ）。
 */
function uidFrom(request: Request): string {
  const q = new URL(request.url).searchParams.get("u") || "anon";
  const id = identify(request, q);
  return id.trusted ? id.dataId : q;
}

async function readAllFor(request: Request): Promise<Record<string, unknown>> {
  if (redis) {
    const h = await redis.hgetall<Record<string, unknown>>(userKey(uidFrom(request)));
    if (!h) return {};
    // Upstashは値をJSONとして返す（文字列なら自前parse）
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(h)) {
      out[k] = typeof v === "string" ? safeParse(v) : v;
    }
    return out;
  }
  return fileReadAll();
}
function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

async function setKeyFor(uid: string, key: string, value: unknown) {
  if (redis) {
    await redis.hset(userKey(uid), { [key]: JSON.stringify(value) });
    return;
  }
  await fileSetKey(key, value);
}

export async function GET(request: Request) {
  return Response.json(await readAllFor(request));
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      key?: string;
      value?: unknown;
      u?: string;
    };
    if (typeof body.key !== "string") {
      return Response.json({ error: "key required" }, { status: 400 });
    }
    // 書き込みも同じ認可を通す。**body.u をそのまま信用しない**
    // （信用すると他人のデータを上書きできてしまう）。
    const me = identify(request, body.u || "anon");
    await setKeyFor(me.trusted ? me.dataId : body.u || "anon", body.key, body.value);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 },
    );
  }
}
