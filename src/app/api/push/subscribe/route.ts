// Web Push（ブラウザ/PWA）の購読登録。
//
// ⚠️ 以前は body の `u` を**そのまま**購読キーにしていた（2026-08-01 監査 H-6）。
//    攻撃者が被害者の uid を名乗って自分のendpointを登録すれば、
//    「〇〇が完成しました」のようなレシピ名入りの通知を横取りできた。
//    → 宛先は resolvePushTarget() が決める（Cookieが正・他人のdataIdは名乗れない）。
import { addSubscription, resolvePushTarget } from "@/lib/pushServer";

export const dynamic = "force-dynamic";

interface SubBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  u?: string;
}

export async function POST(request: Request) {
  try {
    const sub = (await request.json()) as SubBody;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return Response.json({ error: "invalid subscription" }, { status: 400 });
    }
    const target = await resolvePushTarget(request, sub.u);
    if (!target) {
      return Response.json(
        { error: "ログインが確認できませんでした。ログインし直してください。" },
        { status: 403 },
      );
    }
    await addSubscription(target.uid, {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "subscribe failed" },
      { status: 500 },
    );
  }
}
