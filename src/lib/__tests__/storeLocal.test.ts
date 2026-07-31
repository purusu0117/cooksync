// ローカル保存（.data/store.json）が uid ごとに分かれていること（監査 C-8 / H-10(a)）。
//
// 以前はフラットな1ファイルで、誰が読んでも同じ物が返り、
// アカウント削除はそのファイルごと消していた（＝他の人のデータまで巻き添え）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  localDeleteUser,
  localReadAll,
  localReadAllWithRev,
  localSetKey,
} from "../storeLocal";

const KEY = "fridge-app:items:v2";
let dataDir = "";

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cooksync-local-"));
  process.env.COOKSYNC_DATA_DIR = dataDir;
});
afterEach(async () => {
  delete process.env.COOKSYNC_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

describe("uidごとの分離", () => {
  it("別の uid のデータは見えない", async () => {
    await localSetKey("u1", KEY, [{ id: "a" }]);
    expect(await localReadAll("u2")).toEqual({});
    expect((await localReadAll("u1"))[KEY]).toEqual([{ id: "a" }]);
  });

  it("アカウント削除は**その uid のバケツだけ**を消す", async () => {
    await localSetKey("u1", KEY, [{ id: "a" }]);
    await localSetKey("u2", KEY, [{ id: "b" }]);
    await localDeleteUser("u1");
    expect(await localReadAll("u1")).toEqual({});
    expect((await localReadAll("u2"))[KEY]).toEqual([{ id: "b" }]);
  });
});

describe("旧形式（全員共通のフラットなJSON）からの移行", () => {
  async function writeLegacy() {
    await fs.writeFile(
      path.join(dataDir, "store.json"),
      JSON.stringify({ [KEY]: [{ id: "legacy" }] }),
      "utf8",
    );
  }

  it("最初に読んだ uid が引き継ぐ＝既存データが消えない", async () => {
    await writeLegacy();
    expect((await localReadAll("owner"))[KEY]).toEqual([{ id: "legacy" }]);
    // 2回目以降も同じ人のものとして読める
    expect((await localReadAll("owner"))[KEY]).toEqual([{ id: "legacy" }]);
  });

  it("引き継いだあとは他の uid には渡らない", async () => {
    await writeLegacy();
    await localReadAll("owner");
    expect(await localReadAll("other")).toEqual({});
  });

  it("引き継いだ後も元データはファイルに残す（取り違えても復元できる）", async () => {
    await writeLegacy();
    await localReadAll("owner");
    const f = JSON.parse(await fs.readFile(path.join(dataDir, "store.json"), "utf8"));
    expect(f.legacy[KEY]).toEqual([{ id: "legacy" }]);
    expect(f.legacyOwner).toBe("owner");
  });

  // 監査2周目 中-13：早い者勝ちだったせいで、テスト用の匿名uidが大翔のv1データを
  // 総取りし、ログイン後の本人（dataId側）が空になる状態が実際に起きていた。
  it("匿名uidが先に触っても、あとからログインした本人が空にならない", async () => {
    await writeLegacy();
    await localReadAll("anon-device"); // 匿名が先に読む（＝以前はここで総取り）
    const mine = await localReadAll("my-data-id", { isAccount: true });
    expect(mine[KEY]).toEqual([{ id: "legacy" }]);
  });

  it("引き継ぎはコピー＝先に読んだ匿名側からも消えない", async () => {
    await writeLegacy();
    await localReadAll("anon-device");
    await localReadAll("my-data-id", { isAccount: true });
    expect((await localReadAll("anon-device"))[KEY]).toEqual([{ id: "legacy" }]);
    const f = JSON.parse(await fs.readFile(path.join(dataDir, "store.json"), "utf8"));
    expect(f.legacy[KEY]).toEqual([{ id: "legacy" }]); // 原本も残っている
  });

  it("受け取れるのは匿名1つとアカウント1つまで（他人には渡らない）", async () => {
    await writeLegacy();
    await localReadAll("anon-device");
    await localReadAll("my-data-id", { isAccount: true });
    expect(await localReadAll("someone-else", { isAccount: true })).toEqual({});
    expect(await localReadAll("another-device")).toEqual({});
  });

  it("引き継いだ側が退会しても、もう片方のデータは巻き添えにならない", async () => {
    await writeLegacy();
    await localReadAll("anon-device");
    await localReadAll("my-data-id", { isAccount: true });
    await localDeleteUser("my-data-id");
    expect((await localReadAll("anon-device"))[KEY]).toEqual([{ id: "legacy" }]);
  });
});

// ---------------------------------------------------------------------------

describe("版番号（CAS）", () => {
  it("書くたびに1つ進む／版番号を持たない既存データは 0 から始まる", async () => {
    expect((await localReadAllWithRev("u1")).rev).toBe(0);
    const r1 = await localSetKey("u1", KEY, [{ id: "a" }]);
    expect(r1).toEqual({ ok: true, rev: 1 });
    expect((await localReadAllWithRev("u1")).rev).toBe(1);
  });

  it("版が合わなければ**何も書かずに**断る（別端末の書き込みを踏み潰さない）", async () => {
    await localSetKey("u1", KEY, [{ id: "from-pc" }]); // 別端末が先に書いた（rev=1）
    const res = await localSetKey("u1", KEY, [{ id: "stale" }], { expectRev: 0 });
    expect(res).toEqual({ ok: false, rev: 1 });
    expect((await localReadAll("u1"))[KEY]).toEqual([{ id: "from-pc" }]); // 無傷
  });

  it("読んだ版をそのまま添えれば書ける", async () => {
    await localSetKey("u1", KEY, [{ id: "a" }]);
    const { rev } = await localReadAllWithRev("u1");
    const res = await localSetKey("u1", KEY, [{ id: "b" }], { expectRev: rev });
    expect(res.ok).toBe(true);
    expect((await localReadAll("u1"))[KEY]).toEqual([{ id: "b" }]);
  });

  it("版を添えない呼び出しは従来どおり無条件で書ける（古いクライアントを締め出さない）", async () => {
    await localSetKey("u1", KEY, [{ id: "a" }]);
    const res = await localSetKey("u1", KEY, [{ id: "b" }]);
    expect(res.ok).toBe(true);
  });

  it("uid ごとに独立している（他人の書き込みで自分の版がずれない）", async () => {
    await localSetKey("u1", KEY, [{ id: "a" }]);
    await localSetKey("u2", KEY, [{ id: "b" }]);
    await localSetKey("u2", KEY, [{ id: "c" }]);
    expect((await localReadAllWithRev("u1")).rev).toBe(1);
    expect((await localReadAllWithRev("u2")).rev).toBe(2);
  });
});
