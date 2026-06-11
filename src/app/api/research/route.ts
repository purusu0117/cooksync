import { after } from "next/server";
import { askClaudeRecipes } from "@/lib/ai";
import { sendPush } from "@/lib/pushServer";
import { redis } from "@/lib/kv";

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
  u?: string;
  shopMode?: "stock" | "buy"; // stock=在庫だけ / buy=買い物OK
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

// ジョブ保存：公開=Redis（インスタンス間で共有・必須）／ローカル=メモリ。
// 30分で失効。
const mem = new Map<string, Job>();
const JOB_TTL_SEC = 30 * 60;

async function setJob(id: string, job: Job) {
  if (redis) await redis.set(`job:${id}`, JSON.stringify(job), { ex: JOB_TTL_SEC });
  else mem.set(id, job);
}
async function getJob(id: string): Promise<Job | null> {
  if (redis) {
    const v = await redis.get<unknown>(`job:${id}`);
    if (!v) return null;
    return (typeof v === "string" ? JSON.parse(v) : v) as Job;
  }
  return mem.get(id) ?? null;
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
  const shopMode = b.shopMode === "buy" ? "buy" : "stock";
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
    shopMode === "stock"
      ? "■ 買い物方針: 【在庫だけで作る】上の冷蔵庫の食材だけで完結する献立にする。買い足しは基本調味料（塩・醤油・油等）のみ許可。それ以外の新規食材は使わない（toBuyは原則false）。"
      : "■ 買い物方針: 【買い物前提・必須】ユーザーは買い物に行く。各候補は“新しく食材を買って作る料理”にすること。冷蔵庫の在庫だけで作れてしまう料理は禁止（在庫で完結する案は出さない）。在庫の食材は過去に買った物で似た料理になりがちなので、在庫に寄せず、普段作らない新しい料理・新しいジャンルを積極的に出す。任意で“使い切りたい食材”を1品だけ1つ脇役で使ってよいが、その料理も主要な材料は必ず買い足し前提にする。各候補は必ず複数の toBuy:true 食材を含む。",
    avoid.length ? `■ 避ける（最近作った・既に提案済み）: ${avoid.join("、")}` : "",
    `■ 今回の切り口のヒント: ${angle}（縛りではなく方向性。ユーザー指定の条件は厳守）`,
    round > 1
      ? `■ 重要: これは${round}回目の再探索。前回までと“違うジャンル・調理法・味付け”の角度で、上の『避ける』に挙げた料理とは別物を必ず出す。似た料理の言い換えは禁止。`
      : "",
    "",
    "要件:",
    "- 2〜3品、方向性の違う候補を出す（例：王道/時短/さっぱり等）。",
    shopMode === "stock"
      ? "- 【最重要：食材の分散】候補ごとに“主役にする食材”を必ず変える。冷蔵庫の食材リストの順に割り当てる：1品目は1つ目の食材を主役、2品目は2つ目の食材を主役、3品目は組み合わせ or それ以外。3案が全部同じ食材になるのは禁止。すべて冷蔵庫内の食材で完結させる。"
      : "- 【新規性・必須】3案とも“買い物して作る新しい料理”にする。在庫の食材に寄せない（在庫だけで作れる料理は出さない）。3案は味・ジャンル・調理法を大きく変え、普段の在庫から離れた目新しいメニューにする。各候補で主役級の食材を新たに買う前提にする。",
    "- 実在のレシピを参照し、sources に つくれぽ数/再生数 等の人気の根拠(popularity)とURLを入れる。出典のない創作はしない。",
    shopMode === "stock"
      ? `- 材料は ${servings}人分。冷蔵庫にある食材は toBuy:false、基本調味料は basicSeasoning:true。冷蔵庫に無い新規食材は使わない（買い足し前提にしない）。`
      : `- 材料は ${servings}人分。各レシピは買い物が必要な食材(toBuy:true)を必ず複数含める（在庫＋基本調味料だけで完結する料理は不可）。塩こしょう等の基本調味料は basicSeasoning:true。`,
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

// POST: ジョブを開始して jobId を即返す。
// 実処理は after() で応答後に継続（Vercelでもレスポンス後に生かされる）。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ResearchBody;
    const prompt = buildPrompt(body);
    const uid = body.u || "anon";
    const jobId = globalThis.crypto.randomUUID();
    await setJob(jobId, { status: "running", createdAt: Date.now() });

    after(async () => {
      try {
        const recipes = await askClaudeRecipes(prompt);
        await setJob(jobId, { status: "done", recipes, createdAt: Date.now() });
        const names = recipes
          .map((r) => (r as { name?: string }).name)
          .filter(Boolean)
          .join(" / ");
        // 通知は任意（VAPID未設定なら失敗しても結果には影響させない）
        await sendPush(uid, {
          title: "🍳 レシピが見つかりました",
          body: names || "候補ができました。タップして確認",
          url: "/meal",
        }).catch(() => {});
      } catch (e) {
        await setJob(jobId, {
          status: "error",
          error: e instanceof Error ? e.message : "AI research failed",
          createdAt: Date.now(),
        });
      }
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
  const job = await getJob(jobId);
  if (!job) return Response.json({ status: "missing" });
  if (job.status === "done") {
    return Response.json({ status: "done", recipes: job.recipes ?? [] });
  }
  if (job.status === "error") {
    return Response.json({ status: "error", error: job.error });
  }
  return Response.json({ status: "running" });
}
