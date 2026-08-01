// データ保存先。
//  - ローカル（大翔のPC）：JSONファイル .data/store.json（storeLocal.ts・uidごとに分離）。
//  - 公開（Vercel）：Upstash Redis（キー `cooksync:u:<uid>` のhash）。
//    ※ 本番でRedisが無ければ kv.ts が起動時に落とす（全員が同じデータを共有する事故を防ぐ）。

import { assertKvConfigured, redis } from "@/lib/kv";
import { identify } from "@/lib/session";
import { localReadAllWithRev, localSetKey } from "@/lib/storeLocal";
import { isAccountDataId } from "@/lib/userStore";

export const dynamic = "force-dynamic";

// ---- 公開(Redis) ユーザーごと hash: cooksync:u:<uid> ----
function userKey(uid: string): string {
  const safe = uid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anon";
  return `cooksync:u:${safe}`;
}

// ---------------------------------------------------------------------------
// 版番号（楽観ロック／CAS）
// ---------------------------------------------------------------------------
//
// ⚠️ 2026-08-01 監査2周目の残リスク:
//    クライアントは「GET して3方向マージ → PUT」で書く。その **数百msの隙間**に
//    別端末が書くと、こちらのPUTがそれを踏み潰す（last write wins）。
//    サーバーに比較交換(CAS)が無いのが原因。
//
// 直し方: uid ごとに単調増加の版番号を持ち、
//    GET  → レスポンスヘッダ `X-CookSync-Rev` で今の版を返す
//    PUT  → body の `rev` に「読んだ版」を入れる。合わなければ **409** を返して書かない。
//           クライアントは409を受けたら GET からやり直して**マージし直す**（＝踏み潰さない）。
//
// 後方互換（既存ユーザー8人のデータを1バイトも動かさないための取り決め）:
//    ・版番号を持たない既存レコードは **rev 0 とみなす**。キーも保存形式も変えない。
//    ・`rev` を送らない古いクライアント（開きっぱなしのタブ等）は**従来どおり無条件で書ける**。
//      締め出すと、そのタブの未送信データが行き場を失う。
//
// なぜ ETag ヘッダではなく独自ヘッダなのか:
//    ETag は圧縮やプロキシで書き換えられることがあり、`If-None-Match` が付くと
//    **304（本文なし）** が返る余地が生まれる。本文が空＝「サーバーに何も無い」と
//    誤解されると、クライアント側の引き継ぎ判定が誤作動しかねない。
//    そのリスクを持ち込まないため、値は独自ヘッダとJSON本文だけで運ぶ。
const REV_HEADER = "X-CookSync-Rev";
/** Redis hash の中で版番号を入れておくフィールド。データ本体と混ざらないよう `__` 始まり。 */
const REV_FIELD = "__rev";

