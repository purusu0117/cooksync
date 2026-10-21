import { requireAiScope, withAiRequest } from "@/lib/kitchen/managedAi";
// 写真（レシピ本のページ・SNSのスクショ・手書きメモ・料理写真）からレシピを起こす。
// **複数枚まとめて**渡せる。順番がバラバラでも、調理の進行から並べ直して手順にする。
//
// ⚠️ 動画取り込みと同じ方針：**写真に写っていない分量をAIに埋めさせない**。
//    読めなかった材料は missing、並べ替えた結果は photoOrder で返してUIに出す。

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { askClaudeVisionRecipe } from "@/lib/ai";
import { consume, quotaResponse, refund } from "@/lib/quotaServer";

import { normalizePhoto, validateImportedRecipe } from "@/lib/kitchen/importValidation";
import { KitchenError } from "@/lib/kitchen/engine";
import { photoUploadError } from "@/lib/kitchen/limits";
import { validateVideoManifest, type VideoManifest } from "@/lib/kitchen/videoFrames";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 1回に読ませる上限。
 *  多すぎるとAIが混乱し時間もかかる＋原価が枚数に比例して伸びる
 *  （高解像度画像は1枚あたり最大4,784トークン＝8枚で1回¥22、4枚なら¥13）。 */
const MAX_IMAGES = 4;

async function handlePost(request: Request) {
  const tmps: string[] = [];
  const uid = requireAiScope().owner;
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
    const uploadError = photoUploadError(files);
    if (uploadError) return Response.json({ error: uploadError }, { status: 413 });
    let video: VideoManifest | undefined;
    if (form.has("videoManifest")) {
      try {
        const raw = form.get("videoManifest");
        if (typeof raw !== "string" || raw.length > 2048) throw new Error("動画情報が不正です");
        video = validateVideoManifest(JSON.parse(raw), files.length);
      } catch { return Response.json({ error: "動画の時刻・コマ数を確認できません。動画を選び直してください。" }, { status: 400 }); }
    }

    const images = await Promise.all(files.map(normalizePhoto));
    // AIを呼ぶ前に枠を確認する（サーバー側が唯一の判定者）
    const q = await consume(uid, "import", request);
    if (!q.ok) return quotaResponse(q, "import");

    // Vercelは /tmp のみ書き込み可。os.tmpdir() でローカルとも両対応。
    const dir = path.join(os.tmpdir(), "cooksync-recipe-photo");
    await fs.mkdir(dir, { recursive: true });
    for (const image of images) {
      const tmp = path.join(dir, `${globalThis.crypto.randomUUID()}.jpg`);
      await fs.writeFile(tmp, image.bytes);
      tmps.push(tmp);
    }

    let out: {
      recipe?: unknown;
      missing?: unknown;
      confidence?: unknown;
      photoOrder?: unknown;
    };
    try {
      out = await askClaudeVisionRecipe(tmps, video);
    } catch (e) {
      await refund(uid, "import", request).catch(() => {}); // 失敗したら枠を戻す
      throw e;
    }

    if (!out.recipe) {
      // 読み取れなかったのは実質失敗なので枠を戻す
      await refund(uid, "import", request).catch(() => {});
      return Response.json(
        {
          error:
            "この写真からはレシピを読み取れませんでした。材料や手順が写るように撮り直してください。",
        },
        { status: 422 },
      );
    }
    const checked = validateImportedRecipe(out.recipe, true);
    return Response.json({
      recipe: checked.recipe,
      evidence: { kind: video ? "video" : "photo", obtained: [video ? "uploaded-video-frames" : "uploaded-images"], ...(video ? { video, metadataTrust: "client-reported", unavailable: ["audio", "subtitles", "unsampled-video"] } : {}), images: images.map(i => i.evidence), capturedAt: new Date().toISOString(), missing: checked.missing },
      missing: [...checked.missing, ...(Array.isArray(out.missing) ? out.missing.filter(v => typeof v === "string") : [])],
      confidence: typeof out.confidence === "string" ? out.confidence : undefined,
      // 並べ替えた結果（渡した画像の1始まりの番号）。UIで「この順と判断しました」と見せる。
      photoOrder: Array.isArray(out.photoOrder)
        ? [...new Set(out.photoOrder.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= files.length))]
        : [],
      photoCount: video ? undefined : files.length,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof KitchenError ? e.message : "読み取りを完了できませんでした" },
      { status: e instanceof KitchenError ? e.status : 500 },
    );
  } finally {
    await Promise.all(tmps.map((t) => fs.rm(t, { force: true }).catch(() => {})));
  }
}

export const POST = withAiRequest(handlePost);
