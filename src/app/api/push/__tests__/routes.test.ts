// 通知APIの認可（監査 H-6）。
//   ・subscribe … 他人のuidで購読を登録できない（＝通知を横取りできない）
//   ・device DELETE … 無認証・token省略で他人の全端末を解除できない
//   ・test … 無認証で任意のuidに通知を撃てない

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { POST as subscribePost } from "../subscribe/route";
import { DELETE as deviceDelete, POST as devicePost } from "../device/route";
import { POST as testPost } from "../test/route";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { putUser, resetAccountDataIdCache } from "@/lib/userStore";

const ACCOUNT_ID = "victim-account-id";
const TOKEN = "abcdef0123456789";

let dataDir = "";

beforeEach(async () => {
  process.env.COOKSYNC_SESSION_SECRET = "test-secret-value-1234567890";
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cooksync-pushapi-"));
  process.env.COOKSYNC_DATA_DIR = dataDir;
  resetAccountDataIdCache();
  await putUser("victim@example.com", {
    dataId: ACCOUNT_ID,
    name: "被害者",
    createdAt: 0,
  });
});
afterEach(async () => {
  delete process.env.COOKSYNC_SESSION_SECRET;
  delete process.env.COOKSYNC_DATA_DIR;
  delete process.env.COOKSYNC_ADMIN_KEY;
  resetAccountDataIdCache();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

function jsonReq(url: string, body: unknown, method: string, cookie?: string): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
function cookieFor(dataId: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(createSession({ uid: dataId, dataId }))}`;
}

describe("/api/push/subscribe", () => {
  const sub = {
    endpoint: "https://attacker.test/ep",
    keys: { p256dh: "p", auth: "a" },
  };

  it("**他人のuidで購読を登録できない**（通知の横取り）", async () => {
    const res = await subscribePost(
      jsonReq("http://localhost/api/push/subscribe", { ...sub, u: ACCOUNT_ID }, "POST"),
    );
    expect(res.status).toBe(403);
    // 被害者の購読ファイルには何も入っていない
    await expect(
      fs.readFile(path.join(dataDir, "push-subs.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("ログイン済み本人なら登録できる", async () => {
    const res = await subscribePost(
      jsonReq(
        "http://localhost/api/push/subscribe",
        { ...sub, u: "whatever" },
        "POST",
        cookieFor(ACCOUNT_ID),
      ),
    );
    expect(res.status).toBe(200);
  });

  it("未登録の端末UUIDは従来どおり登録できる（未ログイン利用を壊さない）", async () => {
    const res = await subscribePost(
      jsonReq("http://localhost/api/push/subscribe", { ...sub, u: "plain-device" }, "POST"),
    );
    expect(res.status).toBe(200);
  });
});

describe("/api/push/device", () => {
  it("他人のuidで端末トークンを登録できない", async () => {
    const res = await devicePost(
      jsonReq("http://localhost/api/push/device", { token: TOKEN, u: ACCOUNT_ID }, "POST"),
    );
    expect(res.status).toBe(403);
  });

  it("**無認証・token省略での一括解除**を受け付けない", async () => {
    // 本人が登録しておく
    await devicePost(
      jsonReq(
        "http://localhost/api/push/device",
        { token: TOKEN },
        "POST",
        cookieFor(ACCOUNT_ID),
      ),
    );
    const res = await deviceDelete(
      jsonReq("http://localhost/api/push/device", { u: ACCOUNT_ID }, "DELETE"),
    );
    expect(res.status).toBe(403);
    const devices = JSON.parse(
      await fs.readFile(path.join(dataDir, "push-devices.json"), "utf8"),
    ) as Record<string, string[]>;
    expect(devices[ACCOUNT_ID]).toEqual([TOKEN]);
  });

  it("未ログイン端末は自分のtokenを示せば解除できる（tokenなしは400）", async () => {
    await devicePost(
      jsonReq("http://localhost/api/push/device", { token: TOKEN, u: "plain-device" }, "POST"),
    );
    const noToken = await deviceDelete(
      jsonReq("http://localhost/api/push/device", { u: "plain-device" }, "DELETE"),
    );
    expect(noToken.status).toBe(400);
    const withToken = await deviceDelete(
      jsonReq(
        "http://localhost/api/push/device",
        { u: "plain-device", token: TOKEN },
        "DELETE",
      ),
    );
    expect(withToken.status).toBe(200);
  });
});

describe("/api/push/test", () => {
  it("無認証では撃てない（誰の端末も鳴らせない）", async () => {
    const res = await testPost(
      jsonReq("http://localhost/api/push/test", { u: ACCOUNT_ID }, "POST"),
    );
    expect(res.status).toBe(401);
  });

  it("未ログイン端末のuidを指定しても撃てない（ログイン必須）", async () => {
    const res = await testPost(
      jsonReq("http://localhost/api/push/test", { u: "plain-device" }, "POST"),
    );
    expect(res.status).toBe(401);
  });

  it("管理鍵があれば大翔の疎通確認として通る", async () => {
    process.env.COOKSYNC_ADMIN_KEY = "0123456789abcdef-admin";
    const res = await testPost(
      jsonReq(
        `http://localhost/api/push/test?key=${process.env.COOKSYNC_ADMIN_KEY}`,
        { u: "plain-device" },
        "POST",
      ),
    );
    expect(res.status).toBe(200);
  });

  it("管理鍵が未設定なら鍵付きでも通さない（fail closed）", async () => {
    const res = await testPost(
      jsonReq("http://localhost/api/push/test?key=whatever", { u: "x" }, "POST"),
    );
    expect(res.status).toBe(401);
  });
});
