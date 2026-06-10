// デプロイ後のヘルスチェック/疎通確認用。
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    app: "cooksync",
    // 公開時の設定状況をひと目で確認（鍵の中身は出さない）
    aiProvider: process.env.ANTHROPIC_API_KEY ? "api" : "local",
    db: process.env.DATABASE_URL ? "configured" : "local-json",
  });
}
