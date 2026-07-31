import { describe, it, expect } from "vitest";
import { FREE_LIMITS as S, PREMIUM_LIMITS as SP } from "../quotaServer";
import { FREE_LIMITS as C, PREMIUM_LIMITS as CP } from "../aiLimits";

describe("枠の数字がサーバーと表示でズレない", () => {
  it("FREE_LIMITS が一致する", () => expect(S).toEqual(C));
  it("PREMIUM_LIMITS が一致する", () => expect(SP).toEqual(CP));
  it("引き上げ後の値になっている", () =>
    expect(C).toEqual({ research: 8, scan: 25, import: 5 }));
});
