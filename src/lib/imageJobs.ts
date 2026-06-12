// サーバー側の非同期「レシピ写真生成」ジョブ。
// 生成は30〜90秒かかり、スマホは画面ロック/アプリ切替で同期fetchが死ぬため、
// 送信は即jobIdを返し、生成はサーバーで走り続ける（チャットと同じパターン）。
//
// ⚠️ 保存先は public/ ではなく .data/recipe-images/。
// Next本番(next start)はビルド後に追加された public/ のファイルを静的配信せず、
// /recipes/[id] ページルートがHTMLを返してしまう（＝生成画像が次のビルドまで表示されない）。
// 配信は /api/recipe-img/<id> ルート経由で行う。

import { randomUUID } from "node:crypto";
import { promises as fs } from "fs";
import path from "path";
import { askClaudeImageUrl } from "./ai";
import { sendPush } from "./pushServer";

export type ImageJobStatus = "pending" | "done" | "error";
export interface ImageJob {
  status: ImageJobStatus;
  image?: string; // 完了時 "/recipes/<id>.png?v=…"
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, ImageJob>();
// 同じレシピへの多重生成防止（実行中のみ）：recipeId → jobId
const inFlightByRecipe = new Map<string, string>();

function gc() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, j] of jobs) if (j.createdAt < cutoff) jobs.delete(id);
}

export function startImageJob(recipeId: string, name: string, uid?: string): string {
  gc();
  // 同じレシピの生成が走っていたらそのジョブに相乗り（再タップ・自動+手動の重複を吸収）
  const existing = inFlightByRecipe.get(recipeId);
  if (existing && jobs.get(existing)?.status === "pending") return existing;

  const id = randomUUID();
  jobs.set(id, { status: "pending", createdAt: Date.now() });
  inFlightByRecipe.set(recipeId, id);

  (async () => {
    try {
      const url = await askClaudeImageUrl(name);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const dir = path.join(process.cwd(), ".data", "recipe-images");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${recipeId}.png`), buf);
      jobs.set(id, {
        status: "done",
        image: `/api/recipe-img/${recipeId}?v=${Date.now()}`,
        createdAt: Date.now(),
      });
      if (uid) {
        try {
          await sendPush(uid, {
            title: "CookSync",
            body: `「${name}」の写真ができました 🍳`,
            url: `/recipes/${recipeId}`,
          });
        } catch {}
      }
    } catch (e) {
      jobs.set(id, {
        status: "error",
        error: e instanceof Error ? e.message : "image generation failed",
        createdAt: Date.now(),
      });
    } finally {
      if (inFlightByRecipe.get(recipeId) === id) inFlightByRecipe.delete(recipeId);
    }
  })();

  return id;
}

export function getImageJob(id: string): ImageJob | undefined {
  return jobs.get(id);
}
