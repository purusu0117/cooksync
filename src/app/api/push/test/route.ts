// 通知の疎通確認。自分（uid）の宛先にだけテスト通知を送り、何件届いたかを返す。
// APNsの鍵を設定したあと「本当にiPhoneに届くか」を確かめるために使う。
//   curl -X POST https://<本番>/api/push/test -H 'content-type: application/json' -d '{"u":"<uid>"}'
// 自分の宛先にしか送れないので、悪用されても他人には届かない。
import { sendPush } from "@/lib/pushServer";
import { apnsConfigured } from "@/lib/apns";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { u } = (await request.json().catch(() => ({}))) as { u?: string };
    const result = await sendPush(u || "anon", {
      title: "🍳 CookSync",
      body: "通知のテストです。これが見えていれば設定はOKです。",
      url: "/",
    });
    return Response.json({ ok: true, apns: apnsConfigured(), ...result });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "test failed" },
      { status: 500 },
    );
  }
}
