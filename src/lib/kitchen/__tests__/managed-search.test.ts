import { beforeEach, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
const h = vi.hoisted(() => ({ create: vi.fn(), reserve: vi.fn(), settle: vi.fn() }));
vi.mock("../identity", () => ({ requireSameOrigin: () => {}, kitchenIdentity: () => ({ trusted: true, dataId: "synthetic-owner" }) }));
vi.mock("../server", () => ({ readKitchenData: async () => ({ state: { locations: [{ id: "default" }] } }) }));
vi.mock("../aiBudget", () => ({
  aiConfiguration: () => ({ environment: "test" }), requireAiConfiguration: () => ({ org: "synthetic", limit: 5000000 }),
  aiJobCancelled: async () => false, registerAiJob: async () => {}, budgetKey: () => "synthetic-budget",
  reserveAttempt: h.reserve, settleAttempt: h.settle,
}));
import { managedMessage, withAiRequest } from "../managedAi";
beforeEach(() => { vi.clearAllMocks(); h.create.mockResolvedValue({ usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } }, _request_id: "synthetic-request" }); });
async function run(type: "web_search_20250305" | "web_search_20260209") {
  const handler = withAiRequest(async () => { await managedMessage({ messages: { create: h.create } } as unknown as Anthropic, { model: "claude-sonnet-5", max_tokens: 8192, messages: [{ role: "user", content: "合成試験" }], tools: [{ type, name: "web_search", max_uses: 100 }] }); return Response.json({ ok: true }); });
  return handler(new Request("http://localhost/api/test", { method: "POST", headers: { "x-cooksync-location-id": "default", "x-cooksync-operation-id": crypto.randomUUID() }, body: "{}" }));
}
it("permits only direct search with bounded uses and no SDK retries", async () => {
  expect((await run("web_search_20250305")).ok).toBe(true);
  expect(h.create.mock.calls[0][0].tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 2, allowed_callers: ["direct"] }]);
  expect(h.create.mock.calls[0][1].maxRetries).toBe(0);
  expect(h.reserve.mock.calls[0][3]).toBe(4101920);
  expect(h.settle.mock.calls[0][2]).toBe(10300);
});
it("rejects dynamic filtering before reserving or sending and retains unknown usage after a timeout", async () => {
  expect((await run("web_search_20260209")).status).toBe(503); expect(h.reserve).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  h.create.mockRejectedValue(new Error("Request timed out."));
  expect((await run("web_search_20250305")).ok).toBe(false); expect(h.settle.mock.calls[0][2]).toBeNull();
});
