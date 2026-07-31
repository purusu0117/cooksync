// 期限通知APIの認可テスト。
//   ・設定の保存は **他人の uid を名乗れない**（＝他人の冷蔵庫の中身が載った通知を横取りできない）
//   ・定期実行の発射口は、署名も管理鍵も無ければ通さない（本番で fail closed）

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { GET as settingsGet, POST as settingsPost } from "../route";
import { POST as runPost } from "../run/route";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { putUser, resetAccountDataIdCache } from "@/lib/userStore";
import { listNotifyUids, readSettings } from "@/lib/expiryNotify";

const ACCOUNT_ID = "expiry-victim-id";
const ADMIN_KEY = "0123456789abcdef-admin";

let dataDir = "";

beforeEach(async () => {
  process.env.COOKSYNC_SESSION_SECRET = "test-secret-value-1234567890";
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cooksync-expiryapi-"));
  process.env.COOKSYNC_DATA_DIR = dataDir;
  resetAccountDataIdCache();
  await putUser("victim@example.com", { dataId: ACCOUNT_ID, name: "被害者", createdAt: 0 });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  delete process.env.COOKSYNC_SESSION_SECRET;
  delete process.env.COOKSYNC_DATA_DIR;
  delete process.env.COOKSYNC_ADMIN_KEY;
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;
  resetAccountDataIdCache();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

function jsonReq(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
function cookieFor(dataId: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(createSession({ uid: dataId, dataId }))}`;
}
const ON = { enabled: true, leadDays: [1, 3], hour: 18, tzOffsetMinutes: -540 };

describe("/api/notify-expiry（設定）", () => {
  it("**他人のuidで通知をオンにできない**（他人宛ての通知を作れない）", async () => {
    const res = await settingsPost(
      jsonReq("http://localhost/api/notify-expiry", { ...ON, u: ACCOUNT_ID }),
    );
    expect(res.status).toBe(403);
    expect(await readSettings(ACCOUNT_ID)).toBeNull();
    expect(await listNotifyUids()).not.toContain(ACCOUNT_ID);
  });

  it("ログイン済み本人なら保存でき、申告した u は無視される", async () => {
    const res = await settingsPost(
      jsonReq("http://localhost/api/notify-expiry", { ...ON, u: "someone-else" }, cookieFor(ACCOUNT_ID)),
    );
    expect(res.status).toBe(200);
    expect((await readSettings(ACCOUNT_ID))?.enabled).toBe(true);
    expect(await listNotifyUids()).toEqual([ACCOUNT_ID]);
    expect(await readSettings("someone-else")).toBeNull();
  });

  it("未登録の端末UUIDは従来どおり自分ぶんを保存できる（未ログイン利用を壊さない）", async () => {
    const res = await settingsPost(
      jsonReq("http://localhost/api/notify-expiry", { ...ON, u: "plain-device" }),
    );
    expect(res.status).toBe(200);
    expect((await readSettings("plain-device"))?.hour).toBe(18);
  });

  it("オフにすると巡回対象から外れる", async () => {
    const cookie = cookieFor(ACCOUNT_ID);
    await settingsPost(jsonReq("http://localhost/api/notify-expiry", ON, cookie));
    await settingsPost(
      jsonReq("http://localhost/api/notify-expiry", { ...ON, enabled: false }, cookie),
    );
    expect(await listNotifyUids()).not.toContain(ACCOUNT_ID);
  });

  it("GETは既定値と選択肢を返す（画面はこれを初期表示に使う）", async () => {
    const res = await settingsGet(
      new Request("http://localhost/api/notify-expiry?u=plain-device"),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      settings: { enabled: boolean; hour: number; leadDays: number[] };
      choices: { hours: number[]; leadDays: number[] };
    };
    expect(data.settings.enabled).toBe(false);
    expect(data.settings.hour).toBe(18); // 帰宅途中の夕方
    expect(data.settings.leadDays).toEqual([1, 3]);
    expect(data.choices.hours).toContain(18);
  });

  it("GETも他人のuidは名乗れない（設定を覗けない）", async () => {
    const res = await settingsGet(
      new Request(`http://localhost/api/notify-expiry?u=${ACCOUNT_ID}`),
    );
    expect(res.status).toBe(403);
  });
});

describe("/api/notify-expiry/run（発射口）", () => {
  it("本番で署名鍵が無ければ受け付けない（fail closed）", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await runPost(jsonReq("http://localhost/api/notify-expiry/run", {}));
    expect(res.status).toBe(503);
  });

  it("署名が正しくなければ受け付けない（誰でも通知を撃てないようにする）", async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = "sig_current_key";
    process.env.QSTASH_NEXT_SIGNING_KEY = "sig_next_key";
    const res = await runPost(jsonReq("http://localhost/api/notify-expiry/run", {}));
    expect(res.status).toBe(401);
  });

  it("管理鍵があれば大翔の手動確認として通る", async () => {
    process.env.COOKSYNC_ADMIN_KEY = ADMIN_KEY;
    process.env.QSTASH_CURRENT_SIGNING_KEY = "sig_current_key";
    process.env.QSTASH_NEXT_SIGNING_KEY = "sig_next_key";
    const res = await runPost(
      jsonReq(`http://localhost/api/notify-expiry/run?key=${ADMIN_KEY}`, { force: true }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, scanned: 0, notified: 0 });
  });
});
