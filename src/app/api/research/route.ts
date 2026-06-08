import { askClaudeForJson } from "@/lib/ai";

// ローカルClaude Codeを起動するので動的・長め
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ResearchBody {
  wish?: string;
  fridge?: string[];
  expiring?: string[];
  filters?: {
    cuisine?: string;
    heaviness?: string;
    staple?: string;
    cookTime?: number;
  };
  avoid?: string[]; // 直近に作った料理名（連日回避）
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ResearchBody;
    const wish = (body.wish ?? "").trim();
    const fridge = body.fridge ?? [];
    const expiring = body.expiring ?? [];
    const filters = body.filters ?? {};
    const avoid = body.avoid ?? [];

    const prompt = [
      "あなたはプロの料理リサーチャーです。WebSearchツールで『実在し評価の高い人気レシピ』を1つ調べ、結果をJSONだけで返してください。",
      wish ? `■ 作りたいもの: ${wish}` : "■ 作りたいもの: おまかせ（下の冷蔵庫の食材を活かせるもの）",
      fridge.length ? `■ 冷蔵庫にある食材: ${fridge.join("、")}` : "",
      expiring.length ? `■ 特に使い切りたい（期限間近）: ${expiring.join("、")}` : "",
      filters.cuisine ? `■ ジャンル: ${filters.cuisine}` : "",
      filters.heaviness ? `■ 好み: ${filters.heaviness}` : "",
      filters.staple ? `■ 主食: ${filters.staple}` : "",
      filters.cookTime ? `■ 調理時間: ${filters.cookTime}分以内` : "",
      avoid.length ? `■ 避ける（最近作った）: ${avoid.join("、")}` : "",
      "",
      "要件:",
      "- 実在のレシピを参照し、sources に つくれぽ数/再生数 等の人気の根拠(popularity)とURLを入れる。出典のない創作はしない。",
      "- 材料は分量つき。家に無さそうな生鮮品は toBuy:true、塩こしょう等の基本調味料は basicSeasoning:true。",
      "- 手順(steps)は各ステップ本文(text)に分量も書き、tip（コツ）を添える。",
      "- 余った材料の保存(leftoverStorage)も書く。",
      "- 日本語で。emoji は料理に合う絵文字を1つ。",
      "",
      "次のJSON形式『だけ』を出力（前後に文章やコードフェンスを付けない）:",
      `{"name":string,"emoji":string,"catch":string,"servings":number,"kcal":number,"cookTime":number,"cuisine":"和"|"洋"|"中"|"アジアン","ingredients":[{"name":string,"amount":string,"group":string,"toBuy":boolean,"basicSeasoning":boolean}],"steps":[{"title":string,"text":string,"tip":string}],"leftoverStorage":[{"ingredient":string,"method":string}],"sources":[{"label":string,"url":string,"popularity":string}]}`,
    ]
      .filter(Boolean)
      .join("\n");

    const recipe = await askClaudeForJson(prompt);
    return Response.json({ recipe });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "AI research failed" },
      { status: 500 },
    );
  }
}
