import type { ReconciliationRecord } from "./aiBudget";
/**
 * Operator-verified outcomes of AI attempts whose usage could not be read at the time (timeout / abort).
 * Each entry was matched by a person against the provider's own usage record before being committed here,
 * so the ledger counts the measured charge instead of the held ceiling. Entries only ever apply to an attempt
 * that is still "unknown" with the same start time and ceiling in the named environment; nothing is removed.
 * COOKSYNC_AI_RECONCILED_ATTEMPTS (same shape, JSON array) can add records for one deployment without a code change.
 */
export const RECONCILED_ATTEMPTS: (ReconciliationRecord & { environment: string })[] = [
  {
    environment: "test",
    at: "2026-10-21T04:36:48.690Z",
    ceilingMicroUsd: 4180000,
    chargedMicroUsd: 276924,
    requestId: "req_011CgEmAnaSHzwmr5UqbDVbA",
    evidence: "Console request log for this request id: 11 server-tool iterations, 112,302 input + 3,232 output tokens (claude-sonnet-5, $2/$10 per M) = $0.256924, plus 2 web searches = $0.276924. Cross-checked 2026-10-22 on the Console cost page (CookSync workspace, last 30 days): total $0.47 = token $0.43 + search $0.04, which equals the 5 settled attempts ($0.192807, 2 searches) plus this amount; promotional credit $200.00 -> $199.53, purchased balance $6.56 unchanged.",
  },
];
