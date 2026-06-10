// デプロイ後のヘルスチェック/疎通確認用。
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    app: "cooksync",
    // 公開時の設定状況をひと目で確認（鍵の中身は出さない）
    aiProvider: process.env.ANTHROPIC_API_KEY ? "api" : "local",
    db:
      (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
        ? "redis"
        : "local-json",
  });
}
