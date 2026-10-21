import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ message: vi.fn() }));
vi.mock("../kitchen/managedAi", () => ({ managedMessage: h.message, requireAiScope: () => ({}) }));
vi.mock("../kitchen/aiBudget", () => ({ requireAiConfiguration: () => ({}) }));
vi.mock("../aiCost", () => ({ logAiCost: async () => {}, logAiCostEstimated: async () => {}, usageFrom: () => ({}) }));
beforeEach(() => { vi.resetModules(); vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-test-only"); h.message.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
const recipe = { name: "合成グラタン", ingredients: [{ name: "ミートソース", amount: "1食" }], steps: [{ text: "器に入れる" }] };
describe("research output completeness", () => {
  it("retains a complete recipe from truncated output but marks the result partial", async () => {
    h.message.mockResolvedValue({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"recipes":[' + JSON.stringify(recipe) + ',{"name":' }] });
    const { askClaudeRecipes } = await import("../ai");
    const result = await askClaudeRecipes("synthetic");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ...recipe, readMissing: [expect.stringContaining("一部の候補")] });
    expect(h.message).toHaveBeenCalledTimes(1);
  });
  it("marks an output-limit response partial even if its JSON happens to be valid", async () => {
    h.message.mockResolvedValue({ stop_reason: "max_tokens", content: [{ type: "text", text: JSON.stringify({ recipes: [recipe] }) }] });
    const { askClaudeRecipes, askClaudeForJson } = await import("../ai");
    expect((await askClaudeRecipes("synthetic"))[0]).toHaveProperty("readMissing");
    await expect(askClaudeForJson("synthetic")).rejects.toThrow("途中で終了");
  });
  it("does not label complete output as truncated", async () => {
    h.message.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ recipes: [recipe] }) }] });
    const { askClaudeRecipes } = await import("../ai");
    expect(await askClaudeRecipes("synthetic")).toEqual([recipe]);
  });
});
