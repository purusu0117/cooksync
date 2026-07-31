// クリック計測APIと、それが /api/admin/stats から見えることを押さえる。
//
// 特に大事なのは「知らない文字列を弾く」方。partner / placement は
// そのまま Redis の hash フィールド名になるので、通してしまうと外から任意のキーを
// 書き込める（集計が汚れて、どの導線が効いているのか分からなくなる）。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { POST } from "../route";
import { GET } from "@/app/api/admin/stats/route";

const FILE = path.join(process.cwd(), ".data", "affiliate.json");
// 16文字未満の鍵は route 側が fail closed で弾く仕様なので、十分な長さにする
const ADMIN_KEY = "cooksync-admin-key-for-test-0123456789";

function click(body: unknown) {
  return POST(
    new Request("http://localhost/api/affiliate/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  process.env.COOKSYNC_ADMIN_KEY = ADMIN_KEY;
  process.env.NEXT_PUBLIC_AFF_OISIX = "https://px.a8.net/svt/ejp?a8mat=X";
  await fs.rm(FILE, { force: true }).catch(() => {});
});
afterEach(async () => {
  delete process.env.COOKSYNC_ADMIN_KEY;
  delete process.env.NEXT_PUBLIC_AFF_OISIX;
  await fs.rm(FILE, { force: true }).catch(() => {});
});

describe("POST /api/affiliate/click", () => {
  it("正しい値は204で記録される（sendBeaconは本文を読まないので中身を返さない）", async () => {
    const res = await click({ partner: "oisix", placement: "shopping" });
    expect(res.status).toBe(204);
    await click({ partner: "oisix", placement: "recipe" });
    const db = JSON.parse(await fs.readFile(FILE, "utf8"));
    const m = new Date().toISOString().slice(0, 7);
    expect(db[m].clicks).toBe(2);
    expect(db[m].byPartner.oisix.byPlacement.recipe).toBe(1);
  });

  it("知らない送客先・置き場所は400で弾き、1件も書き込まない", async () => {
    expect((await click({ partner: "oisix:clicks", placement: "shopping" })).status).toBe(400);
    expect((await click({ partner: "oisix", placement: "../etc" })).status).toBe(400);
    expect((await click({})).status).toBe(400);
    await expect(fs.readFile(FILE, "utf8")).rejects.toThrow();
  });
});

describe("GET /api/admin/stats", () => {
  it("鍵が違えば403のまま（既存の保護を弱めていない）", async () => {
    const res = await GET(new Request("http://localhost/api/admin/stats?key=wrong"));
    expect(res.status).toBe(403);
  });

  it("AI原価と並べてクリック内訳が見える（支出と収入の先行指標を同じ画面で見る）", async () => {
    await click({ partner: "oisix", placement: "shopping" });
    const res = await GET(
      new Request(`http://localhost/api/admin/stats?key=${ADMIN_KEY}`),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cost).toBeDefined();
    expect(data.affiliate.clicks).toBe(1);
    expect(data.affiliate.byPartner.oisix.byPlacement.shopping).toBe(1);
    // 押されていない理由が「導線が出ていないから」なのか切り分けられるようにする
    expect(data.affiliate.configured).toEqual(["oisix"]);
  });
});
