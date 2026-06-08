import { describe, it, expect } from "vitest";
import {
  bucketOf,
  daysUntil,
  estimateExpiry,
  freshnessOf,
  isPriorityConsume,
  sortByExpiry,
} from "../food";

const TODAY = "2026-06-08";

describe("freshnessOf 境界", () => {
  it("過去日は expired", () => {
    expect(freshnessOf("2026-06-07", TODAY)).toBe("expired");
  });
  it("今日(0日)と+2日は urgent", () => {
    expect(freshnessOf("2026-06-08", TODAY)).toBe("urgent");
    expect(freshnessOf("2026-06-10", TODAY)).toBe("urgent");
  });
  it("+3〜+5日は soon", () => {
    expect(freshnessOf("2026-06-11", TODAY)).toBe("soon");
    expect(freshnessOf("2026-06-13", TODAY)).toBe("soon");
  });
  it("+6日以上は fresh", () => {
    expect(freshnessOf("2026-06-14", TODAY)).toBe("fresh");
  });
});

describe("isPriorityConsume / bucketOf", () => {
  it("expired・urgent は優先消費(priority)", () => {
    expect(isPriorityConsume("2026-06-07", TODAY)).toBe(true);
    expect(isPriorityConsume("2026-06-10", TODAY)).toBe(true);
    expect(bucketOf("2026-06-10", TODAY)).toBe("priority");
  });
  it("soon は優先ではない", () => {
    expect(isPriorityConsume("2026-06-12", TODAY)).toBe(false);
    expect(bucketOf("2026-06-12", TODAY)).toBe("soon");
    expect(bucketOf("2026-06-20", TODAY)).toBe("fresh");
  });
});

describe("daysUntil / sortByExpiry / estimateExpiry", () => {
  it("daysUntil", () => {
    expect(daysUntil("2026-06-10", TODAY)).toBe(2);
    expect(daysUntil("2026-06-06", TODAY)).toBe(-2);
  });
  it("sortByExpiry は期限が近い順", () => {
    const items = [
      { expiresOn: "2026-06-20" },
      { expiresOn: "2026-06-07" },
      { expiresOn: "2026-06-12" },
    ];
    const sorted = sortByExpiry(items, TODAY).map((i) => i.expiresOn);
    expect(sorted).toEqual(["2026-06-07", "2026-06-12", "2026-06-20"]);
  });
  it("estimateExpiry は加工日＋日数", () => {
    expect(estimateExpiry("2026-06-08", 4)).toBe("2026-06-12");
  });
});
