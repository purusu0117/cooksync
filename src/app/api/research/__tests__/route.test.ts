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

async function runResearch(): Promise<Record<string, unknown>> {
  const res = await POST(
    new Request("http://localhost/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wish: "さっぱりしたもの", servings: 2 }),
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
  it("0件は成功ではない＝error にして枠を戻す（枠だけ減る空振りを防ぐ）", async () => {
    h.askClaudeRecipes.mockResolvedValue([]);

    const job = await runResearch();

    expect(job.status).toBe("error");
    expect(h.refund).toHaveBeenCalledWith("u-test", "research", expect.anything());
  });

  it("1件でも取れたら done（0件判定で正常系を巻き込んでいない）", async () => {
    h.askClaudeRecipes.mockResolvedValue([{ name: "冷やし中華" }]);

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
