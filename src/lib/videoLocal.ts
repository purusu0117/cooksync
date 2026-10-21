// ローカル版だけの「強い」動画取り込み。yt-dlp（uvx経由）＋ffmpeg で、
// **概要欄・字幕・映像のコマ**の3つを揃えて取る。
//
// なぜ2系統あるのか:
//   - 配信版(App Store / Vercel)  … 素のHTTPで概要欄だけ（src/lib/videoMeta.ts）。
//     字幕を取るには yt-dlp 相当の署名トークン生成が要り、それはYouTubeの私的APIを叩く行為で
//     利用規約に抵触する。**大翔の名前で配信するものに規約違反は入れない。**
//   - ローカル版(大翔が自分で使う)   … yt-dlp と ffmpeg があるので、字幕も映像も取れる。
//
// つまり「配信版は安全側・ローカル版は最強」という住み分け。大翔の方針（2026-07-31）。
//
// 2026-08-09 追加：**映像のコマ抜き**。
//   概要欄と字幕だけでは、TikTok/Shorts/Instagram のように「概要欄が空・字幕なし・
//   材料は全部テロップ」という動画から何も取れなかった（＝レシピが作れずエラー扱い）。
//   実体を落として ffmpeg で等間隔にコマを抜き、その画像をAIに見せることで、
//   ようやく「動画を見て書き起こす」になる。
//
// yt-dlp が無い環境（Vercel）では **null を返すだけ** で、呼び出し側がHTTP版に落ちる。
// 例外は投げない ―― ここで落ちると機能ごと死ぬので、必ず縮退で済ませる。

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { captionsToText, parseVtt } from "./vtt";
import { extractFrames, findFfmpeg, MAX_FRAME_VIDEO_SEC } from "./videoFrames";
import type { VideoMeta } from "./videoMeta";

const UVX = process.platform === "win32" ? "uvx.exe" : "uvx";

/** Vercel上では絶対に試さない（サブプロセスを起動できず、待ち時間が無駄になる） */
export function localAvailable(): boolean {
  return !process.env.VERCEL && process.env.COOKSYNC_VIDEO_EXTRACTION_APPROVED === "1";
}

/** Access restrictions are not bypassed with browser login cookies. */
function cookieArgs(): string[] {
  // CookSync never borrows browser login cookies to get past access restrictions.
  return [];
}

