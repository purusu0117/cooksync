import { beforeEach, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
const h = vi.hoisted(() => ({ stream: vi.fn(), reserve: vi.fn(), settle: vi.fn() }));
vi.mock("../identity", () => ({ requireSameOrigin: () => {}, kitchenIdentity: () => ({ trusted: true, dataId: "synthetic-owner" }) }));
vi.mock("../server", () => ({ readKitchenData: async () => ({ state: { locations: [{ id: "default" }] } }) }));
vi.mock("../aiBudget", () => ({
  aiConfiguration: () => ({ environment: "test" }), requireAiConfiguration: () => ({ org: "synthetic", limit: 5000000 }),
  aiJobCancelled: async () => false, registerAiJob: async () => {}, budgetKey: () => "synthetic-budget",
  reserveAttempt: h.reserve, settleAttempt: h.settle,
}));
import { managedMessage, withAiRequest } from "../managedAi";
const message = { usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } }, stop_reason: "end_turn" };
beforeEach(() => { vi.clearAllMocks(); h.stream.mockReturnValue({ finalMessage: async () => message, request_id: "synthetic-request" }); });
async function run(type: "web_search_20250305" | "web_search_20260209", tools = true) {
  const handler = withAiRequest(async () => { await managedMessage({ messages: { stream: h.stream } } as unknown as Anthropic, { model: "claude-sonnet-5", max_tokens: 8192, messages: [{ role: "user", content: "合成試験" }], ...(tools ? { tools: [{ type, name: "web_search", max_uses: 100 }] } : {}) }); return Response.json({ ok: true }); });
  return handler(new Request("http://localhost/api/test", { method: "POST", headers: { "x-cooksync-location-id": "default", "x-cooksync-operation-id": crypto.randomUUID() }, body: "{}" }));
}
it("permits only direct search with bounded uses, streams without SDK retries, and reserves from the request size", async () => {
  expect((await run("web_search_20250305")).ok).toBe(true);
  expect(h.stream.mock.calls[0][0].tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 2, allowed_callers: ["direct"] }]);
  expect(h.stream.mock.calls[0][1].maxRetries).toBe(0);
  expect(h.stream.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  // 3 iterations x (4,110 prompt bytes + 2 x 40,000 result tokens) x $2/M + 8,192 x $10/M + 2 searches
  expect(h.reserve.mock.calls[0][3]).toBe(606580);
  expect(h.settle.mock.calls[0][2]).toBe(10300);
  expect(h.settle.mock.calls[0][3]).toBe("synthetic-request");
});
it("reserves text-only calls from bytes and output without the search bound", async () => {
  expect((await run("web_search_20250305", false)).ok).toBe(true);
  expect(h.stream.mock.calls[0][0].tools).toBeUndefined();
  expect(h.reserve.mock.calls[0][3]).toBe(4110 * 2 * 2 + 8192 * 10);
});
it("rejects dynamic filtering before reserving or sending and retains unknown usage after a timeout or abort", async () => {
  expect((await run("web_search_20260209")).status).toBe(503); expect(h.reserve).not.toHaveBeenCalled(); expect(h.stream).not.toHaveBeenCalled();
  h.stream.mockReturnValue({ finalMessage: async () => { throw new Error("Request timed out."); }, request_id: null });
  expect((await run("web_search_20250305")).ok).toBe(false); expect(h.settle.mock.calls[0][2]).toBeNull();
  h.settle.mockClear();
  h.stream.mockReturnValue({ finalMessage: async () => { throw new DOMException("The operation was aborted", "AbortError"); }, request_id: null });
  expect((await run("web_search_20250305")).ok).toBe(false); expect(h.settle.mock.calls[0][2]).toBeNull();
});
