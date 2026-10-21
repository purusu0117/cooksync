import { requireAiScope, withAiRequest, requireActiveAiJob } from "@/lib/kitchen/managedAi";
// YouTube / TikTok / Instagram のURLからレシピを起こす。
//
// 取得は2系統。**ローカルは最強・配信版は安全側**（大翔の方針・2026-07-31）。
//
//   1. ローカル版 … src/lib/videoLocal.ts（yt-dlp＋ffmpeg）。
//                   概要欄・**字幕**・**映像のコマ**まで取る。
//   2. 配信版     … src/lib/videoMeta.ts（素のHTTP）。oEmbed＋ページHTMLで**概要欄まで**。
//
// なぜ配信版で字幕・映像を取らないか：素のfetchでは timedtext が0バイトで返り、取るには
// yt-dlp 相当の署名トークン生成＝YouTubeの私的APIを叩く必要がある。これは利用規約に
// 抵触するため、App Storeで配信するものには入れない。ローカルは大翔の私用なので入れる。
//
//  - 概要欄(description)：料理系の投稿者は材料と分量をここに全部書いていることが多い＝一番正確
//  - 映像のコマ：**テロップに材料と分量が出る**。概要欄が空のTikTok/Shorts/Instagramでは
//    ここが唯一の情報源になる（2026-08-09 追加。それまでは映像を一度も見ていなかった）
//  - 字幕：自動生成のため誤変換が非常に多い（実測「ピーマン丼」→「ショー開催t1どん」）。
//    流れの参考にはするが、分量の根拠には使わせない。
//
// ⚠️ 方針：取れた情報だけでレシピにする。**分からない分量をAIの一般知識で埋めない**。

import { managedAfter as after } from "@/lib/kitchen/managedAi";
// コマが0枚のときは askClaudeForJsonWithImages が内部で askClaudeForJson に落ちる
import { askClaudeForJsonWithImages } from "@/lib/ai";
import {
  extractVideoUrl,
  fetchVideoMeta,
  isSupportedVideoUrl,
  type VideoMeta,
} from "@/lib/videoMeta";
import { tryLocalRich, localAvailable } from "@/lib/videoLocal";
import { redis } from "@/lib/kv";
import { consume, quotaResponse, refund } from "@/lib/quotaServer";

import { sendPush, resolvePushTarget } from "@/lib/pushServer";
import { validateImportedRecipe } from "@/lib/kitchen/importValidation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Job {
  status: "running" | "done" | "error";
  step?: string;
  recipe?: unknown;
  source?: { title: string; channel: string; url: string; via?: string[] };
  error?: string;
  /** 失敗の生の理由。画面には出さないが、原因を握りつぶさないために残す */
  detail?: string;
  evidence?: Record<string, unknown>;
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

interface Material {
  info: VideoMeta;
  captions: string;
  frames: string[];
  framesNote: string;
}

