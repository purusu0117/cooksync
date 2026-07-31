// 賞味期限のまとめ通知の回帰テスト。
// ここで固定したいのは「うるさくない」ことと「取りこぼさない」ことの両立：
//   ・対象が0件なら送らない（毎日「何もありません」を送らない）
//   ・何件あっても**1通にまとめる**（食材ごとに何通も鳴らさない）
//   ・同じ食材で毎日鳴らし続けない（知らせ済みを記録する）
//   ・段階が進んだら（3日前→当日）ちゃんともう一度知らせる
//   ・設定した時刻以外では送らない
//   ・届かなかった日は「知らせ済み」にしない（許可し直した人が取りこぼさない）

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  DEFAULT_EXPIRY_SETTINGS,
  FRIDGE_STORE_KEY,
  buildExpiryPush,
  listNotifyUids,
  localDateISO,
  localHour,
  normalizeSettings,
  pickExpiryTargets,
  readSettings,
  runExpiryNotifications,
  writeSettings,
  type ExpirySettings,
} from "../expiryNotify";
import { localSetKey } from "../storeLocal";
import { fridgeStore } from "../storage";
import type { FridgeItem } from "../food";

const UID = "expiry-test-uid";
const JST = -540; // getTimezoneOffset() の日本の値
// JSTで 2026-08-01(土) 18:00
const AT_18 = new Date("2026-08-01T09:00:00Z");
const NEXT_DAY_18 = new Date("2026-08-02T09:00:00Z");

