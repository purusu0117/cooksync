import { withAiRequest, requireActiveAiJob } from "@/lib/kitchen/managedAi";
import { managedAfter as after } from "@/lib/kitchen/managedAi";
import { askClaudeRecipes } from "@/lib/ai";
import { sendPush, resolvePushTarget } from "@/lib/pushServer";
import { redis } from "@/lib/kv";
import { checkIpOnly, consume, quotaResponse, refund } from "@/lib/quotaServer";

import { addToPool, takeFromPool } from "@/lib/recipeCache";
import { requireAiScope } from "@/lib/kitchen/managedAi";
import { validateImportedRecipe } from "@/lib/kitchen/importValidation";
import { aiFailureMessage } from "@/lib/kitchen/aiFailure";

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
  existing?: string[]; // ユーザーが既に持っているレシピ名（同じ料理は提案させない）
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
  const servings = b.servings && b.servings > 0 ? b.servings : undefined;
  const filters = b.filters ?? {};
  const avoid = b.avoid ?? [];
  const existing = b.existing ?? [];
  const round = b.round && b.round > 0 ? b.round : 1;
  const angle = ANGLES[(round - 1) % ANGLES.length];
  const shopMode = b.shopMode === "buy" ? "buy" : "stock";
  return [
    "あなたはプロの料理リサーチャーです。WebSearchツールで『実在し評価の高い人気レシピ』を2〜3品調べ、結果をJSONだけで返してください。",
    wish ? `■ 作りたいもの: ${wish}` : "■ 作りたいもの: おまかせ（下の冷蔵庫の食材を活かせるもの）",
    servings ? `■ 人数: ${servings}人分（材料の分量はこの人数に合わせる）` : "■ 人数未指定：参照レシピに明示された人数と分量を保持し、不明なら人数を補完しない。",
    fridge.length ? `■ 冷蔵庫にある食材: ${fridge.join("、")}` : "",
    expiring.length ? `■ 特に使い切りたい（期限間近）: ${expiring.join("、")}` : "",
    filters.cuisine ? `■ ジャンル: ${filters.cuisine}` : "",
    filters.heaviness ? `■ 好み: ${filters.heaviness}` : "",
    filters.staple ? `■ 主食: ${filters.staple}` : "",
    filters.cookTime ? `■ 調理時間: ${filters.cookTime}分以内` : "",
    shopMode === "stock"
      ? "■ 買い物方針: 【在庫だけで作る】上の冷蔵庫の食材だけで完結する献立にする。買い足しは基本調味料（塩・醤油・油等）のみ許可。それ以外の新規食材は使わない（toBuyは原則false）。"
      : "■ 買い物方針: 不足分の購入は可能だが必須ではない。現在の在庫・作り置きを優先し、在庫だけで作れる候補も認める。購入できる時刻が調理より後なら今使える材料として扱わない。必要量と不足量の確定はアプリの計算に任せる。",
    avoid.length ? `■ 避ける（直近2日に作った・既に提案済み）: ${avoid.join("、")}` : "",
    existing.length
      ? `■ 【重複禁止】ユーザーは既に次のレシピを持っている。同じ料理・言い換え（「風」「簡単」等を足しただけ・主材料と味付けが同じ）は絶対に提案しない: ${existing.join("、")}`
      : "",
    `■ 今回の切り口のヒント: ${angle}（縛りではなく方向性。ユーザー指定の条件は厳守）`,
    round > 1
      ? `■ 重要: これは${round}回目の再探索。前回までと“違うジャンル・調理法・味付け”の角度で、上の『避ける』に挙げた料理とは別物を必ず出す。似た料理の言い換えは禁止。`
      : "",
    "",
    "要件:",
    "- 作り置き（stockのkind:prepared）を使う材料にはinventoryKind:preparedを付け、生の材料はinventoryKind:rawとする。完成品を消費し元材料を二重計上しない。出典の人気数は実際に確認できた場合だけ記載し、不明なら数字を作らない。",
    // systemプロンプト側でも強制しているが、こちらにも明記する（二重の保険。
    // Web検索で英語ソースを参照すると、出力まで英語に引きずられた実害がある）
    "- 【言語】出力JSONの文字列値（name/catch/steps/tip/label/leftoverStorage等）はすべて自然な日本語で書く。英語のサイトを参照した場合も必ず日本語に直す。",
    "- 2〜3品、方向性の違う候補を出す（例：王道/時短/さっぱり等）。",
    // 出力上限（8,192トークン）に当たると候補が1品しか残らない（2026-10-21 実測）。
    // 候補の比較ができるよう、1品あたりの文章量をここで固定する。
    "- 【出力量の上限＝厳守】全体を短く保つ。1品あたり steps は8工程以内、各 text は70字以内、tip は30字以内（不要なら空文字）。catch は30字以内。sources は1品あたり2件以内。長い前置き・補足説明・余った材料の保存方法は書かない。",
    shopMode === "stock"
      ? "- 利用可能な在庫で作れる候補を比較する。使い切りたい食材を優先しつつ、味付け・主食・たんぱく源の偏りを考慮する。"
      : "- 保存済みの好評レシピと新候補を比較し、毎回の新作や買い足しを強制しない。作り置きの再利用は完成品を材料として記載し、元の原材料をもう一度必要材料へ展開しない。",
    // sources は「あれば入れる」ではなく必須。ここが空だと詳細画面の参考リンク欄ごと消えてしまい、
    // 何を参考にしたのか分からないレシピになる（大翔の指摘・2026-07-31）。
    // 動画の「字幕」は取れなくなったが、**Web検索でSNSのレシピを見つけて出典にすること自体は
    // 今も普通にできる**。レシピサイトだけに偏らないよう、SNSも明示的に挙げさせる。
    "- 【sourcesは必須】実在のレシピを必ずWeb検索で参照し、sources に **最低1件、できれば2件** 入れる。label（サイト名＋レシピ名）・url（実在するURL）・popularity（つくれぽ数/再生数などの人気の根拠）をセットで書く。出典のない創作は禁止。sourcesが空の候補は出力しないこと。",
    "- sources は **レシピサイトとSNSの両方**から探す。クックパッド/白ごはん.com/つくおき/Nadia/デリッシュキッチン等に加えて、**YouTube（リュウジのバズレシピ、きょうの料理、料理系チャンネル）・TikTok・Instagram** の人気レシピも積極的に候補にする。再生数・いいね数が多いものは popularity にその数字を書く。",
    shopMode === "stock"
      ? `- ${servings ? `材料は${servings}人分。` : "人数未指定。出典で人数を確認できなければnull。"}在庫のない材料を使わない。調味料も在庫不明なら十分とは断定しない。`
      : `- ${servings ? `材料は${servings}人分。` : "人数未指定。出典で人数を確認できなければnull。"}toBuyは参考情報であり在庫充足の確定ではない。買い足し不要の候補も出せる。`,
    "- 廃止・訂正済みルールを復活させない。好みの個人設定を一般的な基準としない。保存期限・加熱条件は出典と食品・保存条件がなければ不明とする。元資料にない人数・分量・調理時間・栄養量はnullまたは確認できずとし、創作しない。",
    "",
    "【手順(steps)の構成ルール＝最重要】",
    "- stepsの最初は必ず『下準備』ステップにする。材料の切り方・下処理（例：にんにく2かけは薄切り、玉ねぎは1/2個を薄切り、鶏肉は厚みを開く）を“すべてここで”済ませる。",
    "- stepsは実際に作る順番どおりに並べる。調理を始めた後に新しい『切る・下ごしらえ』作業が出ないようにする。途中で初めて登場する材料も、その下処理は必ず先頭の下準備に前倒しして書く。",
    "- 各stepのtextには、その工程で使う材料の分量と切り方を必ず明記する（材料欄を見返さなくても作れるように）。",
    "- 下処理は具体的に（にんにくは『根元を切る→薄切り』等）。「適量」を多用しない。",
    // 調理中はチェックを付けながら1行ずつ進むので、1文に2つ以上の作業を詰めない。
    // ここを守らせないと、クライアント側の分割に頼ることになり精度が落ちる。
    "- 【1文＝1作業】textの中で作業を詰め込まない。動作が変わったら必ず文を切る。とくに『〜たら』（煮立ったら/色が変わったら等の“待ち”）は必ず独立した文にする。",
    "  悪い例:『調味料を入れて煮立ったら弱火で10分煮る。』／良い例:『調味料を入れる。煮立ったら弱火で10分煮る。』",
    "- 火加減・見極めが要る工程だけ tip（30字以内）を付ける。emojiは料理に合う絵文字を1つ。",
    "",
    "次のJSON『だけ』を出力（前後に文章やコードフェンスを付けない）:",
    '{"recipes":[{"name":string,"emoji":string,"catch":string,"servings":number|null,"kcal":number|null,"cookTime":number|null,"cuisine":"和"|"洋"|"中"|"アジアン","ingredients":[{"name":string,"amount":string,"group":string,"toBuy":boolean,"basicSeasoning":boolean,"inventoryKind":"raw"|"prepared"}],"steps":[{"title":string,"text":string,"tip":string}],"sources":[{"label":string,"url":string,"popularity":string}]}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

// POST: ジョブを開始して jobId を即返す。
// 実処理は after() で応答後に継続（Vercelでもレスポンス後に生かされる）。
async function handlePost(request: Request) {
  try {
    const body = (await request.json()) as ResearchBody;
    const scope = requireAiScope();
    const privateQuery = { ...body, privateScope: `${scope.owner}:${scope.locationId}` };
    // 枠を数える uid：セッションCookieがあればそれを正とする（クライアントの `u` は
    // 書き換え可能なので信用しない）。Cookieが無い既存ユーザーは `u` にフォールバック。
    const uid = requireAiScope().owner;
    // プッシュ通知の宛先。購読はクライアントのuid(getUid())で登録されているので枠のuidとは別だが、
    // ⚠️ **`body.u` をそのまま信じてはいけない**（2026-08-01 の監査 高-7）。
    //    他人の dataId を名乗れば、その人の端末に任意の文言（レシピ名はクエリで操作できる）を
    //    鳴らせてしまう。他のpush経路は既に resolvePushTarget を通しているのに、ここだけ漏れていた。
    const pushTarget = await resolvePushTarget(request, body.u);
    const pushUid = pushTarget?.uid ?? null;

    // ── ① まず共有プールを引く（AI原価0）────────────────────────────
    // 同じ条件のレシピを誰かが既に生成していれば、APIを叩かずに返せる。
    // 原価が出ない以上、月間枠は消費させない（連打だけIP上限で止める）。
    const hit = await takeFromPool(privateQuery);
    if (hit) {
      if (!(await checkIpOnly(request))) {
        return Response.json(
          { error: "この回線からのAI利用が今日の上限に達しました。" },
          { status: 429 },
        );
      }
      const jobId = globalThis.crypto.randomUUID();
      await setJob(jobId, {
        status: "done",
        recipes: hit.recipes,
        createdAt: Date.now(),
      });
      return Response.json({ jobId, cached: true });
    }

    // ── ② プールに無い＝生成する。ここで初めて枠を消費する ──────────
    const q = await consume(uid, "research", request);
    if (!q.ok) return quotaResponse(q, "research");

    const prompt = buildPrompt(body);
    const jobId = globalThis.crypto.randomUUID();
    await setJob(jobId, { status: "running", createdAt: Date.now() });

    after(async () => {
      try {
        await requireActiveAiJob();
        const recipes = (await askClaudeRecipes(prompt)).flatMap(value => {
          try {
            const checked = validateImportedRecipe(value, true);
            const notices = value && typeof value === "object" && "readMissing" in value && Array.isArray(value.readMissing)
              ? value.readMissing.filter((v): v is string => typeof v === "string").slice(0, 20).map(v => v.slice(0, 300)) : [];
            return [{ ...checked.recipe, readMissing: [...new Set([...notices, ...checked.missing])] }];
          }
          catch { return []; }
        });
        // askClaudeRecipes は**例外を投げず空配列を返す**（max_tokens打ち切り・
        // refusal・pause_turn上限などで、救出できるレシピが1件も無かったとき）。
        // これを done にすると catch が走らず refund もされないので、
        // 「レシピが取得できませんでした」と出たのに月8回の枠だけ1つ減る。
        // 0件は成功ではないので、error 扱いにして枠を戻す。
        if (recipes.length === 0) {
          await refund(uid, "research", request).catch(() => {});
          await setJob(jobId, {
            status: "error",
            error: "レシピが取得できませんでした。もう一度お試しください。",
            createdAt: Date.now(),
          });
          return;
        }
        await requireActiveAiJob();
        await setJob(jobId, { status: "done", recipes, createdAt: Date.now() });
        // 次に同じ条件で探す人のためにプールへ貯める（原価が下がっていく）
        await addToPool(privateQuery, recipes).catch(() => {});
        const names = recipes
          .map((r) => (r as { name?: string }).name)
          .filter(Boolean)
          .join(" / ");
        // 通知は任意（VAPID未設定なら失敗しても結果には影響させない）
        await requireActiveAiJob();
        if (pushUid) await sendPush(pushUid, {
          title: "🍳 レシピが見つかりました",
          body: names || "候補ができました。タップして確認",
          url: "/meal",
        }).catch(() => {});
      } catch (e) {
        // 生成に失敗したのに枠だけ減るのは理不尽なので戻す
        await refund(uid, "research", request).catch(() => {});
        await setJob(jobId, {
          status: "error",
          error: aiFailureMessage(e),
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

// maxDuration(300秒)を超えると after() はプラットフォームに殺され、catch も走らない。
// ＝ジョブは status:"running" のまま Redis のTTL(30分)まで残る。クライアントは
// running を見て延々ポーリングを続けてしまうので、実時間で打ち切って error を返す。
const STUCK_MS = 6 * 60 * 1000;

// GET ?jobId=... : ジョブの状態/結果を返す
async function handleGet(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });
  const job = await getJob(jobId);
  if (!job) return Response.json({ status: "missing" });
  if (job.status === "running" && Date.now() - job.createdAt > STUCK_MS) {
    return Response.json({
      status: "error",
      error: "時間内にレシピを取得できませんでした。もう一度お試しください。",
    });
  }
  if (job.status === "done") {
    return Response.json({ status: "done", recipes: job.recipes ?? [] });
  }
  if (job.status === "error") {
    return Response.json({ status: "error", error: job.error });
  }
  return Response.json({ status: "running" });
}

export const POST = withAiRequest(handlePost);
export const GET = withAiRequest(handleGet, true);
