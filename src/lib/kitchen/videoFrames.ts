/** Client-reported metadata; the server validates images, not the original video. */
export interface VideoManifest {
  version: 1;
  duration: number;
  timestamps: number[];
  sourceSha256: string;
}
export const MAX_VIDEO_BYTES = 100_000_000;
export const MAX_VIDEO_SECONDS = 1200;
export function validateVideoManifest(value: unknown, count: number): VideoManifest {
  const v = value as Partial<VideoManifest> | null;
  if (!v || v.version !== 1 || typeof v.duration !== "number" || !Number.isFinite(v.duration) || v.duration <= 0 || v.duration > MAX_VIDEO_SECONDS ||
    !Array.isArray(v.timestamps) || count < 1 || count > 4 || v.timestamps.length !== count ||
    v.timestamps.some((t, i, a) => typeof t !== "number" || !Number.isFinite(t) || t < 0 || t >= v.duration! || (i > 0 && t <= a[i - 1])) ||
    typeof v.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.sourceSha256)) throw new Error("動画の時刻・コマ数を確認できません。もう一度動画を選んでください。");
  return { version: 1, duration: v.duration, timestamps: [...v.timestamps], sourceSha256: v.sourceSha256 };
}
export function videoContainerError(bytes: Uint8Array, mime: string): string | null {
  const ftyp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  const webm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return (ftyp && ["", "video/mp4", "video/quicktime", "video/x-m4v"].includes(mime)) || (webm && ["", "video/webm"].includes(mime)) ? null : "動画形式と内容が一致しません。MP4・MOV・WebMを選んでください。";
}
/** Materials a URL import (import-video) can obtain. Title/channel are not material and never appear here. */
export const URL_VIDEO_MATERIALS = ["description", "captions", "frames"] as const;
export type UrlVideoMaterial = (typeof URL_VIDEO_MATERIALS)[number];
const URL_VIDEO_MATERIAL_JA: Record<UrlVideoMaterial, string> = { description: "説明欄", captions: "字幕", frames: "映像" };

/** Which of 説明欄/字幕/映像 were not obtained, in fixed order (used by the route's error/evidence and by the label). */
export function unavailableUrlVideoMaterials(obtained: readonly string[]): UrlVideoMaterial[] {
  return URL_VIDEO_MATERIALS.filter(m => !obtained.includes(m));
}

/**
 * One-line Japanese label for what a URL import actually read.
 * Says only what was fetched; never implies the video was watched when it was not.
 */
export function urlVideoEvidenceLabel(obtained: readonly string[], frameCount = 0): string {
  const got = URL_VIDEO_MATERIALS.filter(m => obtained.includes(m));
  if (got.length === 0) return "説明欄・字幕・映像のいずれも取得できていません。";
  const gotJa = got.map(m => m === "frames" ? `映像のコマ${frameCount > 0 ? `${frameCount}枚` : ""}` : URL_VIDEO_MATERIAL_JA[m]);
  // 字幕は音声の書き起こし。字幕が無い回は音声も聞いていないことを明示する。
  const missing = [
    got.includes("description") ? "" : "説明欄",
    got.includes("frames") ? "" : "映像",
    got.includes("captions") ? "" : "音声・字幕",
  ].filter(Boolean);
  const head = got.length === 1 ? `${gotJa[0]}だけを読み取りました。` : `${gotJa.join("と")}を読み取りました。`;
  const tail = got.includes("frames") ? "動画全編は未確認です。" : "";
  return `${head}${missing.length ? `${missing.join("・")}は未取得です。` : ""}${tail}`;
}

export function videoEvidenceLabel(evidence?: Record<string, unknown>): string | null {
  if (evidence?.kind !== "video" || !Array.isArray(evidence.obtained)) return null;
  if (!evidence.obtained.includes("uploaded-video-frames")) {
    // URL import: evidence.obtained holds description/captions/frames (or nothing).
    const obtained = evidence.obtained.filter((m): m is string => typeof m === "string");
    if (obtained.length > 0 && !obtained.some(m => URL_VIDEO_MATERIALS.includes(m as UrlVideoMaterial))) return null;
    return urlVideoEvidenceLabel(obtained, typeof evidence.frameCount === "number" ? evidence.frameCount : 0);
  }
  try {
    const manifest = evidence.video as VideoManifest;
    const v = validateVideoManifest(manifest, manifest.timestamps.length);
    return `動画から抽出した${v.timestamps.length}コマ（${v.timestamps.map(t => `${t.toFixed(1)}秒`).join("、")}）を読み取りました。音声・字幕は未取得、動画全編は未確認です。元動画の時刻は端末からの申告です。`;
  } catch { return "動画のコマを読み取りました。元動画の時刻は確認できません。音声・字幕・全編は未確認です。"; }
}
