// YouTube / TikTok のURLからレシピを起こす。
//
// 取り方は yt-dlp（uvx経由・ダウンロードはせずメタデータと字幕だけ）。
//  - 概要欄(description)：料理系の投稿者は材料と分量をここに全部書いていることが多い＝一番正確
//  - 自動生成字幕：手順の流れは分かるが **音声認識の誤変換が非常に多い**
//    （実測：「ピーマン丼」→「ショー開催t1どん」）。分量の根拠には使えない。
//
// ⚠️ 方針：取れた情報だけでレシピにする。**分からない分量をAIの一般知識で埋めない**。
//    （[[mistakes]] 2026-05-22「トランスクリプトが取れず一般知識で補完し出典と食い違った」の再発防止）

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { after } from "next/server";
import { askClaudeForJson } from "@/lib/ai";
import { captionsToText, parseVtt } from "@/lib/vtt";
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

/** 対応しているURLか（対応外を弾いて無駄な起動をしない） */
export function isSupportedVideoUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    return (
      h === "youtube.com" ||
      h === "m.youtube.com" ||
      h === "youtu.be" ||
      h === "tiktok.com" ||
      h === "vt.tiktok.com" ||
      h === "vm.tiktok.com" ||
      h.endsWith(".youtube.com") ||
      h.endsWith(".tiktok.com")
    );
  } catch {
    return false;
  }
}

const UVX = process.platform === "win32" ? "uvx.exe" : "uvx";

/** yt-dlp の英語エラーを、何をすればいいか分かる日本語にする */
function friendlyError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("ip address is blocked") || m.includes("blocked from accessing")) {
    return "動画サイト側からアクセスを弾かれました（TikTokで起きやすい）。少し時間をおくか、別の動画で試してください。";
  }
  if (m.includes("sign in") || m.includes("login required") || m.includes("private")) {
    return "非公開・ログインが必要な動画は取り込めません。公開されている動画のURLを使ってください。";
  }
  if (m.includes("unsupported url") || m.includes("unable to extract")) {
    return "このURLからは情報を取得できませんでした。動画の個別ページのURLか確認してください（一覧・タグページは不可）。";
  }
  if (m.includes("timeout")) {
    return "動画の取得に時間がかかりすぎました。もう一度試してください。";
  }
  if (m.includes("enoent") || m.includes("uvx")) {
    return "yt-dlp を起動できませんでした（uv が見つかりません）。";
  }
  return raw.slice(0, 200);
}

/** yt-dlp を叩く（uvx経由なので事前インストール不要） */
function runYtDlp(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(UVX, ["yt-dlp", ...args], { shell: false });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("yt-dlp timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) {
        reject(new Error(err.trim().split("\n").slice(-2).join(" ") || `yt-dlp exit ${code}`));
        return;
      }
      resolve(out);
    });
  });
}

interface VideoInfo {
  title: string;
  channel: string;
  description: string;
  duration: number;
  webpageUrl: string;
}

async function fetchInfo(url: string): Promise<VideoInfo> {
  const raw = await runYtDlp(
    ["--skip-download", "--no-warnings", "--no-playlist", "--dump-json", url],
    90_000,
  );
  const first = raw.trim().split("\n")[0];
  const j = JSON.parse(first) as Record<string, unknown>;
  return {
    title: typeof j.title === "string" ? j.title : "",
    channel:
      (typeof j.channel === "string" && j.channel) ||
      (typeof j.uploader === "string" && j.uploader) ||
      "",
    description: typeof j.description === "string" ? j.description : "",
    duration: typeof j.duration === "number" ? j.duration : 0,
    webpageUrl: typeof j.webpage_url === "string" ? j.webpage_url : url,
  };
}

/** 字幕（日本語優先）を取れたら返す。取れなくてもエラーにしない */
async function fetchCaptions(url: string, dir: string): Promise<string> {
  try {
    await fs.mkdir(dir, { recursive: true });
    await runYtDlp(
      [
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "ja,ja-JP,ja-orig,en",
        "-o",
        path.join(dir, "cap.%(ext)s"),
        url,
      ],
      120_000,
    );
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".vtt"));
    if (files.length === 0) return "";
    // 日本語を優先
    files.sort((a, b) => (a.includes(".ja") ? -1 : 0) - (b.includes(".ja") ? -1 : 0));
    const vtt = await fs.readFile(path.join(dir, files[0]), "utf8");
    return captionsToText(parseVtt(vtt));
  } catch {
    return "";
  }
}

function buildPrompt(info: VideoInfo, captions: string): string {
  return [
    "あなたは料理動画を家庭用レシピに書き起こすアシスタントです。次の動画の情報から、レシピをJSONで作ってください。",
    "",
    `■ 動画タイトル: ${info.title}`,
    `■ 投稿者: ${info.channel}`,
    `■ 動画URL: ${info.webpageUrl}`,
    "",
    "■ 概要欄（投稿者本人が書いた説明。材料と分量が書かれていることが多く、最も信頼できる）:",
    info.description ? info.description.slice(0, 4000) : "（概要欄なし）",
    "",
    captions
      ? [
          "■ 字幕（自動生成のため誤変換が多い。手順の流れの参考にはするが、食材名・分量の根拠にはしない）:",
          captions,
        ].join("\n")
      : "■ 字幕: 取得できませんでした。",
    "",
    "【厳守】",
    "- **書かれていないことを推測で埋めない。** 分量が分からない材料は amount を「動画で明示なし」にする。",
    "  （それらしい数字を勝手に入れるのは禁止。あとで作る人が失敗する）",
    "- 概要欄に公式レシピページのURL（バズレシピ.com、クックパッド、ブログ等）があれば WebFetch で開き、",
    "  そこに書かれた正確な材料・分量・手順を最優先で使う。",
    "- 字幕の誤変換は概要欄の材料名で補正する（例: 字幕の「ぴ」→概要欄の「ピーマン」）。",
    "- 手順が動画から読み取れない場合は、無理に工程を作らず steps を短くしてよい。",
    "- sources には必ず動画URLと投稿者名を入れる。参照した公式ページがあればそれも追加する。",
    "- 分量が読み取れなかった材料名を missing 配列に列挙する（UIで注意表示するため）。",
    "- confidence は high / medium / low。概要欄に材料と分量が揃っていれば high、字幕頼りなら low。",
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
    // 公開(Vercel)ではyt-dlpを起動できないので機能ごと止める
    if (redis) {
      return Response.json(
        { error: "動画からの取り込みはローカル版のみ対応しています。" },
        { status: 501 },
      );
    }

    const jobId = globalThis.crypto.randomUUID();
    await setJob(jobId, { status: "running", step: "動画の情報を取得中…", createdAt: Date.now() });

    after(async () => {
      const dir = path.join(process.cwd(), ".data", "tmp", `video-${jobId}`);
      try {
        const info = await fetchInfo(url);
        await setJob(jobId, {
          status: "running",
          step: "字幕を取得中…",
          createdAt: Date.now(),
        });
        const captions = await fetchCaptions(url, dir);
        await setJob(jobId, {
          status: "running",
          step: "AIがレシピに書き起こし中…",
          createdAt: Date.now(),
        });
        const out = await askClaudeForJson<{
          recipe?: unknown;
          missing?: unknown;
          confidence?: unknown;
        }>(buildPrompt(info, captions));
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
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
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
