import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';
// Read only the two approved budget documents; never print secrets, owners or inputs.
if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'codex/cooksync-approved-api-test' && Date.now() < Date.parse('2026-10-21T04:39:30Z')) {
  const org = process.env.COOKSYNC_AI_ORG_ID;
  if (org !== '169d2f38-7db6-4655-82a1-4be5f64c0eb0') throw new Error('Unexpected organization');
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN });
  const organizationHash = createHash('sha256').update(org).digest('hex');
  for (const environment of ['test', 'production']) {
    const raw = await redis.get(`cooksync:ai-ledger:v1:${environment}:${organizationHash}`);
    const ledger = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const attempts = Object.values(ledger?.attempts || {}).map(a => ({ at: a.at, status: a.status, chargedMicroUsd: a.charged, ceilingMicroUsd: a.ceiling, requestId: a.requestId }));
    console.log('COOKSYNC_BUDGET_AUDIT ' + JSON.stringify({ environment, attempts, at: new Date().toISOString(), inferenceCalls: 0 }));
  }
}
