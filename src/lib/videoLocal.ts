// ローカル版だけの「強い」動画取り込み。yt-dlp（uvx経由）で概要欄に加えて**字幕**まで取る。
//
// なぜ2系統あるのか:
//   - 配信版(App Store / Vercel)  … 素のHTTPで概要欄だけ（src/lib/videoMeta.ts）。
//     字幕を取るには yt-dlp 相当の署名トークン生成が要り、それはYouTubeの私的APIを叩く行為で
//     利用規約に抵触する。**大翔の名前で配信するものに規約違反は入れない。**
//   - ローカル版(大翔が自分で使う)   … yt-dlp があるので字幕まで取れる。精度が最も高い。
//
// つまり「配信版は安全側・ローカル版は最強」という住み分け。大翔の方針（2026-07-31）。
//
// yt-dlp が無い環境（Vercel）では **null を返すだけ** で、呼び出し側がHTTP版に落ちる。
// 例外は投げない ―― ここで落ちると機能ごと死ぬので、必ず縮退で済ませる。

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { captionsToText, parseVtt } from "./vtt";
import type { VideoMeta } from "./videoMeta";

const UVX = process.platform === "win32" ? "uvx.exe" : "uvx";

/** Vercel上では絶対に試さない（サブプロセスを起動できず、待ち時間が無駄になる） */
function localAvailable(): boolean {
  return !process.env.VERCEL;
}

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

export interface LocalVideoRich {
  meta: VideoMeta;
  /** 自動生成字幕。誤変換が多いので、分量の根拠には使わせない */
  captions: string;
}

/**
 * ローカルで yt-dlp が使えるなら、概要欄＋字幕を取る。
 * 使えない・失敗した場合は null（呼び出し側がHTTP版にフォールバックする）。
 */
export async function tryLocalRich(url: string, jobId: string): Promise<LocalVideoRich | null> {
  if (!localAvailable()) return null;

  const dir = path.join(process.cwd(), ".data", "tmp", `video-${jobId}`);
  try {
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

    // 字幕は取れなくても致命的ではないので、失敗しても続行する
    let captions = "";
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
      if (files.length > 0) {
        files.sort((a, b) => (a.includes(".ja") ? -1 : 0) - (b.includes(".ja") ? -1 : 0));
        captions = captionsToText(parseVtt(await fs.readFile(path.join(dir, files[0]), "utf8")));
      }
    } catch {
      /* 字幕なしで続行 */
    }
    if (captions) meta.via.push("captions");
    return { meta, captions };
  } catch {
    // uvx が無い／yt-dlp が失敗 → HTTP版に任せる
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
