import { promises as fs } from "fs";
import path from "path";
import { askClaudeImageUrl } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  id?: string;
  name?: string;
}

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

    // HiggsField(MCP)で生成 → 画像URL
    const url = await askClaudeImageUrl(name);

    // public/recipes/<id>.png にダウンロード（ローカル配信で永続化）
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = path.join(process.cwd(), "public", "recipes");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${safeId}.png`), buf);
    // ?v= でキャッシュバスト：再生成時に同じファイル名でもブラウザが必ず読み直す
    const rel = `/recipes/${safeId}.png?v=${Date.now()}`;

    return Response.json({ image: rel });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "image generation failed" },
      { status: 500 },
    );
  }
}
