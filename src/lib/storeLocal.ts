// ローカル（大翔のPC）のデータ保存先 `.data/store.json`。**サーバー専用**。
//
// ⚠️ 以前この経路は **uid を一切見ていなかった**（2026-08-01 監査 C-8）。
//    中身は `{ "<storeKey>": value }` のフラット構造で、誰が読んでも同じ物が返る。
//    本番でRedisが未設定のまま起動すると全員が1つの冷蔵庫を共有し、
//    アカウント削除はその共通ファイルごと消していた（監査 H-10(a)）。
//    Redis必須化（kv.ts）で本番はこの経路に来なくなったが、経路そのものも
//    uid ごとのバケツに分け、同じ事故が二度と起きないようにする。
//
// ファイル形式:
//   v2: {
//     "__ns": 2,
//     users: { "<uid>": { "<storeKey>": value } },
//     revs?: { "<uid>": number },      // 楽観ロック用の版番号（後述）
//     legacy?, legacyOwner?, legacyAccountOwner?
//   }
//   v1(旧): { "<storeKey>": value }  … 全員共通だった
//
// 【既存データの移行】v1 のデータは**コピーで**引き継ぐ。元の `legacy` は消さない。
//
// ⚠️ 2026-08-01 監査2周目（中-13）: 以前は「最初に読んだ uid が総取り」だった。
//    ローカル版(3000)で匿名uidが先に触ると匿名バケツが全部持っていき、
//    あとからログインした本人（dataId側）は**空っぽの冷蔵庫**を見ることになる。
//    実際、テスト用の uid が大翔のバケツを名乗ってしまっていた。
//    → 引き継ぎ先を「匿名1つ」と「アカウント1つ」の**最大2つ**にし、
//      アカウントは匿名が先に触っていても受け取れるようにする。
//      `legacy` は原本として残り続けるので、**この処理で1バイトも消えない**（コピーのみ）。
//
// 【版番号(revs)】GET→PUT の隙間に別端末が書くと最後の書き手が勝つ問題（CAS不在）への対応。
//    uid ごとに単調増加のカウンタを持ち、PUT が `expectRev` を伴う場合だけ突き合わせる。
//    - 版番号を持たない既存レコードは **rev 0 とみなす**（後方互換：既存データは動かない）
//    - `expectRev` を送らない古いクライアントは**従来どおり無条件で書ける**（締め出さない）

import { promises as fs } from "fs";
import path from "path";

// 保存先。COOKSYNC_DATA_DIR で差し替えられる（テストが大翔の実データを壊さないため）。
function dir(): string {
  return process.env.COOKSYNC_DATA_DIR || path.join(process.cwd(), ".data");
}
function file(): string {
  return path.join(dir(), "store.json");
}

const NS_VERSION = 2;

interface LocalFile {
  __ns?: number;
  users?: Record<string, Record<string, unknown>>;
  revs?: Record<string, number>;
  legacy?: Record<string, unknown>;
  legacyOwner?: string;
  legacyAccountOwner?: string;
}

/** 呼び出し元が分かっている文脈。`isAccount` は「セッションCookieで本人と確認できた」の意。 */
export interface LocalOpts {
  isAccount?: boolean;
}

export interface LocalWriteResult {
  /** false ＝ 版番号が合わずに書かなかった（呼び出し元は409を返す） */
  ok: boolean;
  /** 書いた後（または現在）の版番号 */
  rev: number;
}

async function readFile(): Promise<LocalFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(file(), "utf8"));
  } catch {
    return { __ns: NS_VERSION, users: {} };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { __ns: NS_VERSION, users: {} };
  }
  const obj = raw as LocalFile;
  if (obj.__ns === NS_VERSION) return { ...obj, users: obj.users ?? {} };
  // v1（フラット）→ v2 の器に載せ替える。中身はまだ誰のものでもない。
  return { __ns: NS_VERSION, users: {}, legacy: raw as Record<string, unknown> };
}

async function writeFile(f: LocalFile): Promise<void> {
  await fs.mkdir(dir(), { recursive: true });
  const target = file();
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(f), "utf8");
  await fs.rename(tmp, target);
}

