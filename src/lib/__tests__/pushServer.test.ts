// 通知の宛先（uid）を誰が決めるか＝**他人の通知を横取りできないこと**のテスト（監査 H-6）。
//
// /api/push/subscribe は body の `u` を無検証で購読キーにしていたので、
// 攻撃者が被害者のuidで自分のendpointを登録すれば、レシピ名入りの通知が届いた。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { purgePushFor, resolvePushTarget } from "../pushServer";
import { addDevice, addSubscription } from "../pushServer";
import { SESSION_COOKIE, createSession } from "../session";
import { putUser, resetAccountDataIdCache } from "../userStore";

const SECRET = "test-secret-value-1234567890";
const ACCOUNT_ID = "push-account-id";

let dataDir = "";

beforeEach(async () => {
  process.env.COOKSYNC_SESSION_SECRET = SECRET;
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cooksync-push-"));
  process.env.COOKSYNC_DATA_DIR = dataDir;
  resetAccountDataIdCache();
  await putUser("push@example.com", {
    dataId: ACCOUNT_ID,
    name: "本人",
    createdAt: 0,
  });
});
afterEach(async () => {
  delete process.env.COOKSYNC_SESSION_SECRET;
  delete process.env.COOKSYNC_DATA_DIR;
  resetAccountDataIdCache();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

function req(cookie?: string): Request {
  return new Request("http://localhost/api/push/subscribe", {
    headers: cookie ? { cookie } : {},
  });
}
function cookieFor(dataId: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(createSession({ uid: dataId, dataId }))}`;
}

describe("resolvePushTarget", () => {
  it("Cookie無しで**他人（登録済みアカウント）のuid**は名乗れない", async () => {
    expect(await resolvePushTarget(req(), ACCOUNT_ID)).toBeNull();
  });

  it("Cookieがあれば本人の dataId になり、申告値は無視される", async () => {
    const t = await resolvePushTarget(req(cookieFor(ACCOUNT_ID)), "someone-else");
    expect(t).toEqual({ uid: ACCOUNT_ID, trusted: true });
  });

  it("未登録の端末UUIDは従来どおり使える（アプリ版の通知を壊さない）", async () => {
    const t = await resolvePushTarget(req(), "plain-device-uuid");
    expect(t).toEqual({ uid: "plain-device-uuid", trusted: false });
  });

  it("偽造Cookieは信用しない", async () => {
    expect(await resolvePushTarget(req(`${SESSION_COOKIE}=forged.value`), ACCOUNT_ID)).toBeNull();
  });
});

describe("purgePushFor（アカウント削除で通知が残らない）", () => {
  it("購読も端末トークンも消える＝削除後に通知が届かない", async () => {
    await addSubscription(ACCOUNT_ID, {
      endpoint: "https://example.test/ep",
      keys: { p256dh: "p", auth: "a" },
    });
    await addDevice(ACCOUNT_ID, "abcdef0123456789");

    await purgePushFor(ACCOUNT_ID);

    const devices = JSON.parse(
      await fs.readFile(path.join(dataDir, "push-devices.json"), "utf8"),
    ) as Record<string, string[]>;
    expect(devices[ACCOUNT_ID]).toBeUndefined();
    const subs = JSON.parse(await fs.readFile(path.join(dataDir, "push-subs.json"), "utf8"));
    expect(subs).toEqual([]);
  });
});
