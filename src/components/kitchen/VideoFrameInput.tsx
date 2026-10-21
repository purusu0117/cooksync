"use client";
import { useEffect, useRef, useState } from "react";
import { extractVideoFrames, type ExtractedVideo } from "@/lib/kitchen/extractVideoFrames";

export default function VideoFrameInput({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const [extracted, setExtracted] = useState<ExtractedVideo | null>(null), [urls, setUrls] = useState<string[]>([]);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { const next = extracted?.images.map(file => URL.createObjectURL(file)) || []; const timer = setTimeout(() => setUrls(next), 0); return () => { clearTimeout(timer); next.forEach(url => URL.revokeObjectURL(url)); }; }, [extracted]);
  const select = async (file?: File) => {
    controller.current?.abort(); setExtracted(null); setUrls([]); if (!file) return;
    const active = new AbortController(); controller.current = active; setBusy(true); setMessage("端末内で4コマを取り出しています。まだ送信していません。");
    try { const result = await extractVideoFrames(file, active.signal); if (!active.signal.aborted) { setExtracted(result); setMessage("送る4コマを確認してください。動画本体・音声は送信しません。"); } }
    catch (e) { if (!active.signal.aborted) setMessage((e as Error).message); }
    finally { if (!active.signal.aborted) setBusy(false); }
  };
  return <div className="space-y-2 rounded-lg border border-stone-200 p-3">
    <label className="block text-sm">手元の料理動画（100MB・20分以内）<input aria-label="手元の料理動画" type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v" className="mt-2 w-full min-h-11 text-sm" onChange={e => void select(e.target.files?.[0])} /></label>
    <p className="text-xs text-stone-600">利用できる素材を選んでください。4コマ以外の映像・音声・字幕は読み取れません。材料や手順が写らない場合は、必要な場面を写真として追加してください。</p>
    {message && <p role="status" className="text-sm">{message}</p>}
    {busy && <button type="button" className="min-h-11 rounded border px-3" onClick={() => { controller.current?.abort(); setBusy(false); setMessage("取り出しを取り消しました。送信していません。"); }}>コマの取り出しを取り消す</button>}
    <div className="grid grid-cols-2 gap-2">{urls.map((url, i) => <figure key={url}>
      {/* Local, temporary blob URLs cannot use the Next image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`送信候補のコマ${i + 1}`} className="w-full rounded" />
      <figcaption className="text-xs">{extracted?.manifest.timestamps[i].toFixed(1)}秒</figcaption>
    </figure>)}</div>
    {extracted && !busy && <button type="button" className="w-full min-h-11 rounded-lg border border-stone-300 p-3 text-sm font-bold text-emerald-900" onClick={() => { const data = new FormData(); extracted.images.forEach(file => data.append("image", file)); data.set("videoManifest", JSON.stringify(extracted.manifest)); onSubmit(data); }}>確認した4コマを送って読み取る</button>}
  </div>;
}
