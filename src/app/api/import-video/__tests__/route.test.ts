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
  description: "材料と手順が記載された説明欄",
}));
// Routing/authentication is tested separately with real signed sessions.
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
// 映像のコマがある回は askClaudeForJsonWithImages を通るが、この一連のテストは
// 「コマが1枚も取れなかった回」を見ているので、どちらも同じモックに寄せる。
vi.mock("@/lib/ai", () => ({
  askClaudeForJson: h.askClaudeForJson,
  askClaudeForJsonWithImages: (p: string) => h.askClaudeForJson(p),
}));
vi.mock("@/lib/kv", () => ({ redis: null })); // ジョブはメモリに置く
vi.mock("@/lib/session", () => ({ identify: () => ({ uid: "u-test" }) }));
vi.mock("@/lib/pushServer", () => ({
  sendPush: async () => ({ web: 0, native: 0, errors: [] }),
  resolvePushTarget: async () => null,
}));
vi.mock("@/lib/quotaServer", () => ({
  consume: h.consume,
  refund: h.refund,
  quotaResponse: () => Response.json({ error: "quota" }, { status: 429 }),
}));
vi.mock("@/lib/videoLocal", () => ({
  tryLocalRich: async () => null,
  localAvailable: () => false,
}));
vi.mock("@/lib/videoMeta", () => ({
  isSupportedVideoUrl: (u: string) => u.includes("youtube.com"),
  extractVideoUrl: (u: string) => u.trim(),
  fetchVideoMeta: async () => ({
    title: "猫がかわいい",
    channel: "cats",
    description: h.description,
    webpageUrl: "https://www.youtube.com/watch?v=x",
  }),
}));

import { GET, POST } from "../route";
import { videoEvidenceLabel } from "@/lib/kitchen/videoFrames";

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
  h.description = "材料と手順が記載された説明欄";
});

describe("POST /api/import-video", () => {
  it("取得素材が空ならAIへ渡さず失敗にする", async () => {
    h.description = "";
    const job = await runImport();
    expect(job.status).toBe("error");
    expect(h.askClaudeForJson).not.toHaveBeenCalled();
  });

  // oEmbed でタイトル・投稿者だけ取れた回（TikTok/Instagramで起きる）は素材ゼロ＝取得不能。
  // タイトルを素材扱いしてAIに“それらしいレシピ”を作らせない。
  it("タイトル・投稿者だけ（説明欄が空白）でも取得不能＝何が無いかとAI未実行を伝え、枠を戻す", async () => {
    h.description = " \t ";
    const job = await runImport();
    expect(job.status).toBe("error");
    expect(h.askClaudeForJson).not.toHaveBeenCalled();
    expect(String(job.error)).toContain("説明欄・字幕・映像のいずれも取得できませんでした");
    expect(String(job.error)).toContain("タイトルと投稿者名だけでは読み取りません");
    expect(String(job.error)).toContain("AIは実行していない");
    expect(String(job.detail)).toBe("obtained=none unavailable=description+captions+frames ai=not-run");
    expect(h.refund).toHaveBeenCalledWith("u-test", "import", expect.anything());
  });

  it("説明欄だけの回：AIには「映像は見ていない・字幕なし」と渡し、done の evidence とラベルも「説明欄だけ」になる", async () => {
    h.askClaudeForJson.mockResolvedValue({
      recipe: {
        name: "肉じゃが",
        ingredients: [{ name: "じゃがいも", amount: "3個" }],
        steps: [{ title: "下準備", text: "じゃがいもを切る" }],
      },
      confidence: "high",
    });

    const job = await runImport();

    const prompt = String(h.askClaudeForJson.mock.calls[0][0]);
    expect(prompt).toContain(h.description);
    expect(prompt).toContain("■ 映像: 見ていません");
    expect(prompt).toContain("■ 字幕: 取得できません");

    expect(job.status).toBe("done");
    const evidence = job.evidence as { kind: string; obtained: string[]; unavailable: string[]; frameCount: number };
    expect(evidence.kind).toBe("video");
    expect(evidence.obtained).toEqual(["description"]);
    expect(evidence.unavailable).toEqual(["captions", "frames"]);
    expect(evidence.frameCount).toBe(0);
    // クライアントはジョブ本体をそのまま ImportedRecipePreview に渡す＝このラベルが結果カードに出る
    expect(videoEvidenceLabel(job.evidence as Record<string, unknown>)).toBe(
      "説明欄だけを読み取りました。映像・音声・字幕は未取得です。",
    );
  });
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
      recipe: {
        name: "肉じゃが",
        ingredients: [{ name: "じゃがいも", amount: "3個" }],
        steps: [{ title: "下準備", text: "じゃがいもを切る" }],
      },
      missing: ["みりん"],
      confidence: "medium",
    });

    const job = await runImport();

    expect(job.status).toBe("done");
    expect((job.recipe as { name: string }).name).toBe("肉じゃが");
    expect(job.missing).toEqual(["みりん"]);
    expect(h.refund).not.toHaveBeenCalled();
  });

  // 動画を1つも開けなかったとき、AIは指示どおり「材料も手順も空のレシピ」を返す
  // （根拠が無いのに“それらしいレシピ”を作らせないため）。これを done にすると
  // 名前だけの空のカードが画面に出てしまう。成功ではないので error 扱いにする。
  it("材料も手順も空のレシピは成功にしない＝空のカードを出さず枠も戻す", async () => {
    h.askClaudeForJson.mockResolvedValue({
      recipe: { name: "（動画情報が取得できませんでした）", ingredients: [], steps: [] },
      confidence: "low",
    });

    const job = await runImport();

    expect(job.status).toBe("error");
    expect(job.recipe).toBeUndefined();
    expect(h.refund).toHaveBeenCalled();
  });

  it("AIが失敗した回は error＋枠を戻す（既存の挙動を保つ）", async () => {
    h.askClaudeForJson.mockRejectedValue(new Error("JSON parse failed"));

    const job = await runImport();

    expect(job.status).toBe("error");
    expect(h.refund).toHaveBeenCalled();
  });
});
