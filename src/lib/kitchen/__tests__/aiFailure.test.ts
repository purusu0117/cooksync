import { expect, it } from "vitest";
import { aiFailureMessage } from "../aiFailure";
it("explains timeout and unresolved budget without claiming the call was free or auto-retried", () => {
  const message = aiFailureMessage(new Error("Request timed out."));
  expect(message).toContain("時間内に完了しませんでした"); expect(message).toContain("AI予算の一部を確保");
  expect(aiFailureMessage(new Error("401 provider internal response"))).not.toContain("provider");
  expect(aiFailureMessage(new Error("費用上限に達しました"))).toBe("費用上限に達しました");
});
