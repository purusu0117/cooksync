import { sendPush } from "@/lib/pushServer";

// タイマー完了をサーバー側で予約 → アプリを閉じていても終了時刻ちょうどにプッシュ。
export const dynamic = "force-dynamic";

interface Body {
  id?: string;
  endAt?: number; // 終了時刻(ms)。設定で予約、cancel:true で解除
  label?: string;
  cancel?: boolean;
}

// サーバープロセス内に予約を保持（id→setTimeoutハンドル）
const scheduled = new Map<string, ReturnType<typeof setTimeout>>();

export async function POST(request: Request) {
  try {
    const { id, endAt, label, cancel } = (await request.json()) as Body;
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    // 既存予約があれば必ず解除（再設定・一時停止・削除に対応）
    const existing = scheduled.get(id);
    if (existing) {
      clearTimeout(existing);
      scheduled.delete(id);
    }
    if (cancel) return Response.json({ ok: true });

    if (typeof endAt !== "number") {
      return Response.json({ error: "endAt required" }, { status: 400 });
    }
    const delay = Math.max(0, endAt - Date.now());
    const handle = setTimeout(() => {
      scheduled.delete(id);
      void sendPush({
        title: "⏰ タイマー完了",
        body: `${label || "タイマー"}が完了しました`,
        url: "/",
      });
    }, delay);
    scheduled.set(id, handle);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "timer schedule failed" },
      { status: 500 },
    );
  }
}
