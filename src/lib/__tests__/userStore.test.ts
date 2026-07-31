// ユーザーレジストリの2つの安全性を固定する。
//  ① isAccountDataId … Cookie無しリクエストが他人のアカウント領域に届かないための土台（監査 C-2）
//  ② resolveGoogleUser … 未検証メールで既存アカウントを乗っ取れないこと（監査 H-7）

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  getUser,
  isAccountDataId,
  putUser,
  resetAccountDataIdCache,
  resolveGoogleUser,
} from "../userStore";

let dataDir = "";

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cooksync-users-"));
  process.env.COOKSYNC_DATA_DIR = dataDir;
  resetAccountDataIdCache();
});
afterEach(async () => {
  delete process.env.COOKSYNC_DATA_DIR;
  resetAccountDataIdCache();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

describe("isAccountDataId", () => {
  it("登録済みアカウントの dataId を見分ける", async () => {
    await putUser("a@example.com", { dataId: "acct-1", name: "A", createdAt: 0 });
    expect(await isAccountDataId("acct-1")).toBe(true);
    expect(await isAccountDataId("some-device-uuid")).toBe(false);
  });

  it("登録直後から効く（キャッシュで古い答えを返さない）", async () => {
    expect(await isAccountDataId("acct-2")).toBe(false);
    await putUser("b@example.com", { dataId: "acct-2", name: "B", createdAt: 0 });
    expect(await isAccountDataId("acct-2")).toBe(true);
  });

  it("アカウント削除で解除される", async () => {
    await putUser("c@example.com", { dataId: "acct-3", name: "C", createdAt: 0 });
    const { deleteUser } = await import("../userStore");
    await deleteUser("c@example.com");
    expect(await isAccountDataId("acct-3")).toBe(false);
  });

  it("名簿が読めないときは**安全側**に倒す（触らせない）", async () => {
    // ファイルを壊す＝ENOENT以外の読み取り失敗を作る
    await fs.writeFile(path.join(dataDir, "users.json"), "{壊れたJSON", "utf8");
    resetAccountDataIdCache();
    expect(await isAccountDataId("whatever")).toBe(true);
  });

  it("anon・空文字はアカウントではない", async () => {
    expect(await isAccountDataId("anon")).toBe(false);
    expect(await isAccountDataId("")).toBe(false);
  });
});

describe("H-7 Googleログインで email_verified を検証する", () => {
  it("**未検証メール**では既存アカウントの dataId を引き継がない（乗っ取り不可）", async () => {
    await putUser("target@example.com", {
      dataId: "target-data",
      name: "被害者",
      password: "hash",
      createdAt: 0,
    });

    const r = await resolveGoogleUser({
      sub: "attacker-sub",
      email: "target@example.com",
      emailVerified: false,
      name: "攻撃者",
    });

    expect(r.isNew).toBe(true);
    expect(r.user.dataId).not.toBe("target-data");
    expect(r.email).toBe("google-attacker-sub@users.noreply");
    // 被害者のレコードは無傷
    expect((await getUser("target@example.com"))?.dataId).toBe("target-data");
    expect((await getUser("target@example.com"))?.googleSub).toBeUndefined();
  });

  it("email_verified が無い（未指定の）IDトークンも未検証として扱う", async () => {
    await putUser("legacy@example.com", {
      dataId: "legacy-data",
      name: "既存",
      createdAt: 0,
    });
    const r = await resolveGoogleUser({ sub: "s2", email: "legacy@example.com" });
    expect(r.user.dataId).not.toBe("legacy-data");
  });

  it("検証済みメールなら従来どおり既存の dataId を引き継ぐ（データを失わせない）", async () => {
    await putUser("owner@example.com", {
      dataId: "owner-data",
      name: "本人",
      password: "hash",
      createdAt: 0,
    });
    const r = await resolveGoogleUser({
      sub: "owner-sub",
      email: "owner@example.com",
      emailVerified: true,
    });
    expect(r.isNew).toBe(false);
    expect(r.user.dataId).toBe("owner-data");
    expect((await getUser("owner@example.com"))?.googleSub).toBe("owner-sub");
  });

  it("メールが取れないGoogleアカウントは sub 基準で一意になる", async () => {
    const a = await resolveGoogleUser({ sub: "no-mail" });
    const b = await resolveGoogleUser({ sub: "no-mail" });
    expect(b.user.dataId).toBe(a.user.dataId);
  });
});
