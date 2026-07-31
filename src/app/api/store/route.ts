// データ保存先。
//  - ローカル（大翔のPC）：JSONファイル .data/store.json（storeLocal.ts・uidごとに分離）。
//  - 公開（Vercel）：Upstash Redis（キー `cooksync:u:<uid>` のhash）。
//    ※ 本番でRedisが無ければ kv.ts が起動時に落とす（全員が同じデータを共有する事故を防ぐ）。

import { assertKvConfigured, redis } from "@/lib/kv";
import { identify } from "@/lib/session";
import { localReadAll, localSetKey } from "@/lib/storeLocal";
import { isAccountDataId } from "@/lib/userStore";

export const dynamic = "force-dynamic";

// ---- 公開(Redis) ユーザーごと hash: cooksync:u:<uid> ----
function userKey(uid: string): string {
  const safe = uid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anon";
  return `cooksync:u:${safe}`;
}

/**
 * このリクエストが読み書きしてよいデータ領域を決める。**認可の本体。**
 *
 * ⚠️ 直前まで、ここは「Cookieがあれば dataId、無ければ `?u=` をそのまま採用」だった。
 *    つまり **Cookieを1つも付けなければ `?u=<他人のdataId>` が通り**、
 *    冷蔵庫・レシピ・献立・買い物リストが全部読めて、PUTで上書きもできた。
 *    dataId は秘密ですらなく、HttpOnlyでないCookie・/api/auth のJSON・localStorage に
 *    平文で置かれていたので「知られていない前提」も成り立っていなかった（2026-08-01 監査 C-2）。
 *
 * 直した後のルール:
 *   ① セッションCookieがある      → **必ず** その人の dataId。`?u=` は完全に無視する。
 *   ② Cookieが無い（未ログイン端末）→ その端末のUUIDのみ。
 *      ただし名乗った値が **登録済みアカウントの dataId なら拒否**（403）。
 *      ＝ Cookie無しのリクエストはアカウントの領域に**構造的に届かない**。
 *
 * 既存ユーザーの移行:
 *   - キーは1つも変えていないので、**データは1バイトも動かない／消えない**。
 *   - ログイン中の人（Cookieあり）は①でこれまで通り自分のデータを読む。
 *   - Cookieが切れている人は403になるが、データは無傷のまま残り、
 *     ログインし直せば元通り見える（MyPageが期限切れを検知して案内する）。
 *   - 一度もアカウントを作っていない端末は②でこれまで通り。
 */
async function resolveUid(request: Request, claimed: string | null): Promise<string | null> {
  const q = (claimed || "anon").trim() || "anon";
  const id = identify(request, q);
  if (id.trusted) return id.dataId;
  if (q === "anon") return "anon";
  if (await isAccountDataId(q)) return null; // 他人（または期限切れの自分）のアカウント領域
  return q;
}

function forbidden(): Response {
  return Response.json(
    {
      error: "ログインの有効期限が切れました。ログインし直してください。",
      code: "login_required",
    },
    { status: 403 },
  );
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

async function readAllFor(uid: string): Promise<Record<string, unknown>> {
  if (redis) {
    const h = await redis.hgetall<Record<string, unknown>>(userKey(uid));
    if (!h) return {};
    // Upstashは値をJSONとして返す（文字列なら自前parse）
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(h)) {
      out[k] = typeof v === "string" ? safeParse(v) : v;
    }
    return out;
  }
  return localReadAll(uid);
}

async function setKeyFor(uid: string, key: string, value: unknown) {
  if (redis) {
    await redis.hset(userKey(uid), { [key]: JSON.stringify(value) });
    return;
  }
  await localSetKey(uid, key, value);
}

export async function GET(request: Request) {
  assertKvConfigured();
  const uid = await resolveUid(request, new URL(request.url).searchParams.get("u"));
  if (!uid) return forbidden();
  return Response.json(await readAllFor(uid));
}

export async function PUT(request: Request) {
  try {
    assertKvConfigured();
    const body = (await request.json()) as {
      key?: string;
      value?: unknown;
      u?: string;
    };
    if (typeof body.key !== "string") {
      return Response.json({ error: "key required" }, { status: 400 });
    }
    // 書き込みも読み取りと**同じ認可**を通す。body.u をそのまま信用すると上書きできてしまう。
    const uid = await resolveUid(request, body.u ?? null);
    if (!uid) return forbidden();
    await setKeyFor(uid, body.key, body.value);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 },
    );
  }
}
