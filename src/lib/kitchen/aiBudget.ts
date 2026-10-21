import { createHash } from "node:crypto";
import { atomicDocument } from "./atomicDocument";
import { KitchenError } from "./engine";
export interface AiScope { owner: string; locationId: string; jobId: string; environment: string }
export interface Attempt { owner: string; locationId: string; jobId: string; ceiling: number; charged: number; status: "reserved" | "settled" | "unknown"; at: string; requestId?: string }
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
export async function reserveAttempt(key: string, attemptId: string, scope: AiScope, ceiling: number, limit: number, now = new Date().toISOString()): Promise<void> {
  if (!Number.isSafeInteger(ceiling) || ceiling <= 0 || !Number.isSafeInteger(limit) || limit < 0) throw new KitchenError("費用上限が不正です", 503);
  await atomicDocument(key, initial, b => {
    if (b.attempts[attemptId]) throw new KitchenError("このAI試行は開始済みです。再実行には新しい予算予約が必要です", 409);
    const entries = Object.values(b.attempts);
    const used = entries.reduce((total, a) => total + (a.status === "settled" ? a.charged : a.ceiling), 0);
    if (used + ceiling > limit) throw new KitchenError("設定したAI費用上限に達しました", 429);
    // Unknown outcomes retain their full budget but do not occupy a forever-running slot.
    if (entries.filter(a => a.owner === scope.owner && a.status === "reserved" && Date.parse(a.at) > Date.parse(now) - 180000).length >= 2) throw new KitchenError("AI処理中です。完了してから続けてください", 429);
    b.attempts[attemptId] = { ...scope, ceiling, charged: 0, status: "reserved", at: now };
  });
}
export async function settleAttempt(key: string, id: string, charged: number | null, requestId?: string): Promise<void> {
  await atomicDocument(key, initial, b => {
    const a = b.attempts[id]; if (!a) throw new Error("費用予約が見つかりません");
    if (a.status !== "reserved") return;
    if (charged === null) { a.status = "unknown"; return; }
    if (!Number.isSafeInteger(charged) || charged < 0 || charged > a.ceiling) { a.status = "unknown"; throw new Error("利用費用の照合が必要です"); }
    a.charged = charged; a.status = "settled"; a.requestId = requestId;
  });
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
