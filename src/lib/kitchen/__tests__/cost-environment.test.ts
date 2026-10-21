import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logAiCost, readCostSummary, monthYenSpent, resetPreCharge } from "../../aiCost";
const folders: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); resetPreCharge(); await Promise.all(folders.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
it("同じ保存先でも試験・開発の費用を本番の履歴へ混ぜない", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cooksync-cost-environment-")); folders.push(dir);
  vi.stubEnv("COOKSYNC_DATA_DIR", dir); vi.stubEnv("COOKSYNC_USD_JPY", "100");
  vi.stubEnv("COOKSYNC_AI_ENVIRONMENT", "production");
  await logAiCost("text", { model: "claude-haiku-4-5", inputTokens: 10000, outputTokens: 0 });
  expect(await monthYenSpent()).toBe(1);
  for (const environment of ["test", "development"]) {
    vi.stubEnv("COOKSYNC_AI_ENVIRONMENT", environment);
    expect((await readCostSummary()).total.calls).toBe(0);
    await logAiCost("text", { model: "claude-haiku-4-5", inputTokens: 20000, outputTokens: 0 });
    expect(await monthYenSpent()).toBe(2);
  }
  vi.stubEnv("COOKSYNC_AI_ENVIRONMENT", "production");
  expect((await readCostSummary()).total.calls).toBe(1);
  expect(await monthYenSpent()).toBe(1);
});