// 読み書きを直列化する（read-modify-write の競合でデータを失わないため）。
// 版番号の突き合わせ→書き込みも、このロックの中でやるので**不可分**。
let lock: Promise<unknown> = Promise.resolve();
function withFile<T>(fn: (f: LocalFile) => Promise<T>): Promise<T> {
  const op = lock.catch(() => {}).then(async () => fn(await readFile()));
  lock = op;
  return op;
}

function revOf(f: LocalFile, uid: string): number {
  const v = f.revs?.[uid];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function bumpRev(f: LocalFile, uid: string): number {
  const next = revOf(f, uid) + 1;
  f.revs = { ...(f.revs ?? {}), [uid]: next };
  return next;
}

/**
 * v1 データを **コピーで** 受け取る（原本 `f.legacy` は消さない）。
 *
 * 受け取れるのは「匿名の先着1つ」と「アカウントの先着1つ」だけ。
 * こうしないと、匿名uidが総取りしてログイン後のバケツが空になる（中-13）。
 */
function claimLegacy(
  f: LocalFile,
  uid: string,
  isAccount: boolean,
): Record<string, unknown> | null {
  if (!f.legacy) return null;
  if (isAccount) {
    // アカウントは、匿名が先に触っていても受け取れる（奪うのではなくコピー）
    if (f.legacyAccountOwner && f.legacyAccountOwner !== uid) return null;
    f.legacyAccountOwner = uid;
  } else {
    if (f.legacyOwner && f.legacyOwner !== uid) return null;
    f.legacyOwner = uid;
  }
  f.users = { ...(f.users ?? {}), [uid]: { ...f.legacy } };
  return f.users[uid];
}

export async function localReadAll(
  uid: string,
  opts: LocalOpts = {},
): Promise<Record<string, unknown>> {
  return (await localReadAllWithRev(uid, opts)).data;
}

/** 中身と版番号をまとめて読む（GET が ETag 相当を返すために使う） */
export async function localReadAllWithRev(
  uid: string,
  opts: LocalOpts = {},
): Promise<{ data: Record<string, unknown>; rev: number }> {
  return withFile(async (f) => {
    const own = f.users?.[uid];
    if (own) return { data: own, rev: revOf(f, uid) };
    const claimed = claimLegacy(f, uid, !!opts.isAccount);
    if (claimed) {
      await writeFile(f);
      return { data: claimed, rev: revOf(f, uid) };
    }
    return { data: {}, rev: revOf(f, uid) };
  });
}

/**
 * 1キーを書く。
 *
 * `expectRev` が数値なら **その版と一致するときだけ**書く（compare-and-set）。
 * 一致しなければ何も書かずに `{ ok:false, rev:現在値 }` を返す。
 * `expectRev` を省略した呼び出しは従来どおり無条件で書く（古いクライアント互換）。
 */
export async function localSetKey(
  uid: string,
  key: string,
  value: unknown,
  opts: LocalOpts & { expectRev?: number | null } = {},
): Promise<LocalWriteResult> {
  return withFile(async (f) => {
    const cur = revOf(f, uid);
    if (typeof opts.expectRev === "number" && opts.expectRev !== cur) {
      return { ok: false, rev: cur };
    }
    const users = f.users ?? {};
    const own = users[uid] ?? claimLegacy(f, uid, !!opts.isAccount) ?? {};
    own[key] = value;
    users[uid] = own;
    f.users = users;
    const rev = bumpRev(f, uid);
    await writeFile(f);
    return { ok: true, rev };
  });
}

/** アカウント削除用：その uid のバケツ**だけ**を消す（他の uid には触れない） */
export async function localDeleteUser(uid: string): Promise<void> {
  await withFile(async (f) => {
    if (f.users?.[uid]) delete f.users[uid];
    if (f.revs?.[uid] !== undefined) delete f.revs[uid];
    if (f.legacyOwner === uid) delete f.legacyOwner;
    if (f.legacyAccountOwner === uid) delete f.legacyAccountOwner;
    // v1の原本は「まだ誰かが引き継いでいる間」は残す。
    // 最後の引き継ぎ手が退会したときだけ消す（削除の要求は必ず守る／
    // 一方でもう一方の持ち主が居るのに巻き添えで消すこともしない）。
    if (!f.legacyOwner && !f.legacyAccountOwner) delete f.legacy;
    await writeFile(f);
  });
}
