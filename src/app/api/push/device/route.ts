// ネイティブアプリ（iOS）の端末トークン登録（APNs用）。
// アプリ起動時に @capacitor/push-notifications が受け取ったトークンをここへ送る。
// Web Push の購読（/api/push/subscribe）とは別に保存し、送信時に両方へ振り分ける。
import { addDevice, removeDevice } from "@/lib/pushServer";

export const dynamic = "force-dynamic";

interface Body {
  token?: string;
  platform?: string;
  u?: string;
}

export async function POST(request: Request) {
  try {
    const { token, u } = (await request.json()) as Body;
    const t = (token ?? "").trim();
    // APNsのトークンは16進64文字。長すぎる/不正な値は弾く
    if (!t || t.length > 400 || !/^[0-9a-fA-F]+$/.test(t)) {
      return Response.json({ error: "token required" }, { status: 400 });
    }
    await addDevice(u || "anon", t);
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
    await removeDevice(u || "anon", token?.trim() || undefined);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "device delete failed" },
      { status: 500 },
    );
  }
}
