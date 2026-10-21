export function aiFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out/i.test(message)) return "AIの処理が時間内に完了しませんでした。結果は保存されていません。費用を確認できるまでAI予算の一部を確保しています。";
  return /[ぁ-んァ-ヶ一-龠]/.test(message) ? message : "AIの処理を完了できませんでした。結果は保存されていません。接続状況と利用枠を確認してください。";
}
