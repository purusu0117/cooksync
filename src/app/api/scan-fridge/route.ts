import { promises as fs } from "fs";
import path from "path";
import { askClaudeVisionItems } from "@/lib/ai";

// 冷蔵庫の写真 → AIが食材名を抽出。期限・カテゴリはクライアント側で推定する。
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  let tmp = "";
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) {
      return Response.json({ error: "image required" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const dir = path.join(process.cwd(), ".data", "tmp");
    await fs.mkdir(dir, { recursive: true });
    const ext = file.type.includes("png") ? "png" : "jpg";
    tmp = path.join(dir, `${globalThis.crypto.randomUUID()}.${ext}`);
    await fs.writeFile(tmp, buf);

    const items = await askClaudeVisionItems(tmp);
    return Response.json({ items });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "scan failed" },
      { status: 500 },
    );
  } finally {
    if (tmp) await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
