// 本番でRedisが無いまま起動させない（監査 C-8）。
//
// 落ちなかった場合に何が起きるか：/api/store のローカル経路に落ちて、
// 全ユーザーが同じ `.data/store.json` を共有し、デプロイのたびに全員のデータが消える。
// 「静かに壊れる」ので、落ちる方が圧倒的にマシ。

import { describe, it, expect, afterEach } from "vitest";
import { assertKvConfigured, redis } from "../kv";

const original = process.env.NODE_ENV;

function setNodeEnv(v: string) {
  // process.env は通常の代入が型で禁じられているので defineProperty で差し替える
  Object.defineProperty(process.env, "NODE_ENV", {
    value: v,
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

afterEach(() => {
  setNodeEnv(original ?? "test");
  delete process.env.NEXT_PHASE;
  delete process.env.VERCEL;
  delete process.env.COOKSYNC_REQUIRE_KV;
});

describe("assertKvConfigured", () => {
  it("テスト環境（Redis未設定）では落ちない＝ローカル開発は従来どおり", () => {
    expect(redis).toBeNull();
    expect(() => assertKvConfigured()).not.toThrow();
  });

  it("**配信されている本番(VERCEL)でRedis未設定なら落ちる**", () => {
    process.env.VERCEL = "1";
    expect(() => assertKvConfigured()).toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  // ⚠️ ここが判定の肝。`next start` はローカルでも NODE_ENV=production を立てるので、
  //    NODE_ENV で判定すると大翔のローカル版（next start -p 3000）が全部500になる。
  //    実際に一度そうなった（2026-08-01）。判定は VERCEL の有無で行う。
  it("NODE_ENV=production でも VERCEL が無ければ落ちない（ローカルの next start）", () => {
    setNodeEnv("production");
    expect(() => assertKvConfigured()).not.toThrow();
  });

  it("自前ホスティング用に COOKSYNC_REQUIRE_KV=1 で明示的に有効化できる", () => {
    process.env.COOKSYNC_REQUIRE_KV = "1";
    expect(() => assertKvConfigured()).toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it("`next build`（ビルド中）では落ちない", () => {
    process.env.VERCEL = "1";
    process.env.NEXT_PHASE = "phase-production-build";
    expect(() => assertKvConfigured()).not.toThrow();
  });
});
