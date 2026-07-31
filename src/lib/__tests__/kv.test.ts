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
});

describe("assertKvConfigured", () => {
  it("テスト環境（Redis未設定）では落ちない＝ローカル開発は従来どおり", () => {
    expect(redis).toBeNull();
    expect(() => assertKvConfigured()).not.toThrow();
  });

  it("**本番でRedis未設定なら落ちる**", () => {
    setNodeEnv("production");
    expect(() => assertKvConfigured()).toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it("`next build`（NODE_ENV=production だが起動ではない）では落ちない", () => {
    setNodeEnv("production");
    process.env.NEXT_PHASE = "phase-production-build";
    expect(() => assertKvConfigured()).not.toThrow();
  });
});
