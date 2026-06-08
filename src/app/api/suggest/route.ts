import { askClaudeText } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface SuggestBody {
  menu?: { slot?: string; name?: string }[];
  fridge?: string[];
  expiring?: string[];
  recent?: string[];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SuggestBody;
    const menu = body.menu ?? [];
    const fridge = body.fridge ?? [];
    const expiring = body.expiring ?? [];
    const recent = body.recent ?? [];

    const menuLine = menu
      .map((m) => `${m.slot ?? ""}: ${m.name ?? ""}`)
      .join(" / ");

    const prompt = [
      "次の献立について、『なぜ今日これがおすすめか』を大翔さんに向けて、温かく前向きに2〜3文で。",
      `■ 今日の献立: ${menuLine || "（未選択）"}`,
      fridge.length ? `■ 冷蔵庫: ${fridge.join("、")}` : "",
      expiring.length ? `■ 期限が近い食材: ${expiring.join("、")}` : "",
      recent.length ? `■ 最近作った: ${recent.join("、")}` : "",
      "",
      "条件: 期限が近い食材を使えるなら触れる。最近作ったものと被らない良さがあれば触れる。誇張しすぎない。絵文字は0〜1個。日本語のプレーンテキストのみ。",
    ]
      .filter(Boolean)
      .join("\n");

    const text = await askClaudeText(prompt);
    return Response.json({ text });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "suggest failed" },
      { status: 500 },
    );
  }
}
