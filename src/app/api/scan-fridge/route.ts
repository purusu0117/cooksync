import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { askClaudeVisionItems } from "@/lib/ai";
import { consume, quotaResponse, refund } from "@/lib/quotaServer";
import { identify } from "@/lib/session";

// 冷蔵庫の写真 → AIが食材名を抽出。期限・カテゴリはクライアント側で推定する。
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  let tmp = "";
  const uid = identify(request, request.headers.get("x-cooksync-uid") ?? undefined).uid;
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) {
      return Response.json({ error: "image required" }, { status: 400 });
    }

    // AIを呼ぶ前に枠を確認する（サーバー側が唯一の判定者）
    const q = await consume(uid, "scan", request);
    if (!q.ok) return quotaResponse(q, "scan");
    const buf = Buffer.from(await file.arrayBuffer());
    // Vercelは書き込み可能なのが /tmp のみ。os.tmpdir() でローカルとも両対応。
    const dir = path.join(os.tmpdir(), "cooksync-scan");
    await fs.mkdir(dir, { recursive: true });
    const ext = file.type.includes("png") ? "png" : "jpg";
    tmp = path.join(dir, `${globalThis.crypto.randomUUID()}.${ext}`);
    await fs.writeFile(tmp, buf);

    try {
      const items = await askClaudeVisionItems(tmp);
      return Response.json({ items });
    } catch (e) {
      await refund(uid, "scan", request).catch(() => {}); // 失敗したら枠を戻す
      throw e;
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "scan failed" },
      { status: 500 },
    );
  } finally {
    if (tmp) await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
