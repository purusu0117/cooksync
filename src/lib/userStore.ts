// ユーザーレジストリ（email → dataId）。/api/auth と Googleログインの両方から使う。
//
// **dataId を安定させることが最重要。** dataId が変わると、その人の冷蔵庫・レシピ・献立が
// まるごと見えなくなる。だから Googleログインに移行するときも、
// 同じメールの既存ユーザーが居れば **その人の dataId を引き継ぐ**。

import { promises as fs } from "fs";
import path from "path";
import { redis } from "./kv";

const USERS_KEY = "cooksync:users";
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "users.json");

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
    const all = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, User>;
    return all[email] ?? null;
  } catch {
    return null;
  }
}

export async function putUser(email: string, u: User): Promise<void> {
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

/** ユーザーをレジストリから消す（アカウント削除用）。存在しなくてもエラーにしない。 */
export async function deleteUser(email: string): Promise<void> {
  if (redis) {
    await redis.hdel(USERS_KEY, email);
    return;
  }
  try {
    const all = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, User>;
    delete all[email];
    await fs.writeFile(FILE, JSON.stringify(all), "utf8");
  } catch {
    /* ファイルが無い＝消すものが無い */
  }
}

/**
 * Googleプロフィールからユーザーを解決する。
 *  - 同じメールの既存ユーザーが居る → **その dataId を引き継ぐ**（データを失わせない）
 *  - 居ない → 新規作成
 */
export async function resolveGoogleUser(profile: {
  sub: string;
  email?: string;
  name?: string;
}): Promise<{ user: User; email: string; isNew: boolean }> {
  // メールが取れないGoogleアカウントは基本無いが、無ければsub基準の擬似メールで一意にする
  const email = profile.email ? normEmail(profile.email) : `google-${profile.sub}@users.noreply`;
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
