// タイマー完了をサーバー側で予約 → アプリを閉じていても終了時刻ちょうどにプッシュ。
//  - 公開（Vercel）：QStash（指定時刻にHTTPを叩く）で /api/timer-fire を予約。
//  - ローカル：プロセス内 setTimeout。
import { sendPush } from "@/lib/pushServer";
import { redis } from "@/lib/kv";
import { Client } from "@upstash/qstash";

export const dynamic = "force-dynamic";

const qstash = process.env.QSTASH_TOKEN
  ? new Client({
      token: process.env.QSTASH_TOKEN,
      // EU/USリージョンのトークンは接続先URLも合わせる必要がある
      baseUrl: process.env.QSTASH_URL,
    })
  : null;

interface Body {
  id?: string;
  endAt?: number; // 終了時刻(ms)。設定で予約、cancel:true で解除
  label?: string;
  cancel?: boolean;
  u?: string;
}

// ローカル用：プロセス内に予約を保持（id→setTimeoutハンドル）
const scheduled = new Map<string, ReturnType<typeof setTimeout>>();

export async function POST(request: Request) {
  try {
    const { id, endAt, label, cancel, u } = (await request.json()) as Body;
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    const uid = u || "anon";

    // ---- 公開：QStash ----
    if (qstash && redis) {
      // 既存の予約があれば取り消し（再設定・停止・削除に対応）
      const prev = await redis.get<string>(`timer:${id}`);
      if (prev) {
        await qstash.messages.delete(prev).catch(() => {});
        await redis.del(`timer:${id}`);
      }
      if (cancel) return Response.json({ ok: true });
      if (typeof endAt !== "number") {
        return Response.json({ error: "endAt required" }, { status: 400 });
      }
      const origin = new URL(request.url).origin;
      const res = await qstash.publishJSON({
        url: `${origin}/api/timer-fire`,
        body: { uid, label },
        notBefore: Math.floor(endAt / 1000),
      });
      await redis.set(`timer:${id}`, res.messageId, { ex: 24 * 3600 });
      return Response.json({ ok: true });
    }

    // ---- ローカル：setTimeout ----
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
      void sendPush(uid, {
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