function runYtDlp(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(UVX, ["yt-dlp", ...cookieArgs(), ...args], { shell: false });
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

export interface LocalVideoRich {
  meta: VideoMeta;
  /** 自動生成字幕。誤変換が多いので、分量の根拠には使わせない */
  captions: string;
  /** 映像から抜いたコマ（JPEGの絶対パス）。AIがReadで開いて見る */
  frames: string[];
  durationSec: number;
  /** なぜコマが取れなかったか（取れたときは空）。UIとログに出して原因を隠さない */
  framesNote: string;
  /** AIが画像を読み終わってから呼ぶ。作業ディレクトリを丸ごと消す */
  cleanup: () => Promise<void>;
}

interface RichOptions {
  onProgress?: (step: string) => void;
  /** yt-dlp が動画を開けなかったときの生の理由。握りつぶさず呼び出し側に渡す */
  onFail?: (reason: string) => void;
}

/** yt-dlp の生エラーを、大翔が次に何をすればいいか分かる日本語にする */
export function explainYtDlpError(url: string, raw: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const m = raw.toLowerCase();
  const needsLogin =
    m.includes("cookies") ||
    m.includes("empty media response") ||
    m.includes("login") ||
    m.includes("rehydration") ||
    m.includes("app info");
  if (needsLogin && (host.includes("instagram") || host.includes("tiktok"))) {
    const name = host.includes("instagram") ? "Instagram" : "TikTok";
    return `${name}が取得を拒否しました。公開された説明欄か、利用権限のある素材を手動で確認してください。`;
  }
  if (m.includes("private") || m.includes("members-only") || m.includes("age")) {
    return "限定公開・年齢制限つきの動画のため取得できませんでした。";
  }
  if (m.includes("timeout")) {
    return "動画の取得が時間切れになりました。もう一度お試しください。";
  }
  return `動画の取得に失敗しました（${raw.slice(0, 160)}）`;
}

/**
 * ローカルで yt-dlp が使えるなら、概要欄・字幕・映像のコマを取る。
 * 使えない・メタ情報すら取れない場合は null（呼び出し側がHTTP版にフォールバックする）。
 *
 * ⚠️ 返り値の frames は **呼び出し側が使い終わるまで消さない**。
 *    後片付けは cleanup() を呼ぶ側の責任（以前はこの関数の finally で消していたので、
 *    コマを渡す作りにすると AI が読む前に消えてしまう）。
 */
export async function tryLocalRich(
  url: string,
  jobId: string,
  opts: RichOptions = {},
): Promise<LocalVideoRich | null> {
  const { onProgress, onFail } = opts;
  if (!localAvailable()) return null;

  const dir = path.join(process.cwd(), ".data", "tmp", `video-${jobId}`);
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {});

  try {
    onProgress?.("動画の情報を取得中…");
    const raw = await runYtDlp(
      ["--skip-download", "--no-warnings", "--no-playlist", "--dump-json", url],
      90_000,
    );
    const j = JSON.parse(raw.trim().split("\n")[0]) as Record<string, unknown>;
    const meta: VideoMeta = {
      title: typeof j.title === "string" ? j.title : "",
      channel:
        (typeof j.channel === "string" && j.channel) ||
        (typeof j.uploader === "string" && j.uploader) ||
        "",
      description: typeof j.description === "string" ? j.description : "",
      webpageUrl: typeof j.webpage_url === "string" ? j.webpage_url : url,
      via: ["yt-dlp"],
    };
    const durationSec = typeof j.duration === "number" ? j.duration : 0;

    await fs.mkdir(dir, { recursive: true });

    // ── 字幕（取れなくても致命的ではないので、失敗しても続行）────────────
    let captions = "";
    try {
      onProgress?.("字幕を取得中…");
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
      if (files.length > 0) {
        files.sort((a, b) => (a.includes(".ja") ? -1 : 0) - (b.includes(".ja") ? -1 : 0));
        captions = captionsToText(parseVtt(await fs.readFile(path.join(dir, files[0]), "utf8")));
      }
    } catch {
      /* 字幕なしで続行 */
    }
    if (captions) meta.via.push("captions");

    // ── 映像のコマ（ここが 2026-08-09 の本題）──────────────────────────
    let frames: string[] = [];
    let framesNote = "";
    try {
      if (!(await findFfmpeg())) {
        framesNote = "ffmpeg が見つからないため映像は見ていません";
      } else if (durationSec > MAX_FRAME_VIDEO_SEC) {
        framesNote = `動画が長すぎる（${Math.round(durationSec / 60)}分）ため映像は見ていません`;
      } else {
        onProgress?.("動画を取得中…（映像を見て書き起こすため）");
        const videoPath = await downloadVideo(url, dir);
        if (!videoPath) {
          framesNote = "動画の実体を取得できませんでした";
        } else {
          onProgress?.("映像からコマを抜き出し中…");
          frames = await extractFrames(videoPath, path.join(dir, "frames"), durationSec);
          if (frames.length === 0) framesNote = "コマの抜き出しに失敗しました";
        }
      }
    } catch (e) {
      framesNote = e instanceof Error ? e.message : "映像の取得に失敗しました";
    }
    if (frames.length > 0) meta.via.push("frames");

    return { meta, captions, frames, durationSec, framesNote, cleanup };
  } catch (e) {
    // uvx が無い／yt-dlp が失敗 → HTTP版に任せる。
    // ただし**理由は必ず外に出す**。ここで黙ると、TikTok/Instagram が
    // ログインを要求しているだけなのに「取り込みに失敗しました」としか出ない。
    const raw = e instanceof Error ? e.message : String(e);
    console.warn(`[import-video] yt-dlp 失敗 (${url}): ${raw}`);
    onFail?.(explainYtDlpError(url, raw));
    await cleanup();
    return null;
  }
}

/**
 * コマ抜き用に、動画の実体を**画質を落として**落とす。
 * 音声は要らない（字幕で足りる）ので映像だけ選び、結合(=ffmpegのmerge)を避ける。
 */
async function downloadVideo(url: string, dir: string): Promise<string | null> {
  const target = path.join(dir, "video.%(ext)s");
  await runYtDlp(
    [
      "--no-warnings",
      "--no-playlist",
      "--no-part",
      // 480p以下の単一ファイルを優先。無ければ一番小さいものに落とす。
      "-f",
      "bv*[height<=480]/b[height<=480]/bv*/b",
      "-o",
      target,
      url,
    ],
    240_000,
  );
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith("video."));
  return files.length > 0 ? path.join(dir, files[0]) : null;
}
