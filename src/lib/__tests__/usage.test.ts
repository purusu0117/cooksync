import { describe, it, expect } from "vitest";
import {
  AI_LABEL,
  FREE_LIMITS,
  currentMonth,
  currentPeriod,
  QUOTA_METER_TITLE,
  quotaMessage,
  quotaMeterNote,
  readApiError,
  resetHint,
} from "../usage";
import { weekKey } from "../aiLimits";

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

  it("**いつ戻るかを必ず書く**（断り文句を再訪の約束にする）", () => {
    // 月次のころは「来月またご利用ください」＝最悪3週間先で、実質「もう来なくていい」だった。
    for (const premium of [false, true]) {
      const m = quotaMessage("research", FREE_LIMITS.research, premium);
      expect(m).toContain("今週");
      expect(m).toContain("月曜");
      expect(m).not.toContain("来月");
    }
  });
});

// ---- 月次 → 週次の移行（表示側） ----
describe("表示カウンタの期間キー", () => {
  it("サーバーと**同じ関数**から週キーを作る（メーターが嘘をつかない）", () => {
    expect(currentPeriod()).toBe(weekKey());
  });

  it("旧・月次キーとは別物なので、古いレコードに一致しない＝上書きも消去もしない", () => {
    // 古い月次レコード（月キー）はストアに残るが、現在の期間としては参照されない。
    // ＝移行で「使い切っていた人」が締め出されることも、古い数字が消えることもない。
    expect(currentPeriod()).not.toBe(currentMonth());
    expect(currentPeriod().startsWith("W")).toBe(true);
  });
});

describe("残量メーターの文言（マイページ用に用意してあるもの）", () => {
  it("「今月」「毎月1日」と言わない（枠は週次なので嘘になる）", () => {
    expect(QUOTA_METER_TITLE).toBe("今週のAI利用");
    for (const premium of [false, true]) {
      const note = quotaMeterNote(premium);
      expect(note).toContain("毎週");
      expect(note).not.toContain("毎月");
      expect(note).not.toContain("今月");
    }
  });
});

describe("resetHint", () => {
  it("日曜だけ「明日」と言う（それ以外は曜日だけ伝える）", () => {
    expect(resetHint(new Date("2026-08-02T20:00:00+09:00"))).toContain("明日");
    expect(resetHint(new Date("2026-07-31T20:00:00+09:00"))).not.toContain("明日");
    expect(resetHint(new Date("2026-07-31T20:00:00+09:00"))).toContain("月曜");
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