function toRev(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function revHeaders(rev: number): Record<string, string> {
  return { [REV_HEADER]: String(rev) };
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
 *
 * `isAccount` は「Cookieで本人と確認できた領域か」。ローカルファイル経路で
 * v1データの引き継ぎ先を決めるのに使う（storeLocal.ts / 監査 中-13）。
 */
async function resolveTarget(
  request: Request,
  claimed: string | null,
): Promise<{ uid: string; isAccount: boolean } | null> {
  const q = (claimed || "anon").trim() || "anon";
  const id = identify(request, q);
  if (id.trusted) return { uid: id.dataId, isAccount: true };
  if (q === "anon") return { uid: "anon", isAccount: false };
  if (await isAccountDataId(q)) return null; // 他人（または期限切れの自分）のアカウント領域
  return { uid: q, isAccount: false };
}

/**
 * 日次アクティブの記録（D1/D7残存を出すための最小計測・2026-08-01 マーケ部門）。
 * アプリを開くと必ず同期のGETが飛ぶので、そこに相乗りして日付ごとのSetにuidを入れるだけ。
 * 計測は本流を止めない（失敗は握り潰す）。個人を追跡しない＝uid以外は何も持たない。
 */
function recordActive(uid: string): void {
  if (!redis || !uid || uid === "anon") return;
  const d = new Date().toISOString().slice(0, 10);
  const k = `cooksync:active:${d}`;
  void redis
    .sadd(k, uid)
    .then(() => redis!.expire(k, 60 * 24 * 3600)) // 60日で自然消滅（D30まで見られれば足りる）
    .catch(() => {});
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

async function readAllFor(
  target: { uid: string; isAccount: boolean },
): Promise<{ data: Record<string, unknown>; rev: number }> {
  if (redis) {
    const h = await redis.hgetall<Record<string, unknown>>(userKey(target.uid));
    if (!h) return { data: {}, rev: 0 };
    // Upstashは値をJSONとして返す（文字列なら自前parse）
    const out: Record<string, unknown> = {};
    let rev = 0;
    for (const [k, v] of Object.entries(h)) {
      if (k === REV_FIELD) {
        rev = toRev(v);
        continue; // 版番号はデータ本体ではないので本文に混ぜない
      }
      out[k] = typeof v === "string" ? safeParse(v) : v;
    }
    return { data: out, rev };
  }
  return localReadAllWithRev(target.uid, { isAccount: target.isAccount });
}

// 版番号の突き合わせと書き込みを**不可分**に行う。
// 途中で別端末が割り込んでも、どちらか一方だけが成功する。
const CAS_SCRIPT = `
local cur = redis.call('HGET', KEYS[1], ARGV[3])
if cur == false then cur = 0 else cur = tonumber(cur) or 0 end
if ARGV[4] ~= '' and tonumber(ARGV[4]) ~= cur then
  return {0, cur}
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
local nrev = cur + 1
redis.call('HSET', KEYS[1], ARGV[3], nrev)
return {1, nrev}
`;

async function setKeyFor(
  target: { uid: string; isAccount: boolean },
  key: string,
  value: unknown,
  expectRev: number | null,
): Promise<{ ok: boolean; rev: number }> {
  if (redis) {
    const args = [
      key,
      JSON.stringify(value),
      REV_FIELD,
      expectRev === null ? "" : String(expectRev),
    ];
    try {
      const r = (await redis.eval(CAS_SCRIPT, [userKey(target.uid)], args)) as unknown;
      const arr = Array.isArray(r) ? r : [];
      return { ok: toRev(arr[0]) === 1, rev: toRev(arr[1]) };
    } catch {
      // EVAL が使えない環境でも**書けないよりは書く**。
      // 不可分ではなくなるが、この経路は今までと同じ（＝退化しない）。
      const cur = toRev(await redis.hget(userKey(target.uid), REV_FIELD));
      if (expectRev !== null && expectRev !== cur) return { ok: false, rev: cur };
      await redis.hset(userKey(target.uid), {
        [key]: JSON.stringify(value),
        [REV_FIELD]: cur + 1,
      });
      return { ok: true, rev: cur + 1 };
    }
  }
  return localSetKey(target.uid, key, value, {
    isAccount: target.isAccount,
    expectRev,
  });
}

export async function GET(request: Request) {
  assertKvConfigured();
  const target = await resolveTarget(request, new URL(request.url).searchParams.get("u"));
  if (!target) return forbidden();
  recordActive(target.uid);
  const { data, rev } = await readAllFor(target);
  return Response.json(data, { headers: revHeaders(rev) });
}

export async function PUT(request: Request) {
  try {
    assertKvConfigured();
    const body = (await request.json()) as {
      key?: string;
      value?: unknown;
      u?: string;
      rev?: unknown;
    };
    if (typeof body.key !== "string") {
      return Response.json({ error: "key required" }, { status: 400 });
    }
    // 書き込みも読み取りと**同じ認可**を通す。body.u をそのまま信用すると上書きできてしまう。
    const target = await resolveTarget(request, body.u ?? null);
    if (!target) return forbidden();
    // `rev` を送ってこない古いクライアントは無条件で書く（従来どおり）。
    const expectRev =
      typeof body.rev === "number" && Number.isFinite(body.rev)
        ? Math.max(0, Math.floor(body.rev))
        : null;
    const r = await setKeyFor(target, body.key, body.value, expectRev);
    if (!r.ok) {
      // 別端末が先に書いた。**何も書かずに**現在の版を教える。
      // クライアントは GET からやり直してマージし直すので、どちらの変更も消えない。
      return Response.json(
        {
          error: "他の端末が先に保存しました。読み直して送り直してください。",
          code: "revision_conflict",
          rev: r.rev,
        },
        { status: 409, headers: revHeaders(r.rev) },
      );
    }
    return Response.json({ ok: true, rev: r.rev }, { headers: revHeaders(r.rev) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 },
    );
  }
}
