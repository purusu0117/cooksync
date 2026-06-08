import { askClaudeForJsonNoWeb } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

interface Step {
  title: string;
  text: string;
  tip?: string;
}
interface ProofreadBody {
  name?: string;
  steps?: Step[];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProofreadBody;
    const name = body.name ?? "";
    const steps = Array.isArray(body.steps) ? body.steps : [];
    if (steps.length === 0) {
      return Response.json({ error: "steps required" }, { status: 400 });
    }

    const prompt = [
      `次のレシピ「${name}」の手順を、意味を変えずに整える。`,
      "ルール：",
      "- 誤字脱字・不自然な日本語を直す。",
      "- 下準備（切る・下ごしらえ）を最初のステップにまとめ、調理開始後に新たな『切る』作業を出さない。",
      "- 各ステップ本文に使う材料の分量を残す（材料欄を見返さず作れるように）。",
      "- 各ステップに tip（コツ・火加減・見極め）を付ける。",
      "- 工程数は元と大きく変えず、読みやすく簡潔に。",
      "",
      "対象の手順(JSON):",
      JSON.stringify(steps),
      "",
      '次のJSON『だけ』を出力：{"steps":[{"title":string,"text":string,"tip":string}]}',
    ].join("\n");

    const data = await askClaudeForJsonNoWeb<{ steps?: Step[] }>(prompt);
    const out = Array.isArray(data.steps) ? data.steps : [];
    return Response.json({ steps: out });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "proofread failed" },
      { status: 500 },
    );
  }
}
