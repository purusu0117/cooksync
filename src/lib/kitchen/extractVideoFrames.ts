import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, videoContainerError, type VideoManifest } from "./videoFrames";
import { photoUploadError } from "./limits";

export interface ExtractedVideo { manifest: VideoManifest; images: File[] }
export async function extractVideoFrames(file: File, signal: AbortSignal): Promise<ExtractedVideo> {
  if (!file.size || file.size > MAX_VIDEO_BYTES) throw new Error("動画は空でない100MB以内のファイルを選んでください。");
  const containerError = videoContainerError(new Uint8Array(await file.slice(0, 16).arrayBuffer()), file.type);
  if (containerError) throw new Error(containerError);
  signal.throwIfAborted();
  const video = document.createElement("video"), url = URL.createObjectURL(file);
  video.muted = true; video.playsInline = true; video.preload = "auto";
  const wait = (event: string, action: () => void) => new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener("error", fail); signal.removeEventListener("abort", abort); };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("この端末で動画を読み取れません。MP4形式で書き出すか、必要な場面を写真で選んでください。")); };
    const abort = () => { cleanup(); reject(new DOMException("取消しました", "AbortError")); };
    const timer = setTimeout(fail, 15000);
    video.addEventListener(event, done, { once: true }); video.addEventListener("error", fail, { once: true }); signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort(); else { try { action(); } catch { fail(); } }
  });
  try {
    await wait("loadeddata", () => { video.src = url; video.load(); });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_SECONDS || !video.videoWidth || !video.videoHeight) throw new Error("長さを確認できる20分以内の動画を選んでください。");
    const canvas = document.createElement("canvas"), scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d"); if (!context) throw new Error("この端末で画像を取り出せません。");
    const timestamps = [0.05, 0.35, 0.65, 0.95].map(n => duration * n), images: File[] = [];
    for (const [index, time] of timestamps.entries()) {
      signal.throwIfAborted();
      await wait("seeked", () => { video.currentTime = time; });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.8));
      signal.throwIfAborted();
      if (!blob) throw new Error("動画のコマを取り出せませんでした。");
      images.push(new File([blob], `frame-${index + 1}.jpg`, { type: "image/jpeg" }));
    }
    const error = photoUploadError(images); if (error) throw new Error(error);
    const sourceSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), n => n.toString(16).padStart(2, "0")).join("");
    signal.throwIfAborted();
    return { images, manifest: { version: 1, duration, timestamps, sourceSha256 } };
  } finally { video.pause(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); }
}
