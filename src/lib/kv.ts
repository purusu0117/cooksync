// 共通Redisクライアント（公開=Upstash/Vercel KV）。
// 環境変数が無ければ null＝ローカル（ファイル/メモリ）にフォールバック。
//
// ⚠️ **本番でこのフォールバックに落ちてはいけない**（2026-08-01 の監査で発覚）。
//    Vercel等の本番でRedis未設定のまま起動すると、/api/store のローカル経路は
//    uid を一切見ない単一ファイル `.data/store.json` を使う。つまり
//      ・全ユーザーが**同じ冷蔵庫・同じレシピ**を共有し（他人のデータが丸見え）
//      ・デプロイのたびにファイルごと消える（全員のデータが消失）
//    しかも黙って起きるので気づけない。
//    → 本番でRedisが無いなら **起動時に落とす**。session.ts が
//      COOKSYNC_SESSION_SECRET で採っているのと同じ方針（弱い設定で動かすより落ちる）。
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const redis = url && token ? new Redis({ url, token }) : null;

/** `next build` は NODE_ENV=production で走るが「起動」ではない（ビルドマシンにRedisは要らない）。 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * 本番なのに保存先が無い状態を検出して落とす。
 * モジュール読み込み時（＝サーバー起動時）と、データを触る経路の入口の両方から呼ぶ。
 */
export function assertKvConfigured(): void {
  if (redis) return;
  if (process.env.NODE_ENV !== "production") return; // ローカル/テストは従来どおりファイル
  if (isBuildPhase()) return;
  throw new Error(
    "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が未設定です。" +
      "本番でこれが無いと全ユーザーが同じデータを共有し、デプロイのたびに消えます。",
  );
}

assertKvConfigured();
