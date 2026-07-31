// QStashが指定時刻に叩く先。タイマー完了プッシュを送る（アプリを閉じていても届く）。
//
// ⚠️ ここは**インターネットに開いた通知の発射口**。署名検証が唯一の鍵になる。
//    以前は QSTASH_*_SIGNING_KEY が未設定だと検証を**丸ごとスキップ**していたので、
//    鍵を入れ忘れた本番では誰でも任意のuidに任意の文言の通知を送れた（2026-08-01 監査 H-6）。
//    → 本番で鍵が無いなら**受け付けない**（session.ts / kv.ts と同じ fail closed）。
import { Receiver } from "@upstash/qstash";
import { sendPush } from "@/lib/pushServer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const cur = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const next = process.env.QSTASH_NEXT_SIGNING_KEY;
    if (!cur || !next) {
      // ローカルはQStashを使わない（/api/timer が setTimeout で鳴らす）ので、
      // ここに来るのは開発中の手動テストだけ。本番は必ず署名を要求する。
      if (process.env.NODE_ENV === "production") {
        return Response.json({ error: "signing key not configured" }, { status: 503 });
      }
    } else {
      const signature = request.headers.get("upstash-signature") || "";
      const receiver = new Receiver({ currentSigningKey: cur, nextSigningKey: next });
      const valid = await receiver
        .verify({ signature, body: raw })
        .catch(() => false);
      if (!valid) {
        return Response.json({ error: "invalid signature" }, { status: 401 });
      }
    }
    const { uid, label, url } = JSON.parse(raw || "{}") as {
      uid?: string;
      label?: string;
      url?: string;
    };
    await sendPush(uid || "anon", {
      title: "⏰ タイマー完了",
      body: `${label || "タイマー"}が完了しました`,
      url: url || "/",
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "fire failed" },
      { status: 500 },
    );
  }
}
