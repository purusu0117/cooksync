// /api/health は「この構成で枠を強制しているか」をクライアントに伝える唯一の口。
//
// ⚠️ ここが欠けると、ローカル版（claude.exe＝原価0でサーバーは枠を見ない）でも
//    **画面側のカウンタだけが先に止める**。実際に大翔のローカルで起きた（2026-08-02）。
//    サーバーは通すのに画面が断る＝一番たちの悪い嘘なので、配線をテストで固定する。
//
// ⚠️ このテストは **process.env を書き換えない**。
//    テストファイルは同じプロセスで並行に走るため、env を触ると他ファイル
//    （quotaServer.test.ts は COOKSYNC_ENFORCE_QUOTA に依存）を巻き込んで落とす。
//    実際に一度やらかした。env の分岐は quotaServer 側のテストが担当する。

import { describe, it, expect } from "vitest";
import { GET } from "../route";
import { quotaEnforced } from "@/lib/quotaServer";

describe("/api/health", () => {
  it("枠を強制しているかを、サーバーの判定そのままで返す", async () => {
    const h = (await GET().json()) as { ok: boolean; quotaEnforced: boolean };
    expect(h.ok).toBe(true);
    // 独自に env を読み直して判断しない＝quotaServer が唯一の正であることを固定する
    expect(h.quotaEnforced).toBe(quotaEnforced());
  });

  it("quotaEnforced を必ず boolean で返す（未定義だとクライアントが制限ありに倒れる）", async () => {
    const h = (await GET().json()) as { quotaEnforced: unknown };
    expect(typeof h.quotaEnforced).toBe("boolean");
  });

  it("クライアントが見る他のフラグも欠けていない", async () => {
    const h = (await GET().json()) as Record<string, unknown>;
    expect(h.aiProvider === "local" || h.aiProvider === "api").toBe(true);
    expect(typeof h.videoImport).toBe("boolean");
  });
});
