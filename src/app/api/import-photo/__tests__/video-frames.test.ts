import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const h = vi.hoisted(() => ({ ask: vi.fn(), consume: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/kitchen/managedAi", () => ({ withAiRequest: (fn: unknown) => fn, requireAiScope: () => ({ owner: "video-test", locationId: "place-a" }) }));
vi.mock("@/lib/ai", () => ({ askClaudeVisionRecipe: h.ask }));
vi.mock("@/lib/quotaServer", () => ({ consume: h.consume, refund: vi.fn(async () => {}), quotaResponse: () => Response.json({}, { status: 429 }) }));
import { POST } from "../route";
const video = { version: 1, duration: 10, timestamps: [2], sourceSha256: "a".repeat(64) };
beforeEach(() => { vi.clearAllMocks(); h.ask.mockResolvedValue({ recipe: { name: "試験", ingredients: [{ name: "にんじん", amount: "2本" }], steps: [{ title: "切る", text: "切る", fromPhoto: 1 }] } }); });
async function send(manifest: unknown, corrupt = false) {
  const form = new FormData();
  const bytes = corrupt ? Buffer.from("not-image") : await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).jpeg().toBuffer();
  form.append("image", new File([new Uint8Array(bytes)], "frame.jpg", { type: "image/jpeg" })); form.set("videoManifest", JSON.stringify(manifest));
  return POST(new Request("http://localhost/api/import-photo", { method: "POST", body: form }));
}
it("rejects malformed frame metadata or undecodable images before quota and inference", async () => {
  expect((await send({ ...video, timestamps: [20] })).status).toBe(400);
  expect((await send(video, true)).ok).toBe(false);
  expect(h.ask).not.toHaveBeenCalled(); expect(h.consume).not.toHaveBeenCalled();
});
it("retains frame provenance and unknown cooking time without claiming a photo or full video", async () => {
  const response = await send(video); expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.evidence.kind).toBe("video"); expect(body.evidence.video).toEqual(video);
  expect(body.evidence.obtained).toEqual(["uploaded-video-frames"]);
  expect(body.evidence.unavailable).toContain("audio"); expect(body.photoCount).toBeUndefined();
  expect(body.recipe.cookTime).toBeUndefined(); expect(body.recipe.steps[0].fromPhoto).toBe(1);
  expect(h.ask.mock.calls[0][1]).toEqual(video);
});
