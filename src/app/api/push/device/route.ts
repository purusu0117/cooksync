// ネイティブアプリ（iOS）の端末トークン登録（APNs用）。
// アプリ起動時に @capacitor/push-notifications が受け取ったトークンをここへ送る。
// Web Push の購読（/api/push/subscribe）とは別に保存し、送信時に両方へ振り分ける。
//
// ⚠️ 宛先uidは無検証で受けない（監査 H-6）。加えて DELETE は無認証・token省略で
//    「そのuidの全端末を解除」できてしまっていた＝他人の通知を黙って止められた。
//    → Cookieが無いリクエストは **token を明示したときだけ** 解除できる。
import { addDevice, removeDevice, resolvePushTarget } from "@/lib/pushServer";

export const dynamic = "force-dynamic";

interface Body {
  token?: string;
  platform?: string;
  u?: string;
}

function denied(): Response {
  return Response.json(
    { error: "ログインが確認できませんでした。ログインし直してください。" },
    { status: 403 },
  );
}

export async function POST(request: Request) {
  try {
    const { token, u } = (await request.json()) as Body;
    const t = (token ?? "").trim();
    // APNsのトークンは16進64文字。長すぎる/不正な値は弾く
    if (!t || t.length > 400 || !/^[0-9a-fA-F]+$/.test(t)) {
      return Response.json({ error: "token required" }, { status: 400 });
    }
    const target = await resolvePushTarget(request, u);
    if (!target) return denied();
    await addDevice(target.uid, t);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "device register failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { token, u } = (await request.json().catch(() => ({}))) as Body;
    const target = await resolvePushTarget(request, u);
    if (!target) return denied();
    const t = token?.trim();
    // 一括解除（token省略）は**ログイン済み本人だけ**。未ログインは自分の端末トークンを示すこと。
    if (!t && !target.trusted) {
      return Response.json({ error: "token required" }, { status: 400 });
    }
    await removeDevice(target.uid, t || undefined);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "device delete failed" },
      { status: 500 },
    );
  }
}
