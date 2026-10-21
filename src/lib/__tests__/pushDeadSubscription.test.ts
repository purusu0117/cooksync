// 「レシピ探索が終わっても通知が来ない」の再発防止（2026-08-09）。
//
// 実際に起きていたこと：VAPID鍵を作り直したあと、古い鍵で登録された購読に送ると
//   400 {"reason":"VapidPkHashMismatch"}
// が返る。旧実装は 404/410 だけを失効扱いにしていたので、この購読は**捨てられずに
// 残り続け**、以後どれだけ通知を送っても毎回400で消える。送信側は .catch(()=>{})
// なので画面にもログにも何も出ない＝「終わったのに通知が来ない」が延々続いた。
//
// ここで固定するのは2点:
//   ① 400 VapidPkHashMismatch / 403 の購読は**保存から消える**（＝次回開いたとき登録し直す）
//   ② 一時的な失敗（500など）の購読は**消さない**（消すと届く相手を失う）

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const h = vi.hoisted(() => ({ sendNotification: vi.fn() }));

vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: "pub-key", privateKey: "priv-key" }),
    setVapidDetails: () => {},
    sendNotification: h.sendNotification,
  },
}));

import { addSubscription, sendPush } from "../pushServer";

let dataDir = "";

async function storedEndpoints(): Promise<string[]> {
  const raw = await fs.readFile(path.join(dataDir, "push-subs.json"), "utf8");
  return (JSON.parse(raw) as { endpoint: string }[]).map((s) => s.endpoint);
}

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cooksync-deadsub-"));
  process.env.COOKSYNC_DATA_DIR = dataDir;
  h.sendNotification.mockReset();
});
afterEach(async () => {
  delete process.env.COOKSYNC_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

function failWith(statusCode: number, body: string) {
  return Object.assign(new Error("push failed"), { statusCode, body });
}

describe("sendPush：もう届かない購読は捨てる", () => {
  it("400 VapidPkHashMismatch は失効扱い＝購読が消える", async () => {
    await addSubscription("u1", {
      endpoint: "https://web.push.apple.com/old-key-sub",
      keys: { p256dh: "p", auth: "a" },
    });
    h.sendNotification.mockRejectedValue(
      failWith(400, '{"reason":"VapidPkHashMismatch"}'),
    );

    const res = await sendPush("u1", { title: "t", body: "b" });

    expect(res.web).toBe(0);
    expect(await storedEndpoints()).toEqual([]);
    // 何が起きたのかを呼び出し側が受け取れる（黙って0件にしない）
    expect(res.errors.join(" ")).toContain("VapidPkHashMismatch");
  });

  it("403（鍵違い）も失効扱い", async () => {
    await addSubscription("u1", {
      endpoint: "https://fcm.googleapis.com/wrong-key",
      keys: { p256dh: "p", auth: "a" },
    });
    h.sendNotification.mockRejectedValue(failWith(403, "Forbidden"));

    await sendPush("u1", { title: "t", body: "b" });

    expect(await storedEndpoints()).toEqual([]);
  });

  it("500（相手側の一時的な不調）は消さない＝届く相手を失わない", async () => {
    await addSubscription("u1", {
      endpoint: "https://web.push.apple.com/alive",
      keys: { p256dh: "p", auth: "a" },
    });
    h.sendNotification.mockRejectedValue(failWith(500, "Internal Server Error"));

    await sendPush("u1", { title: "t", body: "b" });

    expect(await storedEndpoints()).toEqual(["https://web.push.apple.com/alive"]);
  });

  it("成功した購読はそのまま残り、届いた件数を返す", async () => {
    await addSubscription("u1", {
      endpoint: "https://web.push.apple.com/ok",
      keys: { p256dh: "p", auth: "a" },
    });
    h.sendNotification.mockResolvedValue({ statusCode: 201 });

    const res = await sendPush("u1", { title: "t", body: "b" });

    expect(res.web).toBe(1);
    expect(await storedEndpoints()).toEqual(["https://web.push.apple.com/ok"]);
  });
});
