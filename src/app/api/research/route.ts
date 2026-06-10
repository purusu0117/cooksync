import { askClaudeRecipes } from "@/lib/ai";
import { sendPush } from "@/lib/pushServer";

// ローカルClaude Codeを起動するので動的・長め
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ResearchBody {
  wish?: string;
  fridge?: string[];
  expiring?: string[];
  servings?: number;
  filters?: {
    cuisine?: string;
    heaviness?: string;
    staple?: string;
    cookTime?: number;
  };
  avoid?: string[];
  round?: number;
}

// 再探索ごとに切り口を変えるためのヒント（縛りではなく方向性）
const ANGLES = [
  "王道・定番でハズさないもの",
  "時短・簡単（フライパン1つ/15分前後）",
  "さっぱり・ヘルシー（野菜多め/油控えめ）",
  "がっつり・こってり（食べ応え重視）",
  "エスニック・変わり種（普段選ばない角度）",
  "和×洋など意外な組み合わせ・アレンジ",
];

interface Job {
  status: "running" | "done" | "error";
  recipes?: unknown[];
  error?: string;
  createdAt: number;
}

// ジョブはサーバー(PC)プロセス内に保持。スマホがアプリを離れても処理は継続し、
// 戻ってきた時にGETで結果を取得できる（バックグラウンド継続）。
const jobs = new Map<string, Job>();

function prune() {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.createdAt > 30 * 60_000) jobs.delete(id);
  }
}

function buildPrompt(b: ResearchBody): string {
  const wish = (b.wish ?? "").trim();
  const fridge = b.fridge ?? [];
  const expiring = b.expiring ?? [];
  const servings = b.servings && b.servings > 0 ? b.servings : 2;
  const filters = b.filters ?? {};
  const avoid = b.avoid ?? [];
  const round = b.round && b.round > 0 ? b.round : 1;
  const angle = ANGLES[(round - 1) % ANGLES.length];
  return [
    "あなたはプロの料理リサーチャーです。WebSearchツールで『実在し評価の高い人気レシピ』を2〜3品調べ、結果をJSONだけで返してください。",
    wish ? `■ 作りたいもの: ${wish}` : "■ 作りたいもの: おまかせ（下の冷蔵庫の食材を活かせるもの）",
    `■ 人数: ${servings}人分（材料の分量はこの人数に合わせる）`,
    fridge.length ? `■ 冷蔵庫にある食材: ${fridge.join("、")}` : "",
    expiring.length ? `■ 特に使い切りたい（期限間近）: ${expiring.join("、")}` : "",
    filters.cuisine ? `■ ジャンル: ${filters.cuisine}` : "",
    filters.heaviness ? `■ 好み: ${filters.heaviness}` : "",
    filters.staple ? `■ 主食: ${filters.staple}` : "",
    filters.cookTime ? `■ 調理時間: ${filters.cookTime}分以内` : "",
    avoid.length ? `■ 避ける（最近作った・既に提案済み）: ${avoid.join("、")}` : "",
    `■ 今回の切り口のヒント: ${angle}（縛りではなく方向性。ユーザー指定の条件は厳守）`,
    round > 1
      ? `■ 重要: これは${round}回目の再探索。前回までと“違うジャンル・調理法・味付け”の角度で、上の『避ける』に挙げた料理とは別物を必ず出す。似た料理の言い換えは禁止。`
      : "",
    "",
    "要件:",
    "- 2〜3品、方向性の違う候補を出す（例：王道/時短/さっぱり等）。",
    "- 【最重要：食材の分散】候補ごとに“主役にする食材”を必ず変える。冷蔵庫の食材リストの順に割り当てる：1品目は1つ目の食材を主役（他の冷蔵庫食材は使わなくてよい）、2品目は2つ目の食材を主役（1つ目は使わない/脇役）、3品目は両方を組み合わせる or それ以外の路線。3案が全部同じ食材（例：全部『肉＋玉ねぎ』）になるのは禁止。最低でも1品は、ある食材を使わずに別の食材を主役にすること。",
    "- 実在のレシピを参照し、sources に つくれぽ数/再生数 等の人気の根拠(popularity)とURLを入れる。出典のない創作はしない。",
    `- 材料は ${servings}人分の分量。家に無さそうな生鮮品は toBuy:true、塩こしょう等の基本調味料は basicSeasoning:true。`,
    "",
    "【手順(steps)の構成ルール＝最重要】",
    "- stepsの最初は必ず『下準備』ステップにする。材料の切り方・下処理（例：にんにく2かけは薄切り、玉ねぎは1/2個を薄切り、鶏肉は厚みを開く）を“すべてここで”済ませる。",
    "- stepsは実際に作る順番どおりに並べる。調理を始めた後に新しい『切る・下ごしらえ』作業が出ないようにする。途中で初めて登場する材料も、その下処理は必ず先頭の下準備に前倒しして書く。",
    "- 各stepのtextには、その工程で使う材料の分量と切り方を必ず明記する（材料欄を見返さなくても作れるように）。",
    "- 下処理は具体的に（にんにくは『根元を切る→薄切り』等）。「適量」を多用しない。",
    "- 各stepにtip（コツ・火加減・見極め）を付ける。",
    "- 余った材料の保存(leftoverStorage)も書く。日本語で。emojiは料理に合う絵文字を1つ。",
    "",
    "次のJSON『だけ』を出力（前後に文章やコードフェンスを付けない）:",
    `{"recipes":[{"name":string,"emoji":string,"catch":string,"servings":${servings},"kcal":number,"cookTime":number,"cuisine":"和"|"洋"|"中"|"アジアン","ingredients":[{"name":string,"amount":string,"group":string,"toBuy":boolean,"basicSeasoning":boolean}],"steps":[{"title":string,"text":string,"tip":string}],"leftoverStorage":[{"ingredient":string,"method":string}],"sources":[{"label":string,"url":string,"popularity":string}]}]}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// POST: ジョブを開始して jobId を即返す（処理はサーバーで継続）
export async function POST(request: Request) {
  try {
    prune();
    const body = (await request.json()) as ResearchBody;
    const prompt = buildPrompt(body);
    const jobId = globalThis.crypto.randomUUID();
    jobs.set(jobId, { status: "running", createdAt: Date.now() });

    // 非同期で実行（await しない＝即レスポンス、スマホが離れても継続）
    void askClaudeRecipes(prompt)
      .then((recipes) => {
        jobs.set(jobId, { status: "done", recipes, createdAt: Date.now() });
        // アプリを離れていても通知（Web Push）
        const names = recipes
          .map((r) => (r as { name?: string }).name)
          .filter(Boolean)
          .join(" / ");
        void sendPush({
          title: "🍳 レシピが見つかりました",
          body: names || "候補ができました。タップして確認",
          url: "/meal",
        });
      })
      .catch((e) => {
        jobs.set(jobId, {
          status: "error",
          error: e instanceof Error ? e.message : "AI research failed",
          createdAt: Date.now(),
        });
      });

    return Response.json({ jobId });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "failed to start" },
      { status: 500 },
    );
  }
}

// GET ?jobId=... : ジョブの状態/結果を返す
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });
  const job = jobs.get(jobId);
  if (!job) return Response.json({ status: "missing" });
  if (job.status === "done") {
    return Response.json({ status: "done", recipes: job.recipes ?? [] });
  }
  if (job.status === "error") {
    return Response.json({ status: "error", error: job.error });
  }
  return Response.json({ status: "running" });
}
