// /api/store の**認可**のテスト。
//
// ここが破れると「他人の冷蔵庫・レシピ・献立・買い物リストが全部読めて、書き換えもできる」。
// 2026-08-01 の監査（C-2）で見つかった穴は、テストが1つも無かったから通り抜けた:
//   `?u=<他人のdataId>` を **Cookie無し**で送れば、そのまま採用されていた。
// 以後は必ずここで固定する。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { GET, PUT } from "../route";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { localReadAll, localSetKey } from "@/lib/storeLocal";
import { putUser, resetAccountDataIdCache } from "@/lib/userStore";

const SECRET = "test-secret-value-1234567890";
const FRIDGE = "fridge-app:items:v2";

/** 登録済みユーザー（＝Cookieでしか触れない領域） */
const VICTIM_DATA_ID = "victim-data-id";
/** 一度もアカウントを作っていない端末のUUID（＝従来どおり触れる領域） */
const DEVICE_UUID = "device-uuid-never-registered";

let dataDir = "";

beforeEach(async () => {
  process.env.COOKSYNC_SESSION_SECRET = SECRET;
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cooksync-store-"));
  process.env.COOKSYNC_DATA_DIR = dataDir;
  resetAccountDataIdCache();
  await putUser("victim@example.com", {
    dataId: VICTIM_DATA_ID,
    name: "被害者",
    createdAt: Date.now(),
  });
  await localSetKey(VICTIM_DATA_ID, FRIDGE, [{ id: "1", name: "秘密の牛肉" }]);
});

afterEach(async () => {
  delete process.env.COOKSYNC_SESSION_SECRET;
  delete process.env.COOKSYNC_DATA_DIR;
  resetAccountDataIdCache();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

function cookieFor(dataId: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(createSession({ uid: dataId, dataId }))}`;
}

function getReq(u?: string, cookie?: string): Request {
  const url = u
    ? `http://localhost/api/store?u=${encodeURIComponent(u)}`
    : "http://localhost/api/store";
  return new Request(url, { headers: cookie ? { cookie } : {} });
}

function putReq(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/store", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("C-2 Cookieが無いリクエストは他人のアカウント領域に届かない", () => {
  it("**Cookieを一切付けずに** ?u=<他人のdataId> で読もうとしても403（読めない）", async () => {
    const res = await GET(getReq(VICTIM_DATA_ID));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("秘密の牛肉");
  });

  it("Cookie無しのPUTで他人のデータを上書きできない（中身も壊れない）", async () => {
    const res = await PUT(
      putReq({ key: FRIDGE, value: [{ id: "x", name: "改ざん" }], u: VICTIM_DATA_ID }),
    );
    expect(res.status).toBe(403);
    const after = await localReadAll(VICTIM_DATA_ID);
    expect(after[FRIDGE]).toEqual([{ id: "1", name: "秘密の牛肉" }]);
  });

  it("偽造Cookieでも通らない（署名が合わなければCookie無しと同じ扱い）", async () => {
    const res = await GET(getReq(VICTIM_DATA_ID, `${SESSION_COOKIE}=forged.value`));
    expect(res.status).toBe(403);
  });
});

describe("ログイン済み本人は今までどおり読める（既存データを失わせない）", () => {
  it("セッションCookieがあれば自分のデータが返る", async () => {
    const res = await GET(getReq(VICTIM_DATA_ID, cookieFor(VICTIM_DATA_ID)));
    expect(res.status).toBe(200);
    expect((await res.json())[FRIDGE]).toEqual([{ id: "1", name: "秘密の牛肉" }]);
  });

  it("Cookieがある限り ?u= は完全に無視される（他人のIDを指定しても自分のデータ）", async () => {
    await localSetKey(DEVICE_UUID, FRIDGE, [{ id: "9", name: "他人の卵" }]);
    const res = await GET(getReq(DEVICE_UUID, cookieFor(VICTIM_DATA_ID)));
    expect((await res.json())[FRIDGE]).toEqual([{ id: "1", name: "秘密の牛肉" }]);
  });

  it("保存先のキーは変わっていない＝移行でデータが動かない", async () => {
    await PUT(
      putReq({ key: FRIDGE, value: [{ id: "2", name: "鶏むね" }] }, cookieFor(VICTIM_DATA_ID)),
    );
    // ログイン前と同じ dataId のバケツに書かれている
    expect((await localReadAll(VICTIM_DATA_ID))[FRIDGE]).toEqual([
      { id: "2", name: "鶏むね" },
    ]);
  });
});