let dataDir = "";

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cooksync-expiry-"));
  process.env.COOKSYNC_DATA_DIR = dataDir;
});
afterEach(async () => {
  delete process.env.COOKSYNC_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

function item(name: string, expiresOn: string, id = name): FridgeItem {
  return {
    id,
    name,
    quantity: "1個",
    category: "肉・魚",
    zone: "生鮮",
    purchasedOn: "2026-07-28",
    expiresOn,
    createdAt: 0,
  };
}

async function setFridge(items: FridgeItem[]): Promise<void> {
  await localSetKey(UID, FRIDGE_STORE_KEY, items);
}

async function enableFor(patch: Partial<ExpirySettings> = {}): Promise<void> {
  await writeSettings(UID, {
    ...DEFAULT_EXPIRY_SETTINGS,
    enabled: true,
    hour: 18,
    tzOffsetMinutes: JST,
    ...patch,
  });
}

/** 送信のふり。既定は「1件届いた」＝現実の成功と同じ扱い */
function spy(reached = 1) {
  const calls: { uid: string; title: string; body: string; url?: string }[] = [];
  const send = async (
    uid: string,
    p: { title: string; body: string; url?: string },
  ): Promise<{ web: number; native: number }> => {
    calls.push({ uid, ...p });
    return { web: reached, native: 0 };
  };
  return { calls, send };
}

describe("保存キーが冷蔵庫と一致している", () => {
  it("ズレると通知が永遠に0件になるので固定する", () => {
    expect(FRIDGE_STORE_KEY).toBe(fridgeStore.key);
  });
});

describe("現地時刻の計算", () => {
  it("JSTの日付と時刻になる（サーバーがUTCでも日本時間で判定する）", () => {
    expect(localDateISO(AT_18, JST)).toBe("2026-08-01");
    expect(localHour(AT_18, JST)).toBe(18);
    // UTCでは日付が前日に戻る時刻でも、JSTでは翌日として扱う
    expect(localDateISO(new Date("2026-08-01T16:00:00Z"), JST)).toBe("2026-08-02");
  });
});

describe("pickExpiryTargets（誰を知らせるか）", () => {
  const today = "2026-08-01";
  const settings = { leadDays: [1, 3] };

  it("期限切れと当日は、選択に関わらず必ず対象", () => {
    const got = pickExpiryTargets(
      [item("鶏むね", "2026-07-30"), item("豚こま", "2026-08-01")],
      settings,
      today,
    );
    expect(got.map((t) => t.item.name)).toEqual(["鶏むね", "豚こま"]);
  });

  it("「ちょうどN日前」だけが対象。間の日は対象外＝毎日同じ食材が並ばない", () => {
    const got = pickExpiryTargets(
      [
        item("明日まで", "2026-08-02"), // 1日前 → 対象
        item("2日後", "2026-08-03"), // 選んでいない → 対象外
        item("3日後", "2026-08-04"), // 3日前 → 対象
        item("先の話", "2026-08-20"),
      ],
      settings,
      today,
    );
    expect(got.map((t) => t.item.name)).toEqual(["明日まで", "3日後"]);
  });

  it("期限が壊れている行は無視する（通知でクラッシュさせない）", () => {
    const broken = { ...item("謎", "いつか"), expiresOn: "いつか" } as FridgeItem;
    expect(pickExpiryTargets([broken], settings, today)).toEqual([]);
  });
});

describe("buildExpiryPush（まとめて1通）", () => {
  it("先頭1件を名指しし、残りは「ほか2件」にまとめる", () => {
    const targets = pickExpiryTargets(
      [item("豚こま切れ", "2026-08-01"), item("牛乳", "2026-08-02"), item("豆腐", "2026-08-02")],
      { leadDays: [1] },
      "2026-08-01",
    );
    const push = buildExpiryPush(targets, "2026-08-01");
    expect(push.title).toBe("🔴 期限が近い食材が3件");
    expect(push.body).toContain("豚こま切れが今日までです");
    expect(push.body).toContain("ほか2件");
    expect(push.url).toBe("/fridge");
  });

  it("1件のときは「ほか」を付けない", () => {
    const targets = pickExpiryTargets([item("卵", "2026-08-02")], { leadDays: [1] }, "2026-08-01");
    const push = buildExpiryPush(targets, "2026-08-01");
    expect(push.body).toContain("卵が明日までです");
    expect(push.body).not.toContain("ほか");
  });
});

describe("normalizeSettings（おかしな値を持ち込ませない）", () => {
  it("範囲外・重複・空を既定値に丸める", () => {
    const s = normalizeSettings({ enabled: true, leadDays: [3, 3, 999, -1], hour: 99, tzOffsetMinutes: 9999 });
    expect(s.leadDays).toEqual([3]);
    expect(s.hour).toBe(DEFAULT_EXPIRY_SETTINGS.hour);
    expect(s.tzOffsetMinutes).toBe(DEFAULT_EXPIRY_SETTINGS.tzOffsetMinutes);
    expect(normalizeSettings({ leadDays: [] }).leadDays).toEqual(DEFAULT_EXPIRY_SETTINGS.leadDays);
  });
});

describe("runExpiryNotifications（定期実行）", () => {
  it("対象が0件なら1通も送らない", async () => {
    await enableFor();
    await setFridge([item("ケチャップ", "2026-12-31")]);
    const { calls, send } = spy();
    const res = await runExpiryNotifications({ now: AT_18, send });
    expect(calls).toHaveLength(0);
    expect(res).toEqual({ scanned: 1, notified: 0, items: 0 });
  });

  it("何件あっても**1通だけ**送る", async () => {
    await enableFor();
    await setFridge([
      item("豚こま切れ", "2026-08-01"),
      item("牛乳", "2026-08-02"),
      item("豆腐", "2026-08-04"),
    ]);
    const { calls, send } = spy();
    const res = await runExpiryNotifications({ now: AT_18, send });
    expect(calls).toHaveLength(1);
    expect(calls[0].uid).toBe(UID);
    expect(calls[0].body).toContain("ほか2件");
    expect(res.notified).toBe(1);
    expect(res.items).toBe(3);
  });

  it("同じ日に何度叩かれても2通目は送らない（QStashの再送で二重に鳴らさない）", async () => {
    await enableFor();
    await setFridge([item("豚こま切れ", "2026-08-01")]);
    const { calls, send } = spy();
    await runExpiryNotifications({ now: AT_18, send });
    await runExpiryNotifications({ now: AT_18, send });
    await runExpiryNotifications({ now: new Date("2026-08-01T09:30:00Z"), send });
    expect(calls).toHaveLength(1);
  });

  it("同じ食材・同じ段階では翌日も鳴らさない（毎日うるさくしない）", async () => {
    await enableFor();
    // 期限切れの食材は毎日「期限切れ」のままなので、放置すると毎日鳴る
    await setFridge([item("鶏むね", "2026-08-01")]);
    const { calls, send } = spy();
    await runExpiryNotifications({ now: AT_18, send });
    await runExpiryNotifications({ now: NEXT_DAY_18, send });
    await runExpiryNotifications({ now: new Date("2026-08-03T09:00:00Z"), send });
    expect(calls).toHaveLength(1);
  });

  it("段階が進んだら（3日前 → 当日）ちゃんともう一度知らせる", async () => {
    await enableFor({ leadDays: [3] });
    await setFridge([item("ぶり", "2026-08-04")]);
    const { calls, send } = spy();
    await runExpiryNotifications({ now: AT_18, send }); // 3日前
    await runExpiryNotifications({ now: NEXT_DAY_18, send }); // 2日前＝対象外
    await runExpiryNotifications({ now: new Date("2026-08-04T09:00:00Z"), send }); // 当日
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toContain("あと3日");
    expect(calls[1].body).toContain("今日まで");
  });

  it("設定した時刻でなければ送らない（18時設定の人に朝は送らない）", async () => {
    await enableFor({ hour: 18 });
    await setFridge([item("豚こま切れ", "2026-08-01")]);
    const { calls, send } = spy();
    await runExpiryNotifications({ now: new Date("2026-08-01T00:00:00Z"), send }); // JST 9時
    expect(calls).toHaveLength(0);
    await runExpiryNotifications({ now: AT_18, send });
    expect(calls).toHaveLength(1);
  });

  it("オフの人は巡回しない", async () => {
    await enableFor({ enabled: false });
    await setFridge([item("豚こま切れ", "2026-08-01")]);
    const { calls, send } = spy();
    const res = await runExpiryNotifications({ now: AT_18, send });
    expect(calls).toHaveLength(0);
    expect(res.scanned).toBe(0);
    expect(await listNotifyUids()).not.toContain(UID);
  });

  it("宛先が無くて届かなかった日は「知らせ済み」にしない（許可し直した人が取りこぼさない）", async () => {
    await enableFor();
    await setFridge([item("豚こま切れ", "2026-08-01")]);

    const dead = spy(0); // 1件も届かない日
    await runExpiryNotifications({ now: AT_18, send: dead.send });
    expect(dead.calls).toHaveLength(1);
    expect((await readSettings(UID))?.misses).toBe(1);

    // 翌日：届かなかったぶんは記録していないので、改めて知らせる
    const alive = spy();
    await runExpiryNotifications({ now: NEXT_DAY_18, send: alive.send });
    expect(alive.calls).toHaveLength(1);
    expect((await readSettings(UID))?.misses).toBe(0);

    // 届いた翌日はもう鳴らさない
    await runExpiryNotifications({ now: new Date("2026-08-03T09:00:00Z"), send: alive.send });
    expect(alive.calls).toHaveLength(1);
  });

  it("届かない日が続いたら自動でオフにする（消えた端末を永遠に巡回しない）", async () => {
    await enableFor();
    // 毎日1つずつ期限が来る＝毎日「送ろうとする」状態を作る
    await setFridge(
      [13, 14, 15, 16, 17, 18, 19].map((d) =>
        item(`食材${d}`, `2026-08-${d}`, `id-${d}`),
      ),
    );
    const dead = spy(0);
    for (let d = 13; d <= 19; d++) {
      await runExpiryNotifications({ now: new Date(`2026-08-${d}T09:00:00Z`), send: dead.send });
    }
    expect(dead.calls).toHaveLength(7);
    expect((await readSettings(UID))?.enabled).toBe(false);
    expect(await listNotifyUids()).not.toContain(UID);
  });

  it("**他人には送らない**：宛先は登録された uid のみで、他人の uid は混ざらない", async () => {
    await enableFor();
    await setFridge([item("豚こま切れ", "2026-08-01")]);
    // 他人（通知OFF・未登録）の冷蔵庫にも期限切れがある
    await localSetKey("someone-else", FRIDGE_STORE_KEY, [item("他人の牛乳", "2026-08-01")]);
    const { calls, send } = spy();
    await runExpiryNotifications({ now: AT_18, send });
    expect(calls.map((c) => c.uid)).toEqual([UID]);
    expect(calls[0].body).not.toContain("他人の牛乳");
  });
});