function buildPrompt(m: Material): string {
  const { info, captions, frames, framesNote } = m;
  const hasDesc = info.description.trim().length > 0;
  const hasFrames = frames.length > 0;
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
    // 映像のコマ。テロップに材料と分量が出る動画（TikTok/Shorts等）ではここが主役になる。
    hasFrames
      ? [
          `■ 映像: この動画から等間隔で抜いた${frames.length}枚のコマを渡しています（時系列順）。`,
          "  **必ず全部見ること。** 画面のテロップ（材料名・分量・火加減・時間）は投稿者が書いた文字なので、",
          "  字幕の音声書き起こしより信頼できる。写っている食材・調理器具・鍋の中の状態も手順の根拠にしてよい。",
        ].join("\n")
      : `■ 映像: 見ていません（${framesNote || "取得できず"}）。`,
    "",
    captions
      ? [
          "■ 字幕（自動生成のため誤変換が非常に多い。手順の流れの参考にはするが、食材名・分量の根拠にはしない）:",
          captions.slice(0, 12000),
        ].join("\n")
      : "■ 字幕: 取得できません。音声の内容は分かりません。",
    "",
    "【厳守】",
    "- **書かれていないことを推測で埋めない。** 分量が分からない材料は amount を「動画で明示なし」にする。",
    "  （それらしい数字を勝手に入れるのは禁止。あとで作る人が失敗する）",
    hasFrames
      ? "- 映像のテロップに分量が出ていれば、それをそのまま使う（読み取れた文字を優先し、勝手に丸めない）。"
      : "",
    "- 概要欄に公式レシピページのURL（バズレシピ.com、クックパッド、ブログ等）があれば WebFetch で開き、",
    "  そこに書かれた正確な材料・分量・手順を最優先で使う。",
    hasDesc
      ? "- 概要欄に材料と分量が書かれていれば、それをそのまま使う（勝手に足し引きしない）。"
      : hasFrames
        ? // 概要欄が無くても映像がある＝テロップから読む。ここで一般知識に逃がさない。
          "- **概要欄が取れていない。映像のテロップから材料と分量を読み取ること。** 読めない分は「動画で明示なし」にし、一般知識で補わない。"
        : // 概要欄も映像も無いときが一番危ない。
          "- **概要欄も映像も取れていない。** タイトルと投稿者名で WebSearch を行い、その投稿者の公式レシピページ（ブログ・クックパッド等）を探して、そこに書かれた材料・分量・手順を使うこと。見つからなければ、無理にレシピを作らず ingredients と steps を空にして confidence を low にする。一般知識で作った“それらしいレシピ”を返すのは禁止。",
    "- 手順が読み取れない場合は、無理に工程を作らず steps を短くしてよい。",
    "- **1文＝1作業**。動作が変わったら文を切る。とくに『〜たら』（煮立ったら等の“待ち”）は独立した文にする。",
    "- sources には必ず動画URLと投稿者名を入れる。参照した公式ページがあればそれも追加する。",
    "- 分量が読み取れなかった材料名を missing 配列に列挙する（UIで注意表示するため）。",
    hasFrames
      ? "- confidence は high / medium / low。概要欄か映像のテロップに材料と分量が揃っていれば high、検索で見つけた出典なら medium、根拠が薄ければ low。"
      : "- confidence は high / medium / low。概要欄に材料と分量が揃っていれば high、検索で見つけた出典なら medium、根拠が薄ければ low。",
    // 料理と無関係な動画に無理やりレシピを付けさせない。写真側と同じ合図にする。
    '- 動画が料理と無関係なら {"recipe":null} を返す。',
    "",
    "- 人数・調理時間・栄養量が読み取れない場合は null。元の素材に根拠のない分量・重量・保存期限・加熱条件を創作しない。",
    "出力は次のJSONだけ（前後に文章やコードフェンスを付けない）:",
    '{"recipe":{"name":string,"emoji":string,"catch":string,"servings":number|null,"kcal":number|null,"cookTime":number|null,"cuisine":"和"|"洋"|"中"|"アジアン","ingredients":[{"name":string,"amount":string,"group":string,"toBuy":boolean,"basicSeasoning":boolean}],"steps":[{"title":string,"text":string,"tip":string}],"leftoverStorage":[{"ingredient":string,"method":string}],"sources":[{"label":string,"url":string,"popularity":string}]},"missing":[string],"confidence":"high"|"medium"|"low"}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** 何を根拠にしているかを進捗にも出す（根拠が薄いと精度が落ちるため） */
function writingStep(m: Material): string {
  const src = [
    m.frames.length > 0 ? `映像${m.frames.length}コマ` : "",
    m.info.description ? "概要欄" : "",
    m.captions ? "字幕" : "",
  ].filter(Boolean);
  return src.length > 0
    ? `取得できた素材を読み取り中…（${src.join("＋")}）${m.frames.length ? "" : "映像は未取得"}`
    : "動画の素材を取得できませんでした";
}

async function handlePost(request: Request) {
  try {
    const body = (await request.json()) as { url?: string; u?: string };
    // 共有シートは「タイトル＋改行＋URL」で寄こすことがあるので、URLだけ拾い直す
    const url = extractVideoUrl(body.url ?? "");
    if (!isSupportedVideoUrl(url)) {
      return Response.json(
        { error: "YouTube・TikTok・Instagram のURLを貼ってください。" },
        { status: 400 },
      );
    }
    // ⚠️ ここは **Sonnet 5 ＋ Web検索** を使う一番高い経路（実測 ¥12.8/回）なのに、
    //    2026-08-01 の監査まで**枠が一切掛かっていなかった**。
    //    公開環境で入口を戻した以上、誰でも無制限に叩ける状態は許容できない。
    const uid = requireAiScope().owner;
    const q = await consume(uid, "import", request);
    if (!q.ok) return quotaResponse(q, "import");

    // 取り込みは数分かかる＝画面を閉じている可能性が高い。終わったら通知する。
    const pushUid = (await resolvePushTarget(request, body.u))?.uid ?? null;

    const jobId = globalThis.crypto.randomUUID();
    await setJob(jobId, { status: "running", step: "動画の情報を取得中…", createdAt: Date.now() });

    after(async () => {
      let cleanup: (() => Promise<void>) | null = null;
      // yt-dlp が動画を開けなかったときの理由。最後まで持ち回って画面に出す。
      let localFailure = "";
      try {
        await requireActiveAiJob();
        // ローカル版は yt-dlp＋ffmpeg で概要欄・字幕・映像のコマまで取る（最も精度が高い）。
        // 配信版(Vercel)では null が返るので、素のHTTPで概要欄だけ取る方に落ちる。
        const rich = await tryLocalRich(url, jobId, {
          onProgress: (step) => {
            void setJob(jobId, { status: "running", step, createdAt: Date.now() });
          },
          onFail: (reason) => {
            localFailure = reason;
          },
        });
        cleanup = rich?.cleanup ?? null;
        const material: Material = {
          info: rich?.meta ?? (await fetchVideoMeta(url)),
          captions: rich?.captions ?? "",
          frames: rich?.frames ?? [],
          framesNote: rich?.framesNote || localFailure || "この環境では映像を取得できません",
        };
        if (!material.captions.trim() && !material.frames.length && !material.info.description?.trim()) {
          throw new Error("動画の字幕・説明欄・映像を取得できませんでした");
        }
        await setJob(jobId, {
          status: "running",
          step: writingStep(material),
          createdAt: Date.now(),
        });

        const prompt = buildPrompt(material);
        const out = await askClaudeForJsonWithImages<{
          recipe?: unknown;
          missing?: unknown;
          confidence?: unknown;
        }>(prompt, material.frames);

        // 動画を1つも開けなかったとき、AIは仕様どおり「材料も手順も空のレシピ」を返す
        // （＝根拠が無いのに“それらしいレシピ”を作らせない、という指示の結果）。
        // これを done にすると、名前だけの空のレシピカードが画面に出て使えない。
        // 中身が無いものは成功ではないので、下の recipe:null と同じ扱いにする。
        const r = out.recipe as { ingredients?: unknown[]; steps?: unknown[] } | null;
        const isEmpty =
          !!r &&
          (!Array.isArray(r.ingredients) || r.ingredients.length === 0) &&
          (!Array.isArray(r.steps) || r.steps.length === 0);
        if (isEmpty) out.recipe = null;

        // 料理と無関係な動画では AI が仕様どおり {"recipe":null} を返す。
        // ここを done にすると、クライアントが recipe:undefined のまま
        // ImportedRecipePreview に渡してホーム画面ごとクラッシュする
        // （TypeError: Cannot read properties of undefined (reading 'name')）。
        // 写真側（import-photo）と同じく **失敗として扱い、枠も戻す**。
        if (!out.recipe) {
          await refund(uid, "import", request).catch(() => {});
          await setJob(jobId, {
            status: "error",
            // 「読み取れませんでした」だけだと、料理動画じゃなかったのか、
            // プラットフォームに弾かれたのかが区別できない。分かる方を出す。
            error: localFailure
              ? localFailure
              : "この動画からはレシピを読み取れませんでした。料理動画のURLでお試しください。",
            detail: `via=${material.info.via?.join("+") || "none"} frames=${material.frames.length} ${material.framesNote}`,
            createdAt: Date.now(),
          });
          return;
        }
        await requireActiveAiJob();
        const checked = validateImportedRecipe(out.recipe, true);
        await setJob(jobId, {
          status: "done",
          recipe: checked.recipe,
          evidence: { kind: "video", obtained: [material.info.description ? "description" : "", material.captions ? "captions" : "", material.frames.length ? "frames" : ""].filter(Boolean), frameCount: material.frames.length, framesNote: material.framesNote, sourceUrl: material.info.webpageUrl, capturedAt: new Date().toISOString(), missing: checked.missing },
          source: {
            title: material.info.title,
            channel: material.info.channel,
            url: material.info.webpageUrl,
            via: material.info.via,
          },
          createdAt: Date.now(),
          ...(Array.isArray(out.missing) ? { missing: out.missing } : {}),
          ...(typeof out.confidence === "string" ? { confidence: out.confidence } : {}),
        } as Job);
        await requireActiveAiJob();
        if (pushUid) {
          const name = (out.recipe as { name?: string })?.name;
          await sendPush(pushUid, {
            title: "🎬 動画からレシピができました",
            body: name ? `「${name}」を取り込みました。タップして確認` : "タップして確認",
            url: "/",
          }).catch(() => {});
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : "取り込みに失敗しました";
        // 握りつぶすと同じ相談が繰り返される。サーバーのログには生の理由を必ず出す。
        console.error("[import-video] failed (details withheld)");
        // AIが失敗したのに枠だけ減るのは理不尽なので戻す
        await refund(uid, "import", request).catch(() => {});
        await setJob(jobId, {
          status: "error",
          error: localFailure || friendlyError(raw),
          detail: "取得または構造検証に失敗",
          createdAt: Date.now(),
        });
      } finally {
        // AIが画像を読み終わってから消す（tryLocalRich 側では消さない）
        if (cleanup) await cleanup();
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
// ＝ジョブは status:"running" のまま Redis のTTL(30分)まで残り、クライアントは
// その間ずっとスピナーを回し続ける。実時間で見て終わっているはずのジョブは
// running でも失敗として返す。
//
// ⚠️ ローカル版は maxDuration の制限が無く、**映像を落として16コマ読ませる**ので
//    素直に数分かかる（実測で3〜6分）。配信版と同じ6分で切ると、正常に動いている
//    ジョブを画面側が勝手に失敗にしてしまう。経路ごとに待つ時間を変える。
const STUCK_MS = localAvailable() ? 15 * 60 * 1000 : 6 * 60 * 1000;

function isStuck(job: Job): boolean {
  return job.status === "running" && Date.now() - job.createdAt > STUCK_MS;
}

async function handleGet(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });
  const job = await getJob(jobId);
  if (!job) return Response.json({ status: "missing" });
  if (isStuck(job)) {
    return Response.json({
      status: "error",
      error: "時間内に取り込みが終わりませんでした。もう一度お試しください。",
    });
  }
  return Response.json(job);
}

export const POST = withAiRequest(handlePost);
export const GET = withAiRequest(handleGet, true);
