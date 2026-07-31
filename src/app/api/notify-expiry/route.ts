// 期限通知の設定（オン/オフ・何日前・何時）の読み書き。
//
// ⚠️ 宛先 uid は **必ず resolvePushTarget() が決める**。
//    body の `u` をそのまま設定キーにすると、他人の uid で通知をONにして
//    冷蔵庫の中身（食材名）が載った通知を横取りできる（監査 H-6 と同じ穴）。
//    定期実行はここで確定した uid にしか送らないので、認可の境目はこの1本だけ。
import { resolvePushTarget } from "@/lib/pushServer";
import {
  DEFAULT_EXPIRY_SETTINGS,
  HOUR_CHOICES,
  LEAD_DAY_CHOICES,
  normalizeSettings,
  readSettings,
  writeSettings,
} from "@/lib/expiryNotify";

export const dynamic = "force-dynamic";

function forbidden(): Response {
  return Response.json(
    { error: "ログインが確認できませんでした。ログインし直してください。" },
    { status: 403 },
  );
}

/** いまの設定を返す（未設定なら既定値）。画面はこれを初期表示に使う */
export async function GET(request: Request) {
  const target = await resolvePushTarget(
    request,
    new URL(request.url).searchParams.get("u"),
  );
  if (!target) return forbidden();
  const settings = (await readSettings(target.uid)) ?? DEFAULT_EXPIRY_SETTINGS;
  return Response.json({
    settings,
    choices: { leadDays: LEAD_DAY_CHOICES, hours: HOUR_CHOICES },
  });
}

/** 設定を保存する。通知の許可取りは画面側（オンにした直後だけ聞く） */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      u?: string;
      enabled?: boolean;
      leadDays?: number[];
      hour?: number;
      tzOffsetMinutes?: number;
    };
    const target = await resolvePushTarget(request, body.u);
    if (!target) return forbidden();

    // 前の設定の「最後に送った日」「不達回数」は引き継ぐ（設定を触っただけで
    // 今日もう1通鳴る、が起きないように）
    const prev = await readSettings(target.uid);
    const settings = normalizeSettings({
      enabled: body.enabled,
      leadDays: body.leadDays,
      hour: body.hour,
      tzOffsetMinutes: body.tzOffsetMinutes,
      lastSentOn: prev?.lastSentOn,
      misses: 0,
    });
    await writeSettings(target.uid, settings);
    return Response.json({ ok: true, settings });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "save failed" },
      { status: 500 },
    );
  }
}
