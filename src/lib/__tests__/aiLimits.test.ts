import { describe, it, expect } from "vitest";
import { FREE_LIMITS as S, PREMIUM_LIMITS as SP } from "../quotaServer";
import {
  FREE_LIMITS as C,
  PREMIUM_LIMITS as CP,
  daysUntilQuotaReset,
  isWeekKey,
  weekKey,
} from "../aiLimits";

describe("枠の数字がサーバーと表示でズレない", () => {
  it("FREE_LIMITS が一致する", () => expect(S).toEqual(C));
  it("PREMIUM_LIMITS が一致する", () => expect(SP).toEqual(CP));
  it("週次に切り替えた後の値になっている", () =>
    expect(C).toEqual({ research: 2, scan: 6, import: 2 }));
});

// 枠が回復する「週」の定義。
// ⚠️ ここが**クライアントとサーバーで1日でもズレると**、画面は「残り2回」なのに
//    サーバーは「0回」という状態が起きる。週次にすると月次の4倍の頻度で境界を跨ぐので、
//    タイムゾーンの扱いをテストで固定しておく。
describe("weekKey（JSTの月曜始まり）", () => {
  it("その週の月曜の日付を W 付きで返す", () => {
    // 2026-07-27(月) 〜 2026-08-02(日) は同じ週
    expect(weekKey(new Date("2026-07-27T00:00:00+09:00"))).toBe("W2026-07-27");
    expect(weekKey(new Date("2026-07-30T12:00:00+09:00"))).toBe("W2026-07-27");
    expect(weekKey(new Date("2026-08-02T23:59:00+09:00"))).toBe("W2026-07-27");
  });

  it("月曜0:00 JST で切り替わる（UTCの日付で切ってはいけない）", () => {
    // 2026-08-02T15:00Z ＝ JSTでは 8/3(月) 0:00。UTC基準だとまだ日曜なので、
    // 素直に toISOString() で週を作る実装だとここで前の週に落ちる。
    expect(weekKey(new Date("2026-08-02T14:59:00Z"))).toBe("W2026-07-27");
    expect(weekKey(new Date("2026-08-02T15:00:00Z"))).toBe("W2026-08-03");
  });

  it("同じ瞬間なら、書き方が違っても同じキー（端末TZに依存しない）", () => {
    const instant = "2026-08-02T15:30:00Z";
    expect(weekKey(new Date(instant))).toBe(weekKey(new Date("2026-08-03T00:30:00+09:00")));
  });

  it("旧・月次キーと見分けがつく", () => {
    expect(isWeekKey(weekKey(new Date()))).toBe(true);
    expect(isWeekKey("2026-08")).toBe(false); // 移行前のレコード
  });
});

describe("daysUntilQuotaReset", () => {
  it("日曜なら翌日、月曜なら7日後に戻る", () => {
    expect(daysUntilQuotaReset(new Date("2026-08-02T20:00:00+09:00"))).toBe(1); // 日
    expect(daysUntilQuotaReset(new Date("2026-08-03T09:00:00+09:00"))).toBe(7); // 月
    expect(daysUntilQuotaReset(new Date("2026-07-31T09:00:00+09:00"))).toBe(3); // 金
  });
});
