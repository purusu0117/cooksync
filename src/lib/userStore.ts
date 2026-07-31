// ユーザーレジストリ（email → dataId）。/api/auth と Googleログインの両方から使う。
//
// **dataId を安定させることが最重要。** dataId が変わると、その人の冷蔵庫・レシピ・献立が
// まるごと見えなくなる。だから Googleログインに移行するときも、
// 同じメールの既存ユーザーが居れば **その人の dataId を引き継ぐ**。

import { promises as fs } from "fs";
import path from "path";
import { redis } from "./kv";

const USERS_KEY = "cooksync:users";
// 保存先。COOKSYNC_DATA_DIR で差し替えられる（テストが大翔の実データを壊さないため）。
function dir(): string {
  return process.env.COOKSYNC_DATA_DIR || path.join(process.cwd(), ".data");
}
function file(): string {
  return path.join(dir(), "users.json");
}

export interface User {
  dataId: string;
  name: string;
  /** scrypt ハッシュ。Googleのみのユーザーは持たない */
  password?: string;
  /** Googleの sub。OAuthで紐づいたら入る */
  googleSub?: string;
  createdAt: number;
}

export function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getUser(email: string): Promise<User | null> {
  if (redis) {
    const v = await redis.hget<unknown>(USERS_KEY, email);
    if (!v) return null;
    return (typeof v === "string" ? JSON.parse(v) : v) as User;
  }
  try {
    const all = JSON.parse(await fs.readFile(file(), "utf8")) as Record<string, User>;
    return all[email] ?? null;
  } catch {
    return null;
  }
}

export async function putUser(email: string, u: User): Promise<void> {
  invalidateDataIdCache();
  if (redis) {
    await redis.hset(USERS_KEY, { [email]: JSON.stringify(u) });
    return;
  }
  await fs.mkdir(dir(), { recursive: true });
  let all: Record<string, User> = {};
  try {
    all = JSON.parse(await fs.readFile(file(), "utf8"));
  } catch {
    /* 初回 */
  }
  all[email] = u;
  await fs.writeFile(file(), JSON.stringify(all), "utf8");
}

/** ユーザーをレジストリから消す（アカウント削除用）。存在しなくてもエラーにしない。 */
export async function deleteUser(email: string): Promise<void> {
  invalidateDataIdCache();
  if (redis) {
    await redis.hdel(USERS_KEY, email);
    return;
  }
  try {
    const all = JSON.parse(await fs.readFile(file(), "utf8")) as Record<string, User>;
    delete all[email];
    await fs.writeFile(file(), JSON.stringify(all), "utf8");
  } catch {
    /* ファイルが無い＝消すものが無い */
  }
}

// ---------------------------------------------------------------------------
// 「その dataId は登録済みアカウントのものか？」
//
// ⚠️ これが**認可の要**（2026-08-01 の監査 C-2）。
//    /api/store は長らく `?u=<dataId>` を無検証で受けていたので、
//    **Cookieを1つも付けずに** 他人の dataId を名乗れば全データが読めて、書き換えもできた。
//    dataId は秘密として守られてもいなかった（HttpOnlyでないCookie・APIのJSON・localStorage）。
//
//    → Cookie（セッション）が無いリクエストは、**登録済みアカウントの dataId には一切届かない**。
//       未ログイン端末が自分のUUIDを使う従来の動きはそのまま＝既存データは1件も動かさない。
// ---------------------------------------------------------------------------

const DATAID_CACHE_MS = 60_000;
let dataIdCache: { at: number; ids: Set<string> } | null = null;

function invalidateDataIdCache(): void {
  dataIdCache = null;
}

/** レジストリ全件。ローカルでファイルが無い場合は「アカウント0件」として扱う。 */
async function allUsers(): Promise<User[]> {
  if (redis) {
    const all = await redis.hgetall<Record<string, unknown>>(USERS_KEY);
    return Object.values(all ?? {}).map((v) =>
      (typeof v === "string" ? JSON.parse(v) : v) as User,
    );
  }
  let raw: string;
  try {
    raw = await fs.readFile(file(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw e;
  }
  return Object.values(JSON.parse(raw) as Record<string, User>);
}

/**
 * 登録済みアカウントの dataId かどうか。
 *
 * レジストリが読めないときは **true（＝アカウントのものかもしれない）** を返す。
 * ここで false に倒すと、Redis障害のあいだだけ認可が外れて他人のデータが読めてしまう。
 */
export async function isAccountDataId(id: string): Promise<boolean> {
  const key = (id || "").trim();
  if (!key || key === "anon") return false;
  const now = Date.now();
  if (!dataIdCache || now - dataIdCache.at > DATAID_CACHE_MS) {
    let users: User[];
    try {
      users = await allUsers();
    } catch {
      return true; // 名簿が読めない → 安全側（触らせない）
    }
    dataIdCache = {
      at: now,
      ids: new Set(users.map((u) => u?.dataId).filter((d): d is string => !!d)),
    };
  }
  return dataIdCache.ids.has(key);
}

/** テスト用：キャッシュを捨てる（レジストリを直接書き換えたときに使う） */
export function resetAccountDataIdCache(): void {
  invalidateDataIdCache();
}

/**
 * Googleプロフィールからユーザーを解決する。
 *  - 同じメールの既存ユーザーが居る → **その dataId を引き継ぐ**（データを失わせない）
 *  - 居ない → 新規作成
 *
 * ⚠️ メール一致で既存アカウントを引き継ぐ以上、**そのメールの所有が証明されていること**が前提。
 *    IDトークンの `email_verified` を見ていなかったため、未検証メールのGoogleアカウントを作れば
 *    既存ユーザー（メール+パスワード登録）のデータを丸ごと乗っ取れた（2026-08-01 監査 H-7）。
 *    → 未検証なら実メールでは引かず、sub基準の擬似メールで**別アカウント**として扱う。
 *      （ログインを拒否せず、かつ他人のデータには絶対に触れさせない）
 */
export async function resolveGoogleUser(profile: {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
}): Promise<{ user: User; email: string; isNew: boolean }> {
  // メールが取れない／所有が証明されていないGoogleアカウントは、subから作った擬似メールで一意にする
  const usableEmail = profile.email && profile.emailVerified === true;
  const email = usableEmail
    ? normEmail(profile.email as string)
    : `google-${profile.sub}@users.noreply`;
  const existing = await getUser(email);

  if (existing) {
    // 既存ユーザー：dataIdは絶対に変えない。googleSubだけ紐づける。
    if (existing.googleSub !== profile.sub) {
      await putUser(email, { ...existing, googleSub: profile.sub });
    }
    return { user: { ...existing, googleSub: profile.sub }, email, isNew: false };
  }

  const user: User = {
    dataId: globalThis.crypto.randomUUID(),
    name: profile.name?.trim() || "ユーザー",
    googleSub: profile.sub,
    createdAt: Date.now(),
  };
  await putUser(email, user);
  return { user, email, isNew: true };
}
