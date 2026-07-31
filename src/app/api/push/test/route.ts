// 通知の疎通確認。**自分の宛先にだけ**テスト通知を送り、何件届いたかを返す。
//
// ⚠️ 以前は完全に無認証で、body の `u` に任意のuidを書けば**誰の端末でも鳴らせた**
//    （2026-08-01 監査 H-6）。通知は嫌がらせにもフィッシングにも使えるので閉じる。
//
// 使い方:
//   ・アプリから（ログイン済み・Cookieあり）: POST /api/push/test
//   ・大翔の疎通確認: POST /api/push/test?key=<COOKSYNC_ADMIN_KEY> -d '{"u":"<uid>"}'
import { sendPush, resolvePushTarget } from "@/lib/pushServer";
import { apnsConfigured } from "@/lib/apns";
import { isAdminRequest } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { u } = (await request.json().catch(() => ({}))) as { u?: string };

    // 管理鍵があるときだけ、任意のuidを指定できる（大翔の疎通確認用）
    if (isAdminRequest(request)) {
      const result = await sendPush(u || "anon", {
        title: "🍳 CookSync",
        body: "通知のテストです。これが見えていれば設定はOKです。",
        url: "/",
      });
      return Response.json({ ok: true, apns: apnsConfigured(), ...result });
    }

    // 通常経路：**ログイン済み本人の宛先にしか送らない**
    const target = await resolvePushTarget(request, u);
    if (!target || !target.trusted) {
      return Response.json(
        { error: "ログインが確認できませんでした。ログインし直してからお試しください。" },
        { status: 401 },
      );
    }
    const result = await sendPush(target.uid, {
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
