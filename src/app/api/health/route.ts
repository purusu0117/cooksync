// デプロイ後のヘルスチェック/疎通確認用。
export const dynamic = "force-dynamic";

export function GET() {
  const hasRedis = !!(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
    (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
  );
  return Response.json({
    ok: true,
    app: "cooksync",
    // 公開時の設定状況をひと目で確認（鍵の中身は出さない）
    aiProvider: process.env.ANTHROPIC_API_KEY ? "api" : "local",
    db: hasRedis ? "redis" : "local-json",
    // 動画からの取り込みは yt-dlp(uvx) をサブプロセスで起動するのでローカル版だけ。
    // クライアントはこれを見て入口ごと隠す（押しても必ず501になる機能を出さない＝
    // App Store審査ガイドライン 2.1「動作しない機能を含めない」対策）。
    videoImport: !hasRedis,
  });
}
