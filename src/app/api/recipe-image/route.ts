import { startImageJob } from "@/lib/imageJobs";
import { resolvePushTarget } from "@/lib/pushServer";

export const dynamic = "force-dynamic";

interface Body {
  id?: string;
  name?: string;
  uid?: string; // 完了プッシュ通知の宛先
}

// 送信は即jobIdを返す（生成はサーバーで継続＝スマホで画面を閉じてもOK）。
export async function POST(request: Request) {
  try {
    // 公開（API）では画像生成は無効＝絵文字表示にフォールバック（500を出さない）
    if (process.env.ANTHROPIC_API_KEY) {
      return Response.json({ disabled: true });
    }
    const body = (await request.json()) as Body;
    const name = (body.name ?? "").trim();
    const safeId = (body.id ?? "").replace(/[^a-z0-9-]/gi, "");
    if (!name || !safeId) {
      return Response.json({ error: "id and name required" }, { status: 400 });
    }
    // 完了通知の宛先も**サーバーが決める**（他のpush経路と同じ規則。監査 H-6）。
    // 申告された uid をそのまま使うと、他人に通知を送りつける口になる。
    const target = await resolvePushTarget(request, body.uid);
    const jobId = startImageJob(safeId, name, target?.uid);
    // 日次上限（監査 1）。絵文字表示のフォールバックがあるので、正直に断ってよい
    if (!jobId) {
      return Response.json(
        { error: "今日の画像生成の上限に達しました。明日またお試しください。" },
        { status: 429 },
      );
    }
    return Response.json({ jobId });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "image generation failed" },
      { status: 500 },
    );
  }
}
