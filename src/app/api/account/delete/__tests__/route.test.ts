// アカウント削除（審査ガイドライン 5.1.1(v)）。
// 「本人だけが」「自分の分だけを」「消し残さず」消せることを固定する（監査 H-10）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { POST } from "../route";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { localReadAll, localSetKey } from "@/lib/storeLocal";
import { addDevice, addSubscription } from "@/lib/pushServer";
import { getUser, putUser, resetAccountDataIdCache } from "@/lib/userStore";

const KEY = "fridge-app:items:v2";
const ME = "me-data-id";
const OTHER = "other-device-uuid";

let dataDir = "";

beforeEach(async () => {
  process.env.COOKSYNC_SESSION_SECRET = "test-secret-value-1234567890";
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cooksync-del-"));
  process.env.COOKSYNC_DATA_DIR = dataDir;
  resetAccountDataIdCache();
  await putUser("me@example.com", { dataId: ME, name: "私", createdAt: 0 });
  await localSetKey(ME, KEY, [{ id: "mine" }]);
  await localSetKey(OTHER, KEY, [{ id: "someone-else" }]);
});
afterEach(async () => {
  delete process.env.COOKSYNC_SESSION_SECRET;
  delete process.env.COOKSYNC_DATA_DIR;
  resetAccountDataIdCache();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

function req(cookie?: string): Request {
  return new Request("http://localhost/api/account/delete", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}
function cookieFor(dataId: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(
    createSession({ uid: dataId, dataId, email: "me@example.com" }),
  )}`;
}

describe("認可", () => {
  it("Cookieが無ければ削除できない（uidの自己申告では消させない）", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await localReadAll(ME))[KEY]).toEqual([{ id: "mine" }]);
  });
});

describe("H-10(a) 消しすぎない", () => {
  it("自分のデータは消え、**他の人のデータは残る**", async () => {
    const res = await POST(req(cookieFor(ME)));
    expect(res.status).toBe(200);
    expect(await localReadAll(ME)).toEqual({});
    expect((await localReadAll(OTHER))[KEY]).toEqual([{ id: "someone-else" }]);
  });

  it("ユーザーレジストリからも消える／セッションも失効する", async () => {
    const res = await POST(req(cookieFor(ME)));
    expect(await getUser("me@example.com")).toBeNull();
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("H-10(c) 通知が消し残らない", () => {
  it("Web Pushの購読もAPNsの端末トークンも消える", async () => {
    await addSubscription(ME, {
      endpoint: "https://example.test/ep",
      keys: { p256dh: "p", auth: "a" },
    });
    await addDevice(ME, "abcdef0123456789");

    await POST(req(cookieFor(ME)));

    const devices = JSON.parse(
      await fs.readFile(path.join(dataDir, "push-devices.json"), "utf8"),
    ) as Record<string, string[]>;
    expect(devices[ME]).toBeUndefined();
    expect(
      JSON.parse(await fs.readFile(path.join(dataDir, "push-subs.json"), "utf8")),
    ).toEqual([]);
  });
});
