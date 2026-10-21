// Temporary, explicitly approved Preview-only connection test. Never a public API route.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let stage = 'configuration';
async function main() {
  const raw = process.env.COOKSYNC_APPROVED_SMOKE;
  if (!raw) { console.log('COOKSYNC_SMOKE skipped: no approval configuration'); return; }
  const c = JSON.parse(raw), now = Date.now();
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== 'codex/cooksync-approved-api-test') throw Error('wrong-environment');
  if (Date.parse(c.expiresAt) <= now) { console.log('COOKSYNC_SMOKE skipped: approval expired'); return; }
  if (!Number.isFinite(Date.parse(c.verifiedAt)) || Date.parse(c.verifiedAt) > now || now - Date.parse(c.verifiedAt) > 3600000 || Date.parse(c.expiresAt) - Date.parse(c.verifiedAt) > 3600000 || Date.parse(c.creditExpiresAt) <= now || c.budgetMicroUsd !== 50000 || c.verifiedCreditMicroUsd < 50000 || !/^[a-f0-9-]{36}$/.test(c.orgId) || !/^wrkspc_/.test(c.workspaceId)) throw Error('invalid-approval');
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !key.startsWith(c.keyPrefix) || !key.endsWith(c.keySuffix) || c.keyPrefix.length < 15 || c.keySuffix.length < 4) throw Error('key-not-matched');
  if (!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) && !(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)) throw Error('durable-ledger-required');
  const ts = require('typescript');
  require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
  const { budgetKey, reserveAttempt, settleAttempt } = require(path.resolve('src/lib/kitchen/aiBudget.ts'));
  const { atomicDocument } = require(path.resolve('src/lib/kitchen/atomicDocument.ts'));
  const ledger = budgetKey('test', c.orgId), attemptId = 'approved-synthetic-text-2026-10-21';
  const previous = await atomicDocument(ledger, () => ({ attempts: {}, jobs: {} }), b => b.attempts[attemptId] || null);
  if (previous) { console.log('COOKSYNC_SMOKE ' + JSON.stringify({ replaySkipped: true, status: previous.status, chargedMicroUsd: previous.charged, requestId: previous.requestId })); return; }
  const Anthropic = require('@anthropic-ai/sdk').default;
  const client = new Anthropic({ apiKey: key, baseURL: 'https://api.anthropic.com', maxRetries: 0, timeout: 30000, logLevel: 'off' });
  stage = 'read-only-model-and-organization-verification';
  const model = await client.models.retrieve('claude-haiku-4-5').withResponse();
  const org = model.response.headers.get('anthropic-organization-id');
  const workspace = model.response.headers.get('anthropic-workspace-id');
  if (org !== c.orgId || workspace !== c.workspaceId) throw Error('organization-or-workspace-mismatch');
  if (!model.data.id.startsWith('claude-haiku-4-5')) throw Error('unexpected-model');
  console.log('COOKSYNC_SMOKE ' + JSON.stringify({ preflight: true, organizationMatched: true, workspaceMatched: true, keyMatched: true, model: model.data.id, environment: 'test', deployment: process.env.VERCEL_URL }));
  // Configure this one process only. No production or app runtime settings are changed.
  Object.assign(process.env, { COOKSYNC_AI_ENABLED: '1', COOKSYNC_AI_ENVIRONMENT: 'test', COOKSYNC_AI_ORG_ID: org, COOKSYNC_AI_KEY_SHA256: crypto.createHash('sha256').update(key).digest('hex'), COOKSYNC_AI_BUDGET_MICRO_USD: '50000', COOKSYNC_AI_VERIFIED_CREDIT_MICRO_USD: String(c.verifiedCreditMicroUsd), COOKSYNC_AI_BALANCE_VERIFIED_AT: c.verifiedAt, COOKSYNC_AI_BALANCE_RECHECK_AT: c.expiresAt, COOKSYNC_AI_CREDIT_EXPIRES_AT: c.expiresAt, COOKSYNC_AI_MODEL: 'claude-haiku-4-5' });
  const { requireAiConfiguration } = require(path.resolve('src/lib/kitchen/aiBudget.ts'));
  requireAiConfiguration();
  stage = 'atomic-budget-reservation';
  await reserveAttempt(ledger, attemptId, { owner: 'approved-synthetic-smoke', locationId: 'synthetic-only', jobId: attemptId, environment: 'test' }, 50000, 50000);
  stage = 'single-inference';
  try {
    const result = await client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 256, messages: [{ role: 'user', content: '接続確認です。OKとのみ答えてください。' }] }, { maxRetries: 0, timeout: 30000 }).withResponse();
    const u = result.data.usage;
    if (result.response.headers.get('anthropic-organization-id') !== org || result.response.headers.get('anthropic-workspace-id') !== workspace || u.cache_creation_input_tokens || u.cache_read_input_tokens || u.server_tool_use?.web_search_requests) throw Error('response-needs-reconciliation');
    const actual = u.input_tokens + u.output_tokens * 5;
    const requestId = result.response.headers.get('request-id');
    // Short synthetic text + 256 output tokens is conservatively below the approved 50,000 micro-USD.
    if (!Number.isSafeInteger(actual) || actual > 50000) throw Error('cost-needs-reconciliation');
    await settleAttempt(ledger, attemptId, actual, requestId || undefined);
    console.log('COOKSYNC_SMOKE ' + JSON.stringify({ completed: true, inferenceCalls: 1, requestId, model: result.data.model, inputTokens: u.input_tokens, outputTokens: u.output_tokens, chargedMicroUsd: actual, budgetMicroUsd: 50000, responseIsOk: result.data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim() === 'OK', at: new Date().toISOString(), creditReconciliation: 'pending-console', environment: 'test' }));
  } catch (e) { await settleAttempt(ledger, attemptId, null).catch(() => {}); throw e; }
  finally { process.env.COOKSYNC_AI_ENABLED = '0'; delete process.env.ANTHROPIC_API_KEY; }
}
main().catch(e => { console.error('COOKSYNC_SMOKE ' + JSON.stringify({ failed: true, stage, status: typeof e.status === 'number' ? e.status : undefined, reason: ['wrong-environment','invalid-approval','key-not-matched','durable-ledger-required','organization-or-workspace-mismatch','unexpected-model','response-needs-reconciliation','cost-needs-reconciliation'].includes(e.message) ? e.message : 'safe-stop-see-stage', retries: 0 })); process.exitCode = 1; });
