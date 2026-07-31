// 写真（レシピ本のページ・SNSのスクショ・手書きメモ・料理写真）からレシピを起こす。
// 冷蔵庫の写真スキャン(/api/scan-fridge)と同じ経路で、読み取る中身だけ違う。
//
// ⚠️ 動画取り込みと同じ方針：**写真に写っていない分量をAIに埋めさせない**。
//    読めなかった材料は missing で返し、UI側で警告する。

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { askClaudeVisionRecipe } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  let tmp = "";
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) {
      return Response.json({ error: "画像を選んでください。" }, { status: 400 });
    }
    if (file.size > 12 * 1024 * 1024) {
      return Response.json({ error: "画像が大きすぎます（12MBまで）。" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    // Vercelは /tmp のみ書き込み可。os.tmpdir() でローカルとも両対応。
    const dir = path.join(os.tmpdir(), "cooksync-recipe-photo");
    await fs.mkdir(dir, { recursive: true });
    const ext = file.type.includes("png") ? "png" : "jpg";
    tmp = path.join(dir, `${globalThis.crypto.randomUUID()}.${ext}`);
    await fs.writeFile(tmp, buf);

    const out = await askClaudeVisionRecipe<{
      recipe?: unknown;
      missing?: unknown;
      confidence?: unknown;
    }>(tmp);

    if (!out.recipe) {
      return Response.json(
        { error: "この写真からはレシピを読み取れませんでした。材料や手順が写るように撮り直してください。" },
        { status: 422 },
      );
    }
    return Response.json({
      recipe: out.recipe,
      missing: Array.isArray(out.missing) ? out.missing : [],
      confidence: typeof out.confidence === "string" ? out.confidence : undefined,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "読み取りに失敗しました" },
      { status: 500 },
    );
  } finally {
    if (tmp) await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
