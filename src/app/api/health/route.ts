// デプロイ後のヘルスチェック/疎通確認用。
import { quotaEnforced } from "@/lib/quotaServer";
import { aiConfiguration } from "@/lib/kitchen/aiBudget";

export const dynamic = "force-dynamic";

export function GET() {
  const ai = aiConfiguration();
  const hasRedis = !!(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
    (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
  );
  return Response.json({
    ok: true,
    app: "cooksync",
    // 公開時の設定状況をひと目で確認（鍵の中身は出さない）
    aiProvider: ai.enabled ? "api" : "disabled",
    aiEnabled: ai.enabled,
    kitchenSchema: 3,
    // Git commit metadata is public; never expose keys, owners or ledger contents.
    revision: process.env.VERCEL_GIT_COMMIT_SHA || null,
    db: hasRedis ? "redis" : "local-json",
    // AI枠を**サーバーが実際に強制しているか**。ローカル(claude.exe＝原価0)では false。
    // ⚠️ クライアントはこれを見て事前チェックを止める。これを返さないと、
    //    サーバーは通すのに画面側のカウンタだけが止める状態になる（2026-08-02 の実害）。
    quotaEnforced: quotaEnforced(),
    // 動画からの取り込みは素のHTTPだけで動くようになったので、ローカルも公開も同じく使える。
    // （以前は yt-dlp のサブプロセス起動が必要でVercelでは動かず、ここを false にして
    //   入口ごと隠していた。フィールド自体はクライアントが見ているので残す）
    videoImport: ai.enabled,
  }, { headers: { "Cache-Control": "no-store" } });
}
