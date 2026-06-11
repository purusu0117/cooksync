// QStashが指定時刻に叩く先。タイマー完了プッシュを送る（アプリを閉じていても届く）。
import { Receiver } from "@upstash/qstash";
import { sendPush } from "@/lib/pushServer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const cur = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const next = process.env.QSTASH_NEXT_SIGNING_KEY;
    if (cur && next) {
      const signature = request.headers.get("upstash-signature") || "";
      const receiver = new Receiver({ currentSigningKey: cur, nextSigningKey: next });
      const valid = await receiver
        .verify({ signature, body: raw })
        .catch(() => false);
      if (!valid) {
        return Response.json({ error: "invalid signature" }, { status: 401 });
      }
    }
    const { uid, label } = JSON.parse(raw || "{}") as {
      uid?: string;
      label?: string;
    };
    await sendPush(uid || "anon", {
      title: "⏰ タイマー完了",
      body: `${label || "タイマー"}が完了しました`,
      url: "/",
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "fire failed" },
      { status: 500 },
    );
  }
}
