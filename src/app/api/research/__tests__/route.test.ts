// AIリサーチの「0件だった回」を押さえる。
//
// askClaudeRecipes は **例外を投げずに空配列を返す**（max_tokens打ち切り／refusal／
// pause_turn上限などで、寛容パーサが1件も救出できなかったとき）。これを done に
// してしまうと catch が走らないので refund もされず、ユーザーには
// 「レシピが取得できませんでした」とだけ出て、月8回の無料枠が黙って1つ減る。

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  afterTasks: [] as Promise<unknown>[],
  askClaudeRecipes: vi.fn(),
  refund: vi.fn(async () => {}),
  consume: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/kitchen/managedAi", () => ({
  withAiRequest: (fn: unknown) => fn,
  requireActiveAiJob: async () => {},
  requireAiScope: () => ({ owner: "u-test", locationId: "default" }),
  managedAfter: (fn: () => Promise<unknown>) => { h.afterTasks.push(fn()); },
}));

vi.mock("next/server", () => ({
  after: (fn: () => Promise<unknown>) => {
    h.afterTasks.push(fn());
  },
}));
vi.mock("@/lib/ai", () => ({ askClaudeRecipes: h.askClaudeRecipes }));
vi.mock("@/lib/kv", () => ({ redis: null }));
vi.mock("@/lib/session", () => ({ identify: () => ({ uid: "u-test" }) }));
// 通知の宛先は resolvePushTarget を通す（他人に鳴らせないようにした・監査 高-7）。
// モックし忘れると route が import 時に落ちてジョブが作られず、原因が分かりにくい。
vi.mock("@/lib/pushServer", () => ({
  sendPush: async () => {},
  resolvePushTarget: async (_req: Request, claimed?: string | null) => ({
    uid: claimed || "anon",
    trusted: false,
  }),
}));
vi.mock("@/lib/recipeCache", () => ({
  takeFromPool: async () => null, // 共有プールは常に外れ＝必ずAIを呼ぶ経路
  addToPool: async () => {},
}));
vi.mock("@/lib/quotaServer", () => ({
  consume: h.consume,
  refund: h.refund,
  checkIpOnly: async () => true,
  quotaResponse: () => Response.json({ error: "quota" }, { status: 429 }),
}));

import { GET, POST } from "../route";

async function runResearch(body: Record<string, unknown> = { wish: "さっぱりしたもの", servings: 2 }): Promise<Record<string, unknown>> {
  const res = await POST(
    new Request("http://localhost/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const { jobId } = (await res.json()) as { jobId: string };
  await Promise.all(h.afterTasks);
  const got = await GET(new Request(`http://localhost/api/research?jobId=${jobId}`));
  return (await got.json()) as Record<string, unknown>;
}

beforeEach(() => {
  h.afterTasks.length = 0;
  h.refund.mockClear();
  h.askClaudeRecipes.mockReset();
});

describe("POST /api/research", () => {
  it("allows stock and saved recipes without forcing purchases; preserves prepared ingredients and missing data", async () => {
    h.askClaudeRecipes.mockResolvedValue([{ name: "ミートソースグラタン", ingredients: [{ name: "ミートソース", amount: "1食", inventoryKind: "prepared" }], steps: [{ text: "ソースを器に入れる" }], readMissing: ["AI出力が途中で終了したため、一部の候補です"] }, { name: "空の結果" }]);
    const result = await runResearch({ wish: "作り置きを使う。廃止ルールは適用しない", shopMode: "buy" });
    expect(result.status).toBe("done");
    const recipes = result.recipes as { ingredients: { inventoryKind: string }[]; readMissing: string[] }[];
    expect(recipes).toHaveLength(1); expect(recipes[0].ingredients[0].inventoryKind).toBe("prepared"); expect(recipes[0].readMissing).toContain("調理時間");
    expect(recipes[0].readMissing).toContain("AI出力が途中で終了したため、一部の候補です");
    const prompt = h.askClaudeRecipes.mock.calls[0][0];
    expect(prompt).not.toContain("undefined"); expect(prompt).not.toContain("買い物前提・必須"); expect(prompt).not.toContain("在庫だけで作れる料理は出さない");
    expect(prompt).toContain("毎回の新作や買い足しを強制しない"); expect(prompt).toContain("廃止・訂正済みルールを復活させない");
  });
  it("0件は成功ではない＝error にして枠を戻す（枠だけ減る空振りを防ぐ）", async () => {
    h.askClaudeRecipes.mockResolvedValue([]);

    const job = await runResearch();

    expect(job.status).toBe("error");
    expect(h.refund).toHaveBeenCalledWith("u-test", "research", expect.anything());
  });

  it("1件でも取れたら done（0件判定で正常系を巻き込んでいない）", async () => {
    h.askClaudeRecipes.mockResolvedValue([{ name: "冷やし中華", ingredients: [{ name: "麺", amount: "1食" }], steps: [{ text: "茹でる" }] }]);

    const job = await runResearch();

    expect(job.status).toBe("done");
    expect((job.recipes as unknown[]).length).toBe(1);
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("例外で落ちた回はこれまで通り error＋枠を戻す", async () => {
    h.askClaudeRecipes.mockRejectedValue(new Error("Claude CLI timeout"));

    const job = await runResearch();

    expect(job.status).toBe("error");
    expect(h.refund).toHaveBeenCalled();
  });
});
