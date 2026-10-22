import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readLedgerSummary, reconciliationRecords, reserveAttempt, settleAttempt, type AiScope } from "../aiBudget";
import { searchReservationMicroUsd } from "../aiPricing";
const folders: string[] = [];
const scope = (owner = "owner-a"): AiScope => ({ owner, locationId: "default", jobId: randomUUID(), environment: "test" });
beforeEach(async () => { const dir = await mkdtemp(path.join(tmpdir(), "cooksync-ledger-")); folders.push(dir); vi.stubEnv("COOKSYNC_DATA_DIR", dir); });
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(folders.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
describe("ai ledger", () => {
  it("holds an unknown outcome at its ceiling until an operator record with matching time, ceiling and request id reconciles it", async () => {
    const key = randomUUID(), at = "2026-01-05T01:02:03.456Z";
    await reserveAttempt(key, "failed", scope(), 4180000, 5000000, at);
    await settleAttempt(key, "failed", null);
    expect((await readLedgerSummary(key)).used).toBe(4180000);
    await expect(reserveAttempt(key, "next", scope(), 4101920, 5000000)).rejects.toThrow("費用上限");
    // A record for a different time or ceiling changes nothing.
    vi.stubEnv("COOKSYNC_AI_RECONCILED_ATTEMPTS", JSON.stringify([{ at: "2026-01-05T01:02:03.000Z", ceilingMicroUsd: 4180000, chargedMicroUsd: 276924, requestId: "req_011CgEmAnaSHzwmr5UqbDVbA", evidence: "console" }]));
    await expect(reserveAttempt(key, "next", scope(), 4101920, 5000000)).rejects.toThrow("費用上限");
    vi.stubEnv("COOKSYNC_AI_RECONCILED_ATTEMPTS", JSON.stringify([{ at, ceilingMicroUsd: 4180000, chargedMicroUsd: 276924, requestId: "req_011CgEmAnaSHzwmr5UqbDVbA", evidence: "Console request log 11 rows + cost page $0.47 on 2026-10-22" }]));
    await reserveAttempt(key, "next", scope(), 4101920, 5000000);
    const summary = await readLedgerSummary(key);
    expect(summary.attempts.find(a => a.at === at)).toMatchObject({ status: "reconciled", charged: 276924, requestId: "req_011CgEmAnaSHzwmr5UqbDVbA" });
    expect(summary.used).toBe(276924 + 4101920);
    // Applying the same record again is a no-op and a reconciled attempt is never re-opened.
    await settleAttempt(key, "next", 159488, "req_second");
    expect((await readLedgerSummary(key)).used).toBe(276924 + 159488);
  });
  it("applies the committed 2026-10-21 test-environment record only to that exact unknown attempt and environment", async () => {
    const key = randomUUID(), at = "2026-10-21T04:36:48.690Z";
    await reserveAttempt(key, "failed", scope(), 4180000, 5000000, at);
    await settleAttempt(key, "failed", null);
    // Production ledgers never see the test-environment record.
    await expect(reserveAttempt(key, "prod", { ...scope(), environment: "production" }, 4101920, 5000000)).rejects.toThrow("費用上限");
    await reserveAttempt(key, "next", scope(), 4101920, 5000000);
    expect((await readLedgerSummary(key)).attempts.find(a => a.at === at)).toMatchObject({ status: "reconciled", charged: 276924, requestId: "req_011CgEmAnaSHzwmr5UqbDVbA" });
  });
  it("never reconciles above the ceiling, below zero, or from malformed records", () => {
    expect(reconciliationRecords("")).toEqual([]);
    expect(() => reconciliationRecords("{")).toThrow("読めません");
    expect(() => reconciliationRecords(JSON.stringify([{ at: "2026-10-21T04:36:48.690Z", ceilingMicroUsd: 4180000, chargedMicroUsd: 4180001, requestId: "req_011CgEmAnaSHzwmr5UqbDVbA", evidence: "x" }]))).toThrow("不正");
    expect(() => reconciliationRecords(JSON.stringify([{ at: "2026-10-21T04:36:48.690Z", ceilingMicroUsd: 4180000, chargedMicroUsd: -1, requestId: "req_011CgEmAnaSHzwmr5UqbDVbA", evidence: "x" }]))).toThrow("不正");
    expect(() => reconciliationRecords(JSON.stringify([{ at: "2026-10-21T04:36:48.690Z", ceilingMicroUsd: 4180000, chargedMicroUsd: 1, requestId: "not-a-request", evidence: "x" }]))).toThrow("不正");
    expect(() => reconciliationRecords(JSON.stringify([{ at: "2026-10-21T04:36:48.690Z", ceilingMicroUsd: 4180000, chargedMicroUsd: 1, requestId: "req_011CgEmAnaSHzwmr5UqbDVbA", evidence: " " }]))).toThrow("不正");
  });
  it("records measured usage above the ceiling in full and flags it instead of hiding it", async () => {
    const key = randomUUID();
    await reserveAttempt(key, "a", scope(), 1000, 5000000);
    await settleAttempt(key, "a", 1500, "req_overrun");
    const summary = await readLedgerSummary(key);
    expect(summary.used).toBe(1500); expect(summary.attempts[0]).toMatchObject({ status: "settled", overrun: true, charged: 1500 });
  });
  it("search reservation grows with the request and stays far below the old whole-context hold", () => {
    expect(searchReservationMicroUsd("claude-sonnet-5", 8192, 5377)).toBe(3 * (5377 + 80000) * 2 + 81920 + 20000);
    expect(searchReservationMicroUsd("claude-sonnet-5")).toBe(3 * 120000 * 2 + 120000 + 20000);
    expect(searchReservationMicroUsd("claude-sonnet-5")!).toBeLessThan(1000000);
    expect(searchReservationMicroUsd("unknown-model")).toBeNull();
    // Observed 2026-10-21 usage ($0.159488) fits under the bound computed from its own 5,377-token prompt.
    expect(searchReservationMicroUsd("claude-sonnet-5", 8192, 5377)!).toBeGreaterThan(159488 * 3);
  });
});