describe("未ログインの端末はこれまでどおり使える（締め出さない）", () => {
  it("アカウント未登録のUUIDなら Cookie無しで読み書きできる", async () => {
    const put = await PUT(
      putReq({ key: FRIDGE, value: [{ id: "3", name: "自分の豆腐" }], u: DEVICE_UUID }),
    );
    expect(put.status).toBe(200);
    const res = await GET(getReq(DEVICE_UUID));
    expect(res.status).toBe(200);
    expect((await res.json())[FRIDGE]).toEqual([{ id: "3", name: "自分の豆腐" }]);
  });

  it("端末ごとに分かれている（別UUIDのデータは見えない）", async () => {
    await localSetKey(DEVICE_UUID, FRIDGE, [{ id: "3", name: "自分の豆腐" }]);
    const res = await GET(getReq("another-device-uuid"));
    expect(await res.json()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 版番号（CAS）。GET→PUT の隙間に別端末が書くと最後の書き手が勝っていた問題。
// ---------------------------------------------------------------------------

const REV = "X-CookSync-Rev";

describe("版番号で「最後の書き手が勝つ」を止める", () => {
  it("GET は今の版番号をヘッダで返す", async () => {
    const res = await GET(getReq(VICTIM_DATA_ID, cookieFor(VICTIM_DATA_ID)));
    expect(res.headers.get(REV)).toBe("1"); // beforeEach の1回書き込みぶん
  });

  it("読んだ版を添えて送れば書ける（版は1つ進む）", async () => {
    const cookie = cookieFor(VICTIM_DATA_ID);
    const rev = Number((await GET(getReq(VICTIM_DATA_ID, cookie))).headers.get(REV));
    const put = await PUT(putReq({ key: FRIDGE, value: [{ id: "2" }], rev }, cookie));
    expect(put.status).toBe(200);
    expect(put.headers.get(REV)).toBe(String(rev + 1));
  });

  it("隙間に別端末が書いていたら409で拒否し、**中身は書き換えない**", async () => {
    const cookie = cookieFor(VICTIM_DATA_ID);
    const rev = Number((await GET(getReq(VICTIM_DATA_ID, cookie))).headers.get(REV));

    // ここで別端末（同じアカウントの別デバイス）が先に書いた
    await PUT(putReq({ key: FRIDGE, value: [{ id: "pc", name: "PCが足した" }] }, cookie));

    const stale = await PUT(
      putReq({ key: FRIDGE, value: [{ id: "phone", name: "古い前提" }], rev }, cookie),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("revision_conflict");
    // ★別端末の追加が生きている（踏み潰されていない）
    expect((await localReadAll(VICTIM_DATA_ID))[FRIDGE]).toEqual([
      { id: "pc", name: "PCが足した" },
    ]);
  });

  it("409のあと、返ってきた版で送り直せば通る（自動でやり直せる）", async () => {
    const cookie = cookieFor(VICTIM_DATA_ID);
    const stale = await PUT(putReq({ key: FRIDGE, value: [{ id: "x" }], rev: 99 }, cookie));
    expect(stale.status).toBe(409);
    const cur = Number((await stale.json()).rev);
    const retry = await PUT(putReq({ key: FRIDGE, value: [{ id: "x" }], rev: cur }, cookie));
    expect(retry.status).toBe(200);
  });

  it("rev を送らない古いクライアントは従来どおり書ける（締め出さない）", async () => {
    const cookie = cookieFor(VICTIM_DATA_ID);
    const put = await PUT(putReq({ key: FRIDGE, value: [{ id: "old-client" }] }, cookie));
    expect(put.status).toBe(200);
    expect((await localReadAll(VICTIM_DATA_ID))[FRIDGE]).toEqual([{ id: "old-client" }]);
  });

  it("版番号を持たない既存レコードは rev 0 として扱う（既存データを動かさない）", async () => {
    // 版番号という概念が無かった頃の保存内容をそのまま置く
    await fs.writeFile(
      path.join(dataDir, "store.json"),
      JSON.stringify({
        __ns: 2,
        users: { [DEVICE_UUID]: { [FRIDGE]: [{ id: "既存", name: "前からある食材" }] } },
      }),
      "utf8",
    );
    const res = await GET(getReq(DEVICE_UUID));
    expect(res.headers.get(REV)).toBe("0");
    expect((await res.json())[FRIDGE]).toEqual([{ id: "既存", name: "前からある食材" }]);
    // rev 0 で送れば通る＝移行作業なしで新クライアントが書ける
    const put = await PUT(
      putReq({ key: FRIDGE, value: [{ id: "既存" }, { id: "追加" }], u: DEVICE_UUID, rev: 0 }),
    );
    expect(put.status).toBe(200);
  });

  it("版番号がユーザーのデータに混ざって見えない", async () => {
    const cookie = cookieFor(VICTIM_DATA_ID);
    await PUT(putReq({ key: FRIDGE, value: [{ id: "a" }] }, cookie));
    const body = await (await GET(getReq(VICTIM_DATA_ID, cookie))).json();
    expect(Object.keys(body)).toEqual([FRIDGE]);
  });
});
