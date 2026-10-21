import { describe, expect, it } from "vitest";
import { readAiResponse } from "../aiResponse";
describe("AI response transport failures", () => {
  it("does not expose hosting HTML as a parser error or success", async () => {
    await expect(readAiResponse(new Response("<!DOCTYPE html>hosting error", { status: 500, headers: { "content-type": "text/html" } }))).rejects.toThrow("保存はしていません");
  });
  it("rejects truncated JSON", async () => {
    await expect(readAiResponse(new Response('{"recipe":', { headers: { "content-type": "application/json" } }))).rejects.toThrow("形式を確認できません");
  });
  it("preserves a structured server error", async () => {
    expect(await readAiResponse(Response.json({ error: "費用上限" }, { status: 429 }))).toEqual({ error: "費用上限" });
  });
});
