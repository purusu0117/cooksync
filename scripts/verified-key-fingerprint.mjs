// Read-only preparation for configuring the already verified key. No network or inference.
import { createHash } from 'node:crypto';
const raw = process.env.COOKSYNC_APPROVED_SMOKE;
if (raw && process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'codex/cooksync-approved-api-test') {
  const c = JSON.parse(raw), key = process.env.ANTHROPIC_API_KEY || '';
  if (Date.parse(c.expiresAt) > Date.now() && c.keyPrefix?.length >= 15 && c.keySuffix?.length >= 4 && key.startsWith(c.keyPrefix) && key.endsWith(c.keySuffix)) {
    console.log('COOKSYNC_VERIFIED_KEY ' + JSON.stringify({ sha256: createHash('sha256').update(key).digest('hex'), inferenceCalls: 0, environment: 'test' }));
  }
}
