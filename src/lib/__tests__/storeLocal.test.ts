// ローカル保存（.data/store.json）が uid ごとに分かれていること（監査 C-8 / H-10(a)）。
//
// 以前はフラットな1ファイルで、誰が読んでも同じ物が返り、
// アカウント削除はそのファイルごと消していた（＝他の人のデータまで巻き添え）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { localDeleteUser, localReadAll, localSetKey } from "../storeLocal";

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
});
