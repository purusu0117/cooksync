import { createHash } from "node:crypto";
import { atomicDocument } from "./atomicDocument";
import { KitchenError } from "./engine";
import { RECONCILED_ATTEMPTS } from "./aiReconciled";
export interface AiScope { owner: string; locationId: string; jobId: string; environment: string; deadlineAt?: number }
/**
 * reserved … provider call in flight; the ceiling is held.
 * settled  … provider usage recorded; charged is the measured amount (overrun=true when it exceeded the ceiling).
 * unknown  … no usage could be read (timeout/abort); the full ceiling stays held until an operator reconciles it.
 * reconciled … an operator matched the unknown attempt to the provider's own usage record; charged is that verified amount.
 */
export interface Attempt { owner: string; locationId: string; jobId: string; ceiling: number; charged: number; status: "reserved" | "settled" | "unknown" | "reconciled"; at: string; requestId?: string; overrun?: boolean; reconciliation?: { evidence: string; appliedAt: string } }
interface Budget { attempts: Record<string, Attempt>; jobs: Record<string, { owner: string; locationId: string; at: string; rootJobId?: string }>; cancelled?: Record<string, string> }
const initial = (): Budget => ({ attempts: {}, jobs: {} });
/** Monetary values are integer micro-USD. Values are operator-approved, never auto-created. */
export function aiConfiguration() {
  const env = process.env.COOKSYNC_AI_ENVIRONMENT;
  const limit = Number(process.env.COOKSYNC_AI_BUDGET_MICRO_USD || "0");
  const expires = process.env.COOKSYNC_AI_CREDIT_EXPIRES_AT || "";
  const org = process.env.COOKSYNC_AI_ORG_ID || "";
  const key = process.env.ANTHROPIC_API_KEY || "";
  const fingerprint = process.env.COOKSYNC_AI_KEY_SHA256 || "";
  const verifiedAt = Date.parse(process.env.COOKSYNC_AI_BALANCE_VERIFIED_AT || "");
  const recheckAt = Date.parse(process.env.COOKSYNC_AI_BALANCE_RECHECK_AT || "");
  const verifiedCredits = Number(process.env.COOKSYNC_AI_VERIFIED_CREDIT_MICRO_USD || "0");
  const enabled = process.env.COOKSYNC_AI_ENABLED === "1" && ["development", "test", "production"].includes(env || "") && Number.isSafeInteger(limit) && limit > 0
    && verifiedAt <= Date.now() && recheckAt > Date.now() && Number.isSafeInteger(verifiedCredits) && verifiedCredits >= limit
    && Date.parse(expires) > Date.now() && !!org && !!key && /^[a-f0-9]{64}$/.test(fingerprint) && createHash("sha256").update(key).digest("hex") === fingerprint;
  return { enabled, environment: env || "unconfigured", limit, expires, org, model: process.env.COOKSYNC_AI_MODEL || "claude-sonnet-5" };
}
export function requireAiConfiguration() { const config = aiConfiguration(); if (!config.enabled) throw new KitchenError("AI接続は停止中です。対象組織・キーの所属・残高・期限・費用上限の確認と設定が必要です", 503); return config; }
export function budgetKey(environment: string, org: string) { return `cooksync:ai-ledger:v1:${environment}:${createHash("sha256").update(org).digest("hex")}`; }
/** Budget consumed by one attempt: measured usage when known, otherwise the held ceiling. */
export function attemptUsage(a: Attempt): number { return a.status === "settled" || a.status === "reconciled" ? a.charged : a.ceiling; }
export function usedMicroUsd(attempts: Record<string, Attempt>): number { return Object.values(attempts).reduce((total, a) => total + attemptUsage(a), 0); }

/**
 * Operator reconciliation of unknown outcomes. The provider's own usage record (Console request log /
 * cost report) is compared with the ledger by a person, then one JSON array is stored in
 * COOKSYNC_AI_RECONCILED_ATTEMPTS for the affected environment:
 *   [{ "at": "<attempt.at>", "ceilingMicroUsd": 4180000, "chargedMicroUsd": 276924, "requestId": "req_…", "evidence": "<where it was verified>" }]
 * Only an attempt whose status is still "unknown" and whose `at` and ceiling match exactly is changed, and never to
 * more than its ceiling or to a value below zero. Nothing here is automatic: no entry, no change.
 */
