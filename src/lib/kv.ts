// 共通Redisクライアント（公開=Upstash/Vercel KV）。
// 環境変数が無ければ null＝ローカル（ファイル/メモリ）にフォールバック。
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const redis = url && token ? new Redis({ url, token }) : null;
