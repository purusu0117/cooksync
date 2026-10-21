import { describe, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { activateKitchen, cancelKitchenOperation, commitKitchen, copyVerifiedDeviceKitchen, exportDigest, readKitchenData } from "../server";
import { localSetKey } from "../../storeLocal";
import { createSession, SESSION_COOKIE } from "../../session";
import { GET, POST } from "../../../app/api/kitchen/route";
import { aiJobCancelled, cancelAiJob, reserveAttempt, settleAttempt } from "../aiBudget";
import { withAiRequest } from "../managedAi";
import { atomicDocument } from "../atomicDocument";
import { poolKey } from "../../recipeCache";
import { requireSameOrigin } from "../identity";
const cookie = (owner: string) => `${SESSION_COOKIE}=${createSession({ uid: `test:${owner}`, dataId: owner })}`;
describe("durability, ownership and concurrency", () => {
  it("cancelling an uncertain operation prevents a late purchase from applying", async () => {
    const owner = randomUUID(); await activateKitchen(owner, 0);
    const command = { id: randomUUID(), locationId: "default", expectedRevision: 0, type: "lot.add", payload: { name: "にんじん", amount: "3本", compartment: "冷蔵" } };
    await cancelKitchenOperation(owner, command);
    const late = await commitKitchen(owner, command); expect(late.lots).toHaveLength(0); expect(late.operations[command.id].cancelled).toBe(true);
  });
  it("racing cancel and commit produces either one application or a cancellation, never both", async () => {
    const owner = randomUUID(); await activateKitchen(owner, 0);
    const command = { id: randomUUID(), locationId: "default", expectedRevision: 0, type: "lot.add", payload: { name: "にんじん", amount: "3本", compartment: "冷蔵" } };
    await Promise.all([cancelKitchenOperation(owner, command), commitKitchen(owner, command)]);
    const state = (await readKitchenData(owner)).state!;
    expect(state.revision).toBe(1); expect(state.lots.length).toBe(state.operations[command.id].cancelled ? 0 : 1);
  });
  it("verified device copies preserve all IDs, reject stale previews and never overwrite account data", async () => {
    const source = randomUUID(), target = randomUUID(); await activateKitchen(source, 0);
    const state = await commitKitchen(source, { id: randomUUID(), locationId: "default", expectedRevision: 0, type: "lot.add", payload: { name: "白菜", amount: "1/4玉", compartment: "冷蔵" } });
    await expect(copyVerifiedDeviceKitchen(source, target, "bad")).rejects.toThrow("更新");
    const copied = await copyVerifiedDeviceKitchen(source, target, exportDigest(state));
    expect(copied.owner).toBe(target); expect(copied.lots).toEqual(state.lots); expect(copied.transactions).toEqual(state.transactions);
    expect(await copyVerifiedDeviceKitchen(source, target, exportDigest(state))).toEqual(copied);
    expect((await readKitchenData(source)).state).toEqual(state);
    const other = randomUUID(); await activateKitchen(other, 0); await expect(copyVerifiedDeviceKitchen(source, other, exportDigest(state))).rejects.toThrow("既存データ");
  });
  it("device-copy route requires both signed identities, ignoring claimed source IDs", async () => {
    const account = randomUUID(), device = randomUUID(); await activateKitchen(device, 0);
    const denied = await GET(new Request(`http://localhost/api/kitchen?device-copy=1&source=${device}`, { headers: { cookie: cookie(account) } })); expect(denied.status).toBe(403);
    const cookies = `${cookie(account)}; cooksync_kitchen_guest=${createSession({ uid: `guest:${device}`, dataId: device })}`;
    const preview = await GET(new Request("http://localhost/api/kitchen?device-copy=1", { headers: { cookie: cookies } })); expect(preview.status).toBe(200); expect((await preview.json()).canCopy).toBe(true);
  });
  it("A14 migration is idempotent and freezes old array writes", async () => {
    const owner = randomUUID(); await localSetKey(owner, "fridge-app:items:v2", [{ id: "legacy-cabbage", name: "白菜", quantity: "1/4玉", zone: "野菜" }]);
    const read = await readKitchenData(owner); const state = await activateKitchen(owner, read.revision); const again = await activateKitchen(owner, read.revision);
    expect(again).toEqual(state); expect(again.lots).toHaveLength(1);
    await expect(localSetKey(owner, "fridge-app:items:v2", [])).rejects.toThrow("画面を更新");
    await expect(localSetKey(owner, "cooksync:kitchen:v3", {})).rejects.toThrow();
    expect((await readKitchenData(owner)).state?.lots[0].id).toBe("legacy-cabbage");
  });
  it("A12 persistent same-ID retries and concurrent commits apply once", async () => {
    const owner = randomUUID(), state = await activateKitchen(owner, 0);
    const command = { id: randomUUID(), locationId: "default", expectedRevision: state.revision, type: "lot.add", payload: { name: "にんじん", amount: "3本", compartment: "冷蔵" } };
    const results = await Promise.all([commitKitchen(owner, command), commitKitchen(owner, command), commitKitchen(owner, command)]);
    expect(results.every(r => r.revision === 1)).toBe(true); expect((await readKitchenData(owner)).state?.lots).toHaveLength(1);
    const same = await commitKitchen(owner, command); expect(same.lots).toHaveLength(1);
  });
  it("A22 unsigned clients and other locations cannot read or write a kitchen", async () => {
    const a = randomUUID(), b = randomUUID(); await activateKitchen(a, 0); await activateKitchen(b, 0);
    const unsigned = await GET(new Request(`http://localhost/api/kitchen?owner=${a}`)); expect((await unsigned.json()).state).toBeNull();
    const own = await GET(new Request(`http://localhost/api/kitchen?owner=${a}`, { headers: { cookie: cookie(b) } })); expect((await own.json()).state.owner).toBe(b);
    const fail = await POST(new Request("http://localhost/api/kitchen", { method: "POST", headers: { cookie: cookie(b), "content-type": "application/json" }, body: JSON.stringify({ command: { id: randomUUID(), expectedRevision: 0, locationId: "not-owned", type: "lot.add", payload: {} } }) })); expect(fail.status).toBe(403);
  });
  it("A22 AI handler rejects unauthorized users/places and disabled settings before inference", async () => {
    let called = false; const handler = withAiRequest(async () => { called = true; return Response.json({}); });
    expect((await handler(new Request("http://localhost/api/test"))).status).toBe(401);
    const owner = randomUUID(); await activateKitchen(owner, 0);
    expect((await handler(new Request("http://localhost/api/test", { headers: { cookie: cookie(owner), "x-cooksync-location-id": "other" } }))).status).toBe(403);
    expect((await handler(new Request("http://localhost/api/test", { headers: { cookie: cookie(owner), "x-cooksync-location-id": "default" } }))).status).toBe(503);
    expect(called).toBe(false);
  });
  it("A23 concurrent budget reservations cannot exceed the cap; ambiguous attempts retain budget", async () => {
    const key = `test-budget-${randomUUID()}`;
    const scopes = Array.from({ length: 10 }, (_, i) => ({ owner: `owner-${i}`, locationId: "default", jobId: `job-${i}`, environment: "test" }));
    const attempts = await Promise.allSettled(scopes.map((scope, i) => reserveAttempt(key, String(i), scope, 50, 100)));
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(2);
    const success = attempts.flatMap((r, i) => r.status === "fulfilled" ? [i] : []);
    await settleAttempt(key, String(success[0]), null);
    await expect(reserveAttempt(key, "retry", scopes[0], 1, 100)).rejects.toThrow("費用上限");
    await settleAttempt(key, String(success[1]), 10);
    await reserveAttempt(key, "new", scopes[1], 40, 100);
    await expect(reserveAttempt(key, "new", scopes[1], 40, 100)).rejects.toThrow("開始済み");
  });
  it("atomic document persists whole transitions or no transition", async () => {
    const key = randomUUID(); await atomicDocument(key, () => ({ n: 0 }), v => { v.n++; });
    await expect(atomicDocument(key, () => ({ n: 0 }), v => { v.n = 9; throw new Error("abort"); })).rejects.toThrow("abort");
    expect(await atomicDocument(key, () => ({ n: 0 }), v => v.n)).toBe(1);
  });
  it("private recipe caches separate users and locations", () => {
    expect(poolKey({ privateScope: "A:home" })).not.toBe(poolKey({ privateScope: "B:home" }));
    expect(poolKey({ privateScope: "A:home" })).not.toBe(poolKey({ privateScope: "A:travel" }));
  });
  it("same-origin accepts Next's internal localhost rewrite, rejects cross-site origins", () => {
    expect(() => requireSameOrigin(new Request("http://localhost:3317/api/kitchen", { headers: { host: "127.0.0.1:3317", origin: "http://127.0.0.1:3317" } }))).not.toThrow();
    expect(() => requireSameOrigin(new Request("http://localhost/api/kitchen", { headers: { host: "localhost", origin: "https://other.example" } }))).toThrow();
  });
  it("A13/A22 AI receipts are idempotent and job results are owner/location-scoped", async () => {
    const fakeKey = "synthetic-key-no-provider-call";
    const settings: Record<string, string> = { COOKSYNC_AI_ENABLED: "1", COOKSYNC_AI_ENVIRONMENT: "test", COOKSYNC_AI_BUDGET_MICRO_USD: "1000000", COOKSYNC_AI_CREDIT_EXPIRES_AT: "2040-01-01T00:00:00Z", COOKSYNC_AI_ORG_ID: randomUUID(), ANTHROPIC_API_KEY: fakeKey, COOKSYNC_AI_KEY_SHA256: createHash("sha256").update(fakeKey).digest("hex") };
    for (const [k, v] of Object.entries(settings)) vi.stubEnv(k, v);
    vi.stubEnv("COOKSYNC_AI_BALANCE_VERIFIED_AT", "2020-01-01T00:00:00Z");
    vi.stubEnv("COOKSYNC_AI_BALANCE_RECHECK_AT", "2040-01-01T00:00:00Z");
    vi.stubEnv("COOKSYNC_AI_VERIFIED_CREDIT_MICRO_USD", "1000000");
    try {
      const owner = randomUUID(), other = randomUUID(); await activateKitchen(owner, 0); await activateKitchen(other, 0);
      const updated = await commitKitchen(owner, { id: randomUUID(), locationId: "default", expectedRevision: 0, type: "location.add", payload: { name: "旅行先" } });
      let starts = 0; const jobId = randomUUID();
      const handler = withAiRequest(async () => { starts++; return Response.json({ jobId }); });
      const operation = randomUUID(); const make = () => new Request("http://localhost/api/test", { method: "POST", headers: { cookie: cookie(owner), "content-type": "application/json", "x-cooksync-location-id": "default", "x-cooksync-operation-id": operation }, body: JSON.stringify({ query: "合成テスト" }) });
      expect((await handler(make())).status).toBe(200); expect((await handler(make())).status).toBe(200); expect(starts).toBe(1);
      const poll = withAiRequest(async () => Response.json({ status: "done" }), true);
      const get = (user: string, location: string) => poll(new Request(`http://localhost/api/test?jobId=${jobId}&locationId=${location}`, { headers: { cookie: cookie(user) } }));
      expect((await get(owner, "default")).status).toBe(200); expect((await get(owner, updated.locations[1].id)).status).toBe(404); expect((await get(other, "default")).status).toBe(404);
      const scope = { owner, locationId: "default", environment: "test", jobId: operation };
      await expect(cancelAiJob({ ...scope, owner: other }, jobId)).rejects.toThrow("見つかりません");
      await expect(cancelAiJob({ ...scope, locationId: updated.locations[1].id }, jobId)).rejects.toThrow("見つかりません");
      await cancelAiJob(scope, jobId); expect(await aiJobCancelled(scope)).toBe(true);
      expect((await (await get(owner, "default")).json()).status).toBe("cancelled");
      expect((await handler(make())).status).toBe(409); expect(starts).toBe(1);
    } finally { vi.unstubAllEnvs(); }
  });
  it("device copy preserves source IDs and never claims an arbitrary server owner", async () => {
    const owner = randomUUID();
    const old = { "fridge-app:items:v2": [{ id: "device-old", name: "白菜", quantity: "1/4玉" }], secret: "synthetic-disallowed-field" };
    const first = await activateKitchen(owner, 0, old);
    expect(first.lots[0].id).toBe("device-old"); expect(first.migration.original.secret).toBeUndefined();
    expect((await activateKitchen(owner, 0, old)).lots).toHaveLength(1);
    const occupied = randomUUID(); await localSetKey(occupied, "fridge-app:items:v2", [{ id: "existing", name: "卵", quantity: "1個" }]);
    await expect(activateKitchen(occupied, (await readKitchenData(occupied)).revision, old)).rejects.toThrow("結合は自動で行いません");
  });
});
