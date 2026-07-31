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
//   v2: { "__ns": 2, users: { "<uid>": { "<storeKey>": value } }, legacy?, legacyOwner? }
//   v1(旧): { "<storeKey>": value }  … 全員共通だった
//
// 【既存データの移行】v1 のデータは **最初に読んだ uid が引き継ぐ**
// （ローカルは大翔1人なので実質そのまま引き継がれる）。
// 取り違えても復元できるよう、v1の生データは `legacy` に残したまま消さない。

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
  legacy?: Record<string, unknown>;
  legacyOwner?: string;
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

// 読み書きを直列化する（read-modify-write の競合でデータを失わないため）
let lock: Promise<unknown> = Promise.resolve();
function withFile<T>(fn: (f: LocalFile) => Promise<T>): Promise<T> {
  const op = lock.catch(() => {}).then(async () => fn(await readFile()));
  lock = op;
  return op;
}

/** 引き継ぎ手のいない v1 データがあれば、この uid のものとして受け取る */
function claimLegacy(f: LocalFile, uid: string): Record<string, unknown> | null {
  if (!f.legacy || f.legacyOwner) return null;
  f.legacyOwner = uid;
  f.users = { ...(f.users ?? {}), [uid]: { ...f.legacy } };
  return f.users[uid];
}

export async function localReadAll(uid: string): Promise<Record<string, unknown>> {
  return withFile(async (f) => {
    const own = f.users?.[uid];
    if (own) return own;
    const claimed = claimLegacy(f, uid);
    if (claimed) {
      await writeFile(f);
      return claimed;
    }
    return {};
  });
}

export async function localSetKey(
  uid: string,
  key: string,
  value: unknown,
): Promise<void> {
  await withFile(async (f) => {
    const users = f.users ?? {};
    const own = users[uid] ?? claimLegacy(f, uid) ?? {};
    own[key] = value;
    users[uid] = own;
    f.users = users;
    await writeFile(f);
  });
}

/** アカウント削除用：その uid のバケツ**だけ**を消す（他の uid には触れない） */
export async function localDeleteUser(uid: string): Promise<void> {
  await withFile(async (f) => {
    if (f.users?.[uid]) delete f.users[uid];
    if (f.legacyOwner === uid) {
      delete f.legacy;
      delete f.legacyOwner;
    }
    await writeFile(f);
  });
}
