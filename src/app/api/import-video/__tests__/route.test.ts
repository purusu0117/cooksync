// 動画取り込みの「レシピが取れなかった回」を押さえる。
//
// なぜここを固定するか：料理と無関係なURLを貼ると AI は仕様どおり {"recipe":null} を返す。
// これを status:"done" にしてしまうと、クライアントは recipe:undefined のまま
// ImportedRecipePreview に渡し、`r.name` を読んだ瞬間に TypeError で
// **ホーム画面ごと真っ白**になる。しかも枠（月8回）は1回減ったままになる。
// 写真側(import-photo)には元から同じガードがあり、動画側だけ抜けていた。

import { describe, it, expect, beforeEach, vi } from "vitest";

// after() は「レスポンスを返した後」に走る仕組みなので、テストからは
// 取り出して自分で await できるようにしておく（実処理は全部この中にある）。
const h = vi.hoisted(() => ({
  afterTasks: [] as Promise<unknown>[],
  askClaudeForJson: vi.fn(),
  refund: vi.fn(async () => {}),
  consume: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/server", () => ({
  after: (fn: () => Promise<unknown>) => {
    h.afterTasks.push(fn());
  },
}));
vi.mock("@/lib/ai", () => ({ askClaudeForJson: h.askClaudeForJson }));
vi.mock("@/lib/kv", () => ({ redis: null })); // ジョブはメモリに置く
vi.mock("@/lib/session", () => ({ identify: () => ({ uid: "u-test" }) }));
vi.mock("@/lib/quotaServer", () => ({
  consume: h.consume,
  refund: h.refund,
  quotaResponse: () => Response.json({ error: "quota" }, { status: 429 }),
}));
vi.mock("@/lib/videoLocal", () => ({ tryLocalRich: async () => null }));
vi.mock("@/lib/videoMeta", () => ({
  isSupportedVideoUrl: (u: string) => u.includes("youtube.com"),
  fetchVideoMeta: async () => ({
    title: "猫がかわいい",
    channel: "cats",
    description: "",
    webpageUrl: "https://www.youtube.com/watch?v=x",
  }),
}));

import { GET, POST } from "../route";

const URL_OK = "https://www.youtube.com/watch?v=x";

/** POST → after() の完了待ち → GET でジョブの最終状態を取る */
async function runImport(): Promise<Record<string, unknown>> {
  const res = await POST(
    new Request("http://localhost/api/import-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: URL_OK }),
    }),
  );
  const { jobId } = (await res.json()) as { jobId: string };
  await Promise.all(h.afterTasks);
  const got = await GET(new Request(`http://localhost/api/import-video?jobId=${jobId}`));
  return (await got.json()) as Record<string, unknown>;
}

beforeEach(() => {
  h.afterTasks.length = 0;
  h.refund.mockClear();
  h.askClaudeForJson.mockReset();
});

describe("POST /api/import-video", () => {
  it("recipe:null（料理と無関係な動画）は error にして枠も戻す＝ホーム画面が落ちない", async () => {
    h.askClaudeForJson.mockResolvedValue({ recipe: null, confidence: "low" });

    const job = await runImport();

    expect(job.status).toBe("error");
    // クライアントは status:"done" のときしか recipe を渡さない。
    // ＝ undefined が ImportedRecipePreview に届かない、が要点。
    expect(job.recipe).toBeUndefined();
    expect(String(job.error)).toContain("読み取れませんでした");
    expect(h.refund).toHaveBeenCalledWith("u-test", "import", expect.anything());
  });

  it("レシピが取れた回はこれまで通り done で返る（ガードで壊していない）", async () => {
    h.askClaudeForJson.mockResolvedValue({
      recipe: { name: "肉じゃが" },
      missing: ["みりん"],
      confidence: "medium",
    });

    const job = await runImport();

    expect(job.status).toBe("done");
    expect((job.recipe as { name: string }).name).toBe("肉じゃが");
    expect(job.missing).toEqual(["みりん"]);
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("AIが失敗した回は error＋枠を戻す（既存の挙動を保つ）", async () => {
    h.askClaudeForJson.mockRejectedValue(new Error("JSON parse failed"));

    const job = await runImport();

    expect(job.status).toBe("error");
    expect(h.refund).toHaveBeenCalled();
  });
});
