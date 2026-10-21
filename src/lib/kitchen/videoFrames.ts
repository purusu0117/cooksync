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
export function videoEvidenceLabel(evidence?: Record<string, unknown>): string | null {
  if (evidence?.kind !== "video" || !Array.isArray(evidence.obtained) || !evidence.obtained.includes("uploaded-video-frames")) return null;
  try {
    const manifest = evidence.video as VideoManifest;
    const v = validateVideoManifest(manifest, manifest.timestamps.length);
    return `動画から抽出した${v.timestamps.length}コマ（${v.timestamps.map(t => `${t.toFixed(1)}秒`).join("、")}）を読み取りました。音声・字幕は未取得、動画全編は未確認です。元動画の時刻は端末からの申告です。`;
  } catch { return "動画のコマを読み取りました。元動画の時刻は確認できません。音声・字幕・全編は未確認です。"; }
}
