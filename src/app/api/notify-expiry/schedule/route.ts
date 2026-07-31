// QStash の定期実行スケジュールを **アプリ側から作る/貼り替える** 管理用エンドポイント。
// 大翔がQStashの管理画面を手で触らなくて済むように、1回叩けば整う形にしてある。
//
//   確認: GET  /api/notify-expiry/schedule?key=<COOKSYNC_ADMIN_KEY>
//   設定: POST /api/notify-expiry/schedule?key=<COOKSYNC_ADMIN_KEY>
//
// 毎正時（cron `0 * * * *`＝1日24通）に /api/notify-expiry/run を叩く。
// 送る時刻はユーザーごとに違うので、日1回では合わせられない。
// QStashの無料枠は1日500通なので24通は十分収まる。
import { Client } from "@upstash/qstash";
import { isAdminRequest } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const CRON_HOURLY = "0 * * * *";

function client(): Client | null {
  return process.env.QSTASH_TOKEN
    ? new Client({ token: process.env.QSTASH_TOKEN, baseUrl: process.env.QSTASH_URL })
    : null;
}

/** 発射口のURL。COOKSYNC_PUBLIC_URL があればそれを使う（プロキシ越しでも正しい公開URLになる） */
function runUrl(request: Request): string {
  const base = (process.env.COOKSYNC_PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");
  return `${base}/api/notify-expiry/run`;
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = client();
  if (!q) return Response.json({ error: "QSTASH_TOKEN が未設定です" }, { status: 503 });
  const target = runUrl(request);
  const all = await q.schedules.list();
  return Response.json({
    target,
    schedules: all
      .filter((s) => s.destination === target)
      .map((s) => ({ scheduleId: s.scheduleId, cron: s.cron, isPaused: s.isPaused })),
  });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const q = client();
    if (!q) return Response.json({ error: "QSTASH_TOKEN が未設定です" }, { status: 503 });
    const body = (await request.json().catch(() => ({}))) as { cron?: string; url?: string };
    const destination = body.url || runUrl(request);
    const cron = body.cron || CRON_HOURLY;

    // 同じ宛先の予定があれば**その予定を書き換える**（叩くたびに増えないように）
    const existing = (await q.schedules.list()).filter((s) => s.destination === destination);
    const scheduleId = existing[0]?.scheduleId;
    const res = await q.schedules.create({
      destination,
      cron,
      ...(scheduleId ? { scheduleId } : {}),
      body: JSON.stringify({ kind: "expiry-daily-scan" }),
      headers: { "Content-Type": "application/json" },
    });
    // 重複していた予定は消す（過去に手で作ったものが残っていても二重に鳴らない）
    for (const s of existing.slice(1)) await q.schedules.delete(s.scheduleId).catch(() => {});

    return Response.json({ ok: true, scheduleId: res.scheduleId, cron, destination });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "schedule failed" },
      { status: 500 },
    );
  }
}