export interface ReconciliationRecord { at: string; ceilingMicroUsd: number; chargedMicroUsd: number; requestId: string; evidence: string }
export function reconciliationRecords(raw = process.env.COOKSYNC_AI_RECONCILED_ATTEMPTS || ""): ReconciliationRecord[] {
  if (!raw.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new KitchenError("AI費用の照合記録を読めません。設定を確認してください", 503); }
  if (!Array.isArray(parsed)) throw new KitchenError("AI費用の照合記録の形式が不正です", 503);
  return parsed.map(entry => {
    const r = entry as Partial<ReconciliationRecord> | null;
    if (!r || typeof r.at !== "string" || !Number.isFinite(Date.parse(r.at)) || !Number.isSafeInteger(r.ceilingMicroUsd) || !Number.isSafeInteger(r.chargedMicroUsd)
      || r.chargedMicroUsd! < 0 || r.chargedMicroUsd! > r.ceilingMicroUsd! || typeof r.requestId !== "string" || !/^req_[A-Za-z0-9]{10,}$/.test(r.requestId) || typeof r.evidence !== "string" || !r.evidence.trim()) throw new KitchenError("AI費用の照合記録の項目が不正です", 503);
    return { at: r.at, ceilingMicroUsd: r.ceilingMicroUsd!, chargedMicroUsd: r.chargedMicroUsd!, requestId: r.requestId, evidence: r.evidence.trim() };
  });
}
/** Records that apply to one environment: the committed list for that environment plus the deployment's own setting. */
export function environmentReconciliations(environment: string): ReconciliationRecord[] {
  return [...RECONCILED_ATTEMPTS.filter(r => r.environment === environment).map(({ environment: _env, ...r }) => { void _env; return r; }), ...reconciliationRecords()];
}
export function applyReconciliations(b: Budget, records: ReconciliationRecord[], now = new Date().toISOString()): number {
  let applied = 0;
  for (const record of records) for (const a of Object.values(b.attempts)) {
    if (a.status !== "unknown" || Date.parse(a.at) !== Date.parse(record.at) || a.ceiling !== record.ceilingMicroUsd) continue;
    a.status = "reconciled"; a.charged = record.chargedMicroUsd; a.requestId = record.requestId; a.reconciliation = { evidence: record.evidence, appliedAt: now }; applied++;
  }
  return applied;
}
export async function reserveAttempt(key: string, attemptId: string, scope: AiScope, ceiling: number, limit: number, now = new Date().toISOString()): Promise<void> {
  if (!Number.isSafeInteger(ceiling) || ceiling <= 0 || !Number.isSafeInteger(limit) || limit < 0) throw new KitchenError("費用上限が不正です", 503);
  const records = environmentReconciliations(scope.environment);
  await atomicDocument(key, initial, b => {
    if (b.attempts[attemptId]) throw new KitchenError("このAI試行は開始済みです。再実行には新しい予算予約が必要です", 409);
    applyReconciliations(b, records, now);
    const entries = Object.values(b.attempts);
    const used = usedMicroUsd(b.attempts);
    if (used + ceiling > limit) throw new KitchenError(`設定したAI費用上限に達しました（残り$${((limit - used) / 1000000).toFixed(2)}、この処理に必要な確保額$${(ceiling / 1000000).toFixed(2)}）`, 429);
    // Unknown outcomes retain their full budget but do not occupy a forever-running slot.
    if (entries.filter(a => a.owner === scope.owner && a.status === "reserved" && Date.parse(a.at) > Date.parse(now) - 180000).length >= 2) throw new KitchenError("AI処理中です。完了してから続けてください", 429);
    b.attempts[attemptId] = { owner: scope.owner, locationId: scope.locationId, jobId: scope.jobId, environment: scope.environment, ceiling, charged: 0, status: "reserved", at: now } as Attempt & { environment: string };
  });
}
export async function settleAttempt(key: string, id: string, charged: number | null, requestId?: string): Promise<void> {
  await atomicDocument(key, initial, b => {
    const a = b.attempts[id]; if (!a) throw new Error("費用予約が見つかりません");
    if (a.status !== "reserved") return;
    if (charged === null || !Number.isSafeInteger(charged) || charged < 0) { a.status = "unknown"; return; }
    // Measured usage is always recorded in full; exceeding the ceiling is flagged, never hidden or capped.
    a.charged = charged; a.status = "settled"; a.requestId = requestId; if (charged > a.ceiling) a.overrun = true;
  });
}
/** Read-only ledger summary for operators and tests (no owners, no inputs). */
export async function readLedgerSummary(key: string): Promise<{ used: number; attempts: { at: string; status: Attempt["status"]; ceiling: number; charged: number; requestId?: string; overrun?: boolean }[] }> {
  return atomicDocument(key, initial, b => ({ used: usedMicroUsd(b.attempts), attempts: Object.values(b.attempts).map(a => ({ at: a.at, status: a.status, ceiling: a.ceiling, charged: a.charged, requestId: a.requestId, overrun: a.overrun })) }));
}
export async function registerAiJob(scope: AiScope, externalJobId: string): Promise<void> {
  const config = requireAiConfiguration();
  await atomicDocument(budgetKey(scope.environment, config.org), initial, b => { const prior = b.jobs[externalJobId]; if (prior && (prior.owner !== scope.owner || prior.locationId !== scope.locationId || prior.rootJobId !== scope.jobId)) throw new Error("ジョブIDが重複しています"); b.jobs[externalJobId] = { owner: scope.owner, locationId: scope.locationId, rootJobId: scope.jobId, at: prior?.at || new Date().toISOString() }; });
}
export async function aiJobCancelled(scope: AiScope, externalJobId = scope.jobId): Promise<boolean> {
  return atomicDocument(budgetKey(scope.environment, aiConfiguration().org), initial, b => {
    const job = b.jobs[externalJobId];
    return !!job && job.owner === scope.owner && job.locationId === scope.locationId && !!b.cancelled?.[job.rootJobId || externalJobId];
  });
}
export async function cancelAiJob(scope: AiScope, externalJobId: string): Promise<void> {
  await atomicDocument(budgetKey(scope.environment, aiConfiguration().org), initial, b => {
    const job = b.jobs[externalJobId];
    if (!job || job.owner !== scope.owner || job.locationId !== scope.locationId) throw new KitchenError("ジョブが見つかりません", 404);
    b.cancelled ||= {}; b.cancelled[job.rootJobId || externalJobId] ||= new Date().toISOString();
  });
}
export async function ownsAiJob(scope: AiScope, externalJobId: string): Promise<boolean> {
  const config = aiConfiguration();
  return atomicDocument(budgetKey(scope.environment, config.org), initial, b => { const job = b.jobs[externalJobId]; return !!job && job.owner === scope.owner && job.locationId === scope.locationId; });
}
