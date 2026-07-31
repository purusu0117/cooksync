import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  AD_DISCLOSURE,
  PARTNERS,
  isPartnerId,
  isPlacement,
  needsAdLabel,
  partnerLinks,
  shoppingListText,
} from "../affiliate";
import { logAffiliateClick, readAffiliateSummary } from "../affiliateStats";

const ENV_KEYS = [
  ...PARTNERS.map((p) => p.envKey),
  "NEXT_PUBLIC_SHOPPABLE_PREVIEW",
];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

const FILE = path.join(process.cwd(), ".data", "affiliate.json");

beforeEach(async () => {
  clearEnv();
  await fs.rm(FILE, { force: true }).catch(() => {});
});
afterEach(async () => {
  clearEnv();
  await fs.rm(FILE, { force: true }).catch(() => {});
});

describe("partnerLinks", () => {
  it("未設定なら1件も返さない＝導線が画面に出ない", () => {
    // ASPの登録が済むまでリンクは存在しない。ダミーを出すくらいなら何も出さない。
    expect(partnerLinks()).toEqual([]);
  });

  it("環境変数を入れたぶんだけ出る（他の送客先は出ない）", () => {
    process.env.NEXT_PUBLIC_AFF_OISIX = "https://px.a8.net/svt/ejp?a8mat=XXXX";
    const links = partnerLinks();
    expect(links.map((l) => l.id)).toEqual(["oisix"]);
    expect(links[0].url).toBe("https://px.a8.net/svt/ejp?a8mat=XXXX");
    expect(links[0].sponsored).toBe(true);
  });

  it("PARTNERS の並び順どおりに出る（表示順はこの配列だけで決まる）", () => {
    process.env.NEXT_PUBLIC_AFF_OISIX = "https://example.com/o";
    process.env.NEXT_PUBLIC_AFF_RAKUTEN_SEIYU = "https://example.com/r";
    expect(partnerLinks().map((l) => l.id)).toEqual(["rakuten-seiyu", "oisix"]);
  });

  it("https 以外は無視する（コピペし損ねたゴミを画面に出さない）", () => {
    process.env.NEXT_PUBLIC_AFF_OISIX = "a8mat=XXXX";
    process.env.NEXT_PUBLIC_AFF_RADISH = "http://example.com/insecure";
    expect(partnerLinks()).toEqual([]);
  });

  it("空白だけの設定は未設定と同じ扱い", () => {
    process.env.NEXT_PUBLIC_AFF_OISIX = "   ";
    expect(partnerLinks()).toEqual([]);
  });

  it("プレビューモードは公式サイトの素リンクを出し、広告表記は付けない", () => {
    process.env.NEXT_PUBLIC_SHOPPABLE_PREVIEW = "1";
    const links = partnerLinks();
    expect(links).toHaveLength(PARTNERS.length);
    expect(links.every((l) => l.sponsored === false)).toBe(true);
    expect(needsAdLabel(links)).toBe(false);
  });

  it("プレビュー中でも、成果リンクがある先はそちらを優先し広告表記が付く", () => {
    process.env.NEXT_PUBLIC_SHOPPABLE_PREVIEW = "1";
    process.env.NEXT_PUBLIC_AFF_OISIX = "https://px.a8.net/svt/ejp?a8mat=XXXX";
    const oisix = partnerLinks().find((l) => l.id === "oisix")!;
    expect(oisix.sponsored).toBe(true);
    expect(oisix.url).toContain("a8mat");
    expect(needsAdLabel(partnerLinks())).toBe(true);
  });
});

describe("PARTNERS の定義", () => {
  it("idが重複していない（Redisのフィールド名になるため）", () => {
    const ids = PARTNERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("envKey は NEXT_PUBLIC_ で始まる（クライアントから読めないと導線が出ない）", () => {
    for (const p of PARTNERS) expect(p.envKey.startsWith("NEXT_PUBLIC_")).toBe(true);
  });

  it("広告表記の文面に「広告」と、紹介料の使い道が入っている", () => {
    expect(AD_DISCLOSURE).toContain("広告");
    expect(AD_DISCLOSURE).toContain("紹介料");
  });
});

describe("isPartnerId / isPlacement", () => {
  it("知っている値だけ通す（未知の文字列をRedisのキーにしない）", () => {
    expect(isPartnerId("oisix")).toBe(true);
    expect(isPartnerId("oisix:clicks")).toBe(false);
    expect(isPartnerId("")).toBe(false);
    expect(isPartnerId(null)).toBe(false);
    expect(isPlacement("shopping")).toBe(true);
    expect(isPlacement("recipe")).toBe(true);
    expect(isPlacement("fridge")).toBe(false);
  });
});

describe("shoppingListText", () => {
  it("注文先に貼れる形（1行1品・数量つき）にする", () => {
    expect(
      shoppingListText([
        { name: "玉ねぎ", amount: "1個" },
        { name: "豚こま", amount: "" },
        { name: "にんじん" },
      ]),
    ).toBe("玉ねぎ 1個\n豚こま\nにんじん");
  });

  it("0件なら空文字（コピーボタンを出す側で判定できる）", () => {
    expect(shoppingListText([])).toBe("");
  });
});

describe("logAffiliateClick / readAffiliateSummary", () => {
  it("送客先ごと・置き場所ごとに積み上がる", async () => {
    await logAffiliateClick("oisix", "shopping");
    await logAffiliateClick("oisix", "recipe");
    await logAffiliateClick("rakuten-seiyu", "shopping");

    const s = await readAffiliateSummary();
    expect(s.clicks).toBe(3);
    expect(s.byPartner.oisix.clicks).toBe(2);
    expect(s.byPartner.oisix.byPlacement.shopping).toBe(1);
    expect(s.byPartner.oisix.byPlacement.recipe).toBe(1);
    expect(s.byPartner["rakuten-seiyu"].clicks).toBe(1);
  });

  it("まだ1回も押されていない月は0で返る（読めないと落ちる、をしない）", async () => {
    const s = await readAffiliateSummary("2020-01");
    expect(s.clicks).toBe(0);
    expect(s.byPartner).toEqual({});
  });
});
