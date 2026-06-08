// 個人ローカルアプリのデータ保存先＝PC上の単一JSONファイル（.data/store.json）。
// PCもスマホも（Tailscale経由で）このPCのサーバーを読み書きするので、端末間で同期される。
// 認証はTailnet（Tailscale）を安全境界とする＝アプリ内認証は付けない簡易構成。

import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "store.json");

async function readAll(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

export async function GET() {
  return Response.json(await readAll());
}

export async function PUT(request: Request) {
  try {
    const { key, value } = (await request.json()) as {
      key?: string;
      value?: unknown;
    };
    if (typeof key !== "string") {
      return Response.json({ error: "key required" }, { status: 400 });
    }
    await fs.mkdir(DIR, { recursive: true });
    const all = await readAll();
    all[key] = value;
    await fs.writeFile(FILE, JSON.stringify(all), "utf8");
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 },
    );
  }
}
