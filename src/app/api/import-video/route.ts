// YouTube / TikTok のURLからレシピを起こす。
//
// **取り方は素のHTTPだけ**（src/lib/videoMeta.ts）。以前は yt-dlp を uvx でサブプロセス起動して
// いたが、Vercelでは起動できず公開環境では機能ごと隠すことになっていた。
// 開発者のPCをワーカーにする案も出たが、配信するアプリの可用性を私物環境に依存させるのは論外。
// 素のfetchで取れる範囲に作り直し、ローカルも本番も**同じ経路**にした。
//
//  - 概要欄(description)：料理系の投稿者は材料と分量をここに全部書いていることが多い＝一番正確
//  - 字幕：**取れなくなった**（timedtextは0バイトで返る）。取れない前提で組む。
//
// ⚠️ 方針：取れた情報だけでレシピにする。**分からない分量をAIの一般知識で埋めない**。
//    概要欄が取れなかったときは、タイトルと投稿者からAIにWeb検索させて出典を明示させる。

import { after } from "next/server";
import { askClaudeForJson } from "@/lib/ai";
import { fetchVideoMeta, isSupportedVideoUrl, type VideoMeta } from "@/lib/videoMeta";
import { redis } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Job {
  status: "running" | "done" | "error";
  step?: string;
  recipe?: unknown;
  source?: { title: string; channel: string; url: string };
  error?: string;
  createdAt: number;
}

const mem = new Map<string, Job>();
const JOB_TTL_SEC = 30 * 60;

async function setJob(id: string, job: Job) {
  if (redis) await redis.set(`vjob:${id}`, JSON.stringify(job), { ex: JOB_TTL_SEC });
  else mem.set(id, job);
}
async function getJob(id: string): Promise<Job | null> {
  if (redis) {
    const v = await redis.get<unknown>(`vjob:${id}`);
    if (!v) return null;
    return (typeof v === "string" ? JSON.parse(v) : v) as Job;
  }
  return mem.get(id) ?? null;
}

/** 内部のエラー文言を、何をすればいいか分かる日本語にする */
function friendlyError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("timeout") || m.includes("aborted")) {
    return "動画の情報を取りに行って時間切れになりました。もう一度お試しください。";
  }
  if (m.includes("quota") || m.includes("上限")) return raw;
  if (m.includes("json") || m.includes("parse")) {
    return "AIの応答を読み取れませんでした。もう一度お試しください。";
  }
  return "レシピの取り込みに失敗しました。別の動画URLでお試しください。";
}

function buildPrompt(info: VideoMeta): string {
  const hasDesc = info.description.trim().length > 0;
  return [
    "あなたは料理動画を家庭用レシピに書き起こすアシスタントです。次の動画の情報から、レシピをJSONで作ってください。",
    "",
    `■ 動画タイトル: ${info.title || "（取得できず）"}`,
    `■ 投稿者: ${info.channel || "（取得できず）"}`,
    `■ 動画URL: ${info.webpageUrl}`,
    "",
    "■ 概要欄（投稿者本人が書いた説明。材料と分量が書かれていることが多く、最も信頼できる）:",
    hasDesc ? info.description.slice(0, 6000) : "（取得できませんでした）",
    "",
    // 字幕は YouTube 側で塞がれて取れなくなった。取れない前提で、
    // 足りない分は「憶測」ではなく「Web検索で出典を見つける」方向に倒す。
    "■ 字幕: 取得できません（動画配信側の仕様変更のため）。音声の内容は分かりません。",
    "",
    "【厳守】",
    "- **書かれていないことを推測で埋めない。** 分量が分からない材料は amount を「動画で明示なし」にする。",
    "  （それらしい数字を勝手に入れるのは禁止。あとで作る人が失敗する）",
    "- 概要欄に公式レシピページのURL（バズレシピ.com、クックパッド、ブログ等）があれば web_fetch で開き、",
    "  そこに書かれた正確な材料・分量・手順を最優先で使う。",
    hasDesc
      ? "- 概要欄に材料と分量が書かれていれば、それをそのまま使う（勝手に足し引きしない）。"
      : // 概要欄が取れなかったときが一番危ない。ここで一般知識に頼らせない。
        "- **概要欄が取れていない。** タイトルと投稿者名で web_search を行い、その投稿者の公式レシピページ（ブログ・クックパッド等）を探して、そこに書かれた材料・分量・手順を使うこと。見つからなければ、無理にレシピを作らず ingredients と steps を空にして confidence を low にする。一般知識で作った“それらしいレシピ”を返すのは禁止。",
    "- 手順が読み取れない場合は、無理に工程を作らず steps を短くしてよい。",
    "- **1文＝1作業**。動作が変わったら文を切る。とくに『〜たら』（煮立ったら等の“待ち”）は独立した文にする。",
    "- sources には必ず動画URLと投稿者名を入れる。参照した公式ページがあればそれも追加する。",
    "- 分量が読み取れなかった材料名を missing 配列に列挙する（UIで注意表示するため）。",
    "- confidence は high / medium / low。概要欄に材料と分量が揃っていれば high、検索で見つけた出典なら medium、根拠が薄ければ low。",
    "",
    "出力は次のJSONだけ（前後に文章やコードフェンスを付けない）:",
    '{"recipe":{"name":string,"emoji":string,"catch":string,"servings":number,"kcal":number,"cookTime":number,"cuisine":"和"|"洋"|"中"|"アジアン","ingredients":[{"name":string,"amount":string,"group":string,"toBuy":boolean,"basicSeasoning":boolean}],"steps":[{"title":string,"text":string,"tip":string}],"leftoverStorage":[{"ingredient":string,"method":string}],"sources":[{"label":string,"url":string,"popularity":string}]},"missing":[string],"confidence":"high"|"medium"|"low"}',
  ].join("\n");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    const url = (body.url ?? "").trim();
    if (!isSupportedVideoUrl(url)) {
      return Response.json(
        { error: "YouTube か TikTok のURLを貼ってください。" },
        { status: 400 },
      );
    }
    const jobId = globalThis.crypto.randomUUID();
    await setJob(jobId, { status: "running", step: "動画の情報を取得中…", createdAt: Date.now() });

    after(async () => {
      try {
        const info = await fetchVideoMeta(url);
        await setJob(jobId, {
          status: "running",
          // 何を根拠にしているかを進捗にも出す（概要欄が取れないと精度が落ちるため）
          step: info.description
            ? "AIがレシピに書き起こし中…（概要欄あり）"
            : "AIが出典を検索中…（概要欄が取得できず）",
          createdAt: Date.now(),
        });
        const out = await askClaudeForJson<{
          recipe?: unknown;
          missing?: unknown;
          confidence?: unknown;
        }>(buildPrompt(info));
        await setJob(jobId, {
          status: "done",
          recipe: out.recipe,
          source: { title: info.title, channel: info.channel, url: info.webpageUrl },
          createdAt: Date.now(),
          ...(Array.isArray(out.missing) ? { missing: out.missing } : {}),
          ...(typeof out.confidence === "string" ? { confidence: out.confidence } : {}),
        } as Job);
      } catch (e) {
        await setJob(jobId, {
          status: "error",
          error: friendlyError(e instanceof Error ? e.message : "取り込みに失敗しました"),
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

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });
  const job = await getJob(jobId);
  if (!job) return Response.json({ status: "missing" });
  return Response.json(job);
}
