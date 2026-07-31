// 写真（レシピ本のページ・SNSのスクショ・手書きメモ・料理写真）からレシピを起こす。
// **複数枚まとめて**渡せる。順番がバラバラでも、調理の進行から並べ直して手順にする。
//
// ⚠️ 動画取り込みと同じ方針：**写真に写っていない分量をAIに埋めさせない**。
//    読めなかった材料は missing、並べ替えた結果は photoOrder で返してUIに出す。

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { askClaudeVisionRecipe } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 1回に読ませる上限（多すぎるとAIが混乱し時間もかかる） */
const MAX_IMAGES = 8;

export async function POST(request: Request) {
  const tmps: string[] = [];
  try {
    const form = await request.formData();
    const files = form.getAll("image").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return Response.json({ error: "画像を選んでください。" }, { status: 400 });
    }
    if (files.length > MAX_IMAGES) {
      return Response.json(
        { error: `写真は一度に${MAX_IMAGES}枚までにしてください。` },
        { status: 400 },
      );
    }
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > 30 * 1024 * 1024) {
      return Response.json({ error: "画像の合計が大きすぎます（30MBまで）。" }, { status: 400 });
    }

    // Vercelは /tmp のみ書き込み可。os.tmpdir() でローカルとも両対応。
    const dir = path.join(os.tmpdir(), "cooksync-recipe-photo");
    await fs.mkdir(dir, { recursive: true });
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const ext = file.type.includes("png") ? "png" : "jpg";
      const tmp = path.join(dir, `${globalThis.crypto.randomUUID()}.${ext}`);
      await fs.writeFile(tmp, buf);
      tmps.push(tmp);
    }

    const out = await askClaudeVisionRecipe<{
      recipe?: unknown;
      missing?: unknown;
      confidence?: unknown;
      photoOrder?: unknown;
    }>(tmps);

    if (!out.recipe) {
      return Response.json(
        {
          error:
            "この写真からはレシピを読み取れませんでした。材料や手順が写るように撮り直してください。",
        },
        { status: 422 },
      );
    }
    return Response.json({
      recipe: out.recipe,
      missing: Array.isArray(out.missing) ? out.missing : [],
      confidence: typeof out.confidence === "string" ? out.confidence : undefined,
      // 並べ替えた結果（渡した画像の1始まりの番号）。UIで「この順と判断しました」と見せる。
      photoOrder: Array.isArray(out.photoOrder)
        ? out.photoOrder.filter((n): n is number => typeof n === "number")
        : [],
      photoCount: files.length,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "読み取りに失敗しました" },
      { status: 500 },
    );
  } finally {
    await Promise.all(tmps.map((t) => fs.rm(t, { force: true }).catch(() => {})));
  }
}
