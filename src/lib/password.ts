// パスワードのハッシュ化。
// これまで平文で保存・平文で比較していた（= Redisを覗ける人に全員のパスワードが見える、
// かつ他サービスと使い回していたら被害がそこまで及ぶ）。scrypt に置き換える。
//
// scrypt は Node 標準なので依存を増やさない。bcrypt/argon2 は npm 依存が要る。
// 保存形式: "scrypt$<saltHex>$<hashHex>"

import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;
const PREFIX = "scrypt$";

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(plain, salt, KEYLEN);
  return `${PREFIX}${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** ハッシュ形式で保存されているか（旧データ＝平文の判別用） */
export function isHashed(stored: string): boolean {
  return typeof stored === "string" && stored.startsWith(PREFIX);
}

/**
 * 照合。旧データ（平文）もそのまま受け付ける＝既存ユーザーがログインできなくならないように。
 * 呼び出し側は needsUpgrade が true なら、ログイン成功時にハッシュへ移行して保存する。
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (!stored) return { ok: false, needsUpgrade: false };

  if (!isHashed(stored)) {
    // 旧データ：平文比較。長さを揃えてからtimingSafeEqualする。
    const a = Buffer.from(plain);
    const b = Buffer.from(stored);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    return { ok, needsUpgrade: ok }; // 成功したらこの機会にハッシュ化する
  }

  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return { ok: false, needsUpgrade: false };
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scrypt(plain, Buffer.from(saltHex, "hex"), KEYLEN);
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
    return { ok, needsUpgrade: false };
  } catch {
    return { ok: false, needsUpgrade: false };
  }
}
