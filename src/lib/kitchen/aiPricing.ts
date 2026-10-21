// USD per million tokens (= integer micro-USD per token), verified 2026-10-21.
// https://platform.claude.com/docs/en/about-claude/pricing
export const APPROVED_AI_RATES: Record<string, readonly [number, number]> = {
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};
