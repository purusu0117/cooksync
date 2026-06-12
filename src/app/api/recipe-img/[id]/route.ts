import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// 生成画像の配信ルート。
// Next本番はビルド後に public/ に追加されたファイルを静的配信しないため、
// 実行時生成の画像は .data/recipe-images/ に置き、ここから返す
// （旧URL互換のため public/recipes/ もフォールバックで読む）。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const safeId = id.replace(/\.png$/i, "").replace(/[^a-z0-9-]/gi, "");
  if (!safeId) return new Response("bad id", { status: 400 });

  const candidates = [
    path.join(process.cwd(), ".data", "recipe-images", `${safeId}.png`),
    path.join(process.cwd(), "public", "recipes", `${safeId}.png`),
  ];
  for (const file of candidates) {
    try {
      const buf = await fs.readFile(file);
      return new Response(new Uint8Array(buf), {
        headers: {
          "content-type": "image/png",
          // URLは ?v= でキャッシュバストするので長期キャッシュでよい
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      /* 次の候補へ */
    }
  }
  return new Response("not found", { status: 404 });
}
