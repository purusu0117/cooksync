// 期限通知の発射口。**1時間に1回** QStash に叩かれ、
// 「いまが送る時刻の人」だけに1通ずつ送る。
//
// なぜ1時間に1回か:
//   送る時刻をユーザーが選べる（既定=18時）ので、日に1回では合わせられない。
//   その人の現地時刻が設定した時刻のときだけ送る判定を expiryNotify.ts が持っている。
//
// ⚠️ ここも timer-fire と同じく**インターネットに開いた通知の発射口**。
//    署名検証が唯一の鍵なので、本番で鍵が無いなら受け付けない（fail closed）。
import { Receiver } from "@upstash/qstash";
import { isAdminRequest } from "@/lib/adminAuth";
import { runExpiryNotifications } from "@/lib/expiryNotify";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const admin = isAdminRequest(request); // 大翔の手動確認（?key=COOKSYNC_ADMIN_KEY）
    if (!admin) {
      const cur = process.env.QSTASH_CURRENT_SIGNING_KEY;
      const next = process.env.QSTASH_NEXT_SIGNING_KEY;
      if (!cur || !next) {
        // ローカルはQStashを使わない（大翔が ?key= で叩く）。本番は必ず署名を要求する。
        if (process.env.NODE_ENV === "production") {
          return Response.json({ error: "signing key not configured" }, { status: 503 });
        }
      } else {
        const signature = request.headers.get("upstash-signature") || "";
        const receiver = new Receiver({ currentSigningKey: cur, nextSigningKey: next });
        const valid = await receiver.verify({ signature, body: raw }).catch(() => false);
        if (!valid) return Response.json({ error: "invalid signature" }, { status: 401 });
      }
    }

    // 管理鍵のときだけ、時刻待ちを飛ばして1人ぶんだけ試せる（疎通確認用）
    const body = (() => {
      try {
        return JSON.parse(raw || "{}") as { force?: boolean; uid?: string };
      } catch {
        return {};
      }
    })();

    const result = await runExpiryNotifications({
      force: admin ? !!body.force : false,
      onlyUid: admin && body.uid ? body.uid : undefined,
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "expiry notify failed" },
      { status: 500 },
    );
  }
}
