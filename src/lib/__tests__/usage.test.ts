import { describe, it, expect } from "vitest";
import { AI_LABEL, FREE_LIMITS, quotaMessage, readApiError } from "../usage";

// クライアント側は「サーバーの429をそのまま見せる」のが役目。
// ここでは、その取り出しが壊れていないか（＝自前の文言で上書きしていないか）を守る。
// サーバーの文言と一致しているかは quotaServer.test.ts の「クライアント表示との文言一致」で見る。

describe("quotaMessage", () => {
  it("無料は「無料枠」、プレミアムは「上限」と書き分ける", () => {
    const free = quotaMessage("research", FREE_LIMITS.research, false);
    expect(free).toContain("無料枠");
    expect(free).toContain(AI_LABEL.research);
    expect(free).toContain(String(FREE_LIMITS.research));

    const paid = quotaMessage("research", 30, true);
    expect(paid).not.toContain("無料枠");
    expect(paid).toContain("上限");
  });
});

describe("readApiError", () => {
  it("サーバーの文言と枠情報をそのまま取り出す（自前の文言で上書きしない）", () => {
    const body = {
      error: "今月の無料枠（AIレシピ探索 3回）を使い切りました。",
      quota: { kind: "research", reason: "user", used: 3, limit: 3, premium: false },
    };
    const fail = readApiError(body, "開始に失敗しました");
    expect(fail.message).toBe(body.error);
    expect(fail.quota?.reason).toBe("user");
    expect(fail.quota?.limit).toBe(3);
  });

  it("IP日次上限のように quota が付かない429でも、文言はサーバーのものを使う", () => {
    const fail = readApiError(
      { error: "この回線からのAI利用が今日の上限に達しました。" },
      "開始に失敗しました",
    );
    expect(fail.message).toBe("この回線からのAI利用が今日の上限に達しました。");
    // quota が無い＝本人の枠は減っていない（表示カウンタは戻す側）
    expect(fail.quota).toBeUndefined();
  });

  it("errorが無い・空白だけ・壊れたボディでは fallback を使う（落ちない）", () => {
    expect(readApiError({}, "既定の文言").message).toBe("既定の文言");
    expect(readApiError({ error: "  " }, "既定の文言").message).toBe("既定の文言");
    expect(readApiError({ error: 42 }, "既定の文言").message).toBe("既定の文言");
    expect(readApiError(null, "既定の文言").message).toBe("既定の文言");
    expect(readApiError("文字列", "既定の文言").message).toBe("既定の文言");
  });
});
