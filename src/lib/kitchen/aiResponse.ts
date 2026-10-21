/** Hosting errors may return HTML. Never show that body or treat it as AI output. */
export async function readAiResponse(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("サーバーから処理結果を受け取れませんでした。保存はしていません。時間を置いて処理状況を確認してください。");
  }
  try { return await response.json(); }
  catch { throw new Error("処理結果の形式を確認できませんでした。保存はしていません。"); }
}
