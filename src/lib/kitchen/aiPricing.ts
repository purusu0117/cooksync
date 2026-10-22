// USD per million tokens (= integer micro-USD per token), verified 2026-10-21.
// https://platform.claude.com/docs/en/about-claude/pricing
export const APPROVED_AI_RATES: Record<string, readonly [number, number]> = {
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};
/** Web search is billed per request: $10 / 1,000 searches = 10,000 micro-USD each. */
export const WEB_SEARCH_MICRO_USD = 10000;
/** Every search request is capped at this many searches (managedMessage sets max_uses). */
export const MAX_SEARCH_USES = 2;
/** Each search can return several pages of content; 40k tokens per search is well above the 17k observed on 2026-10-21. */
export const SEARCH_RESULT_TOKENS = 40000;
/** Nominal request size used for the "can a search start?" preview on the kitchen snapshot. */
export const NOMINAL_SEARCH_INPUT_TOKENS = 40000;

/**
 * Upper bound for one direct-search request, derived from how the server tool loop works:
 * at most MAX_SEARCH_USES searches, hence at most MAX_SEARCH_USES + 1 sampling iterations,
 * each re-reading the prompt plus every search result obtained so far.
 * Observed on 2026-10-21: 27,579 input / 8,433 output / 2 searches = $0.159488 for a 5,377-token prompt.
 * This bound is roughly 4x that; actual usage above the bound is still recorded in full (see settleAttempt).
 */
export function searchReservationMicroUsd(model: string, maxTokens = 8192, inputTokens = NOMINAL_SEARCH_INPUT_TOKENS): number | null {
  const rate = APPROVED_AI_RATES[model];
  if (!rate || !Number.isFinite(inputTokens) || inputTokens < 0 || !Number.isFinite(maxTokens) || maxTokens <= 0) return null;
  const iterations = MAX_SEARCH_USES + 1;
  const perIteration = Math.ceil(inputTokens) + MAX_SEARCH_USES * SEARCH_RESULT_TOKENS;
  return iterations * perIteration * rate[0] + Math.ceil(maxTokens) * rate[1] + MAX_SEARCH_USES * WEB_SEARCH_MICRO_USD;
}
