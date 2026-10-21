// ローカル専用：**動画そのもの**から静止画（キーフレーム）を取り出す。
//
// なぜ要るのか（大翔の指摘・2026-08-09）:
//   これまでの取り込みは「概要欄」と「自動生成字幕」だけを材料にしていた。つまり
//   **映像を一度も見ていない**。ところが日本の料理動画は、材料と分量を画面のテロップに
//   出しているものが非常に多い（とくにTikTok/Shorts/Instagramは概要欄がほぼ空）。
//   映像を見ないかぎり、それらの動画からは何も取れない。
//
//   ローカル版は大翔の私用なので、yt-dlp で実体を落として ffmpeg で等間隔にコマを抜き、
//   その画像をそのままAIに見せる。テロップ・材料の映り込み・鍋の中の状態まで根拠にできる。
//   （配信版=Vercel はサブプロセスを起動できないので、ここは丸ごと使われない）
//
// ffmpeg の在り処は環境で違うので、決め打ちせず探す。PATHに無くても、winget で入れた
// パッケージ配下や他アプリ同梱のものを拾えれば動く（**dev serverを再起動しなくても効く**）。

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/** これ以上長い動画は実体を落とさない（落とすだけで数分かかり、割に合わない） */
export const MAX_FRAME_VIDEO_SEC = 30 * 60;

/** 抜くコマ数。多いほど精度は上がるが、AIに渡す画像が増えて遅くなる */
function frameCount(durationSec: number): number {
  if (durationSec <= 0) return 8;
  if (durationSec <= 60) return 8; // Shorts/TikTok：短いのでこれで全体を覆える
  if (durationSec <= 300) return 12;
  return 16;
}

let ffmpegCache: string | null | undefined;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** `<cmd> -version` が通るか。PATH解決も含めてここで確かめる */
function canRun(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ["-version"], { shell: false });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 8000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/** winget で入れた ffmpeg のように、PATHに載っていない場所も探す */
async function scanKnownDirs(): Promise<string[]> {
  if (process.platform !== "win32") return ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"];
  const home = os.homedir();
  const found: string[] = [];
  const roots = [
    path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Packages"),
    path.join(home, "scoop", "shims"),
    "C:\\ProgramData\\chocolatey\\bin",
  ];
  for (const root of roots) {
    // 直下に ffmpeg.exe があるパターン（scoop/chocolatey）
    const direct = path.join(root, "ffmpeg.exe");
    if (await exists(direct)) found.push(direct);
    // winget は <パッケージ>/<配布物>/bin/ffmpeg.exe と2段掘る
    try {
      for (const pkg of await fs.readdir(root)) {
        if (!/ffmpeg/i.test(pkg)) continue;
        const pkgDir = path.join(root, pkg);
        for (const sub of await fs.readdir(pkgDir).catch(() => [] as string[])) {
          const cand = path.join(pkgDir, sub, "bin", "ffmpeg.exe");
          if (await exists(cand)) found.push(cand);
        }
      }
    } catch {
      /* そのrootが無いだけ */
    }
  }
  return found;
}

/** 使える ffmpeg のパス。見つからなければ null（呼び出し側はコマ抜きを諦めて続行する） */
export async function findFfmpeg(): Promise<string | null> {
  if (ffmpegCache !== undefined) return ffmpegCache;
  const candidates = [
    process.env.COOKSYNC_FFMPEG,
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    ...(await scanKnownDirs()),
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (await canRun(c)) {
      ffmpegCache = c;
      return c;
    }
  }
  ffmpegCache = null;
  return null;
}

function runFfmpeg(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: false });
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("ffmpeg timeout"));
    }, timeoutMs);
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(err.trim().split("\n").slice(-2).join(" ") || `ffmpeg exit ${code}`));
    });
  });
}

/**
 * 動画ファイルから等間隔にコマを抜き、JPEGのパス配列を返す。
 *
 * 端（イントロ/エンドカード）は情報が薄いので少し内側から取る。
 * 1コマずつ `-ss` で頭出しするので、長い動画でも全体をデコードせずに済む。
 * 1枚でも失敗したら、その枚だけ捨てて続行する（全滅させない）。
 */
export async function extractFrames(
  videoPath: string,
  outDir: string,
  durationSec: number,
): Promise<string[]> {
  const bin = await findFfmpeg();
  if (!bin) return [];
  const n = frameCount(durationSec);
  // 長さが分からない動画は、先頭から10秒刻みで取る（それ以上は当てにいかない）
  const span = durationSec > 0 ? durationSec : n * 10;
  const head = span * 0.02;
  const tail = span * 0.98;
  const stepSec = n > 1 ? (tail - head) / (n - 1) : 0;

  await fs.mkdir(outDir, { recursive: true });
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const at = head + stepSec * i;
    const file = path.join(outDir, `frame-${String(i + 1).padStart(2, "0")}.jpg`);
    try {
      await runFfmpeg(
        bin,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          at.toFixed(2),
          "-i",
          videoPath,
          "-frames:v",
          "1",
          // テロップの文字が潰れない程度に縮める（幅1024・高さは偶数に自動）
          "-vf",
          "scale='min(1024,iw)':-2",
          "-q:v",
          "4",
          "-y",
          file,
        ],
        25_000,
      );
      if (await exists(file)) out.push(file);
    } catch {
      /* このコマだけ諦める */
    }
  }
  return out;
}
