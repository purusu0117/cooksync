"use client";
import { useState } from "react";
import { useKitchen } from "@/lib/kitchen/client";
interface Preview { digest: string; sourceRevision: number; locations: string[]; lots: number; plans: number; transactions: number; canCopy: boolean }
export default function VerifiedDeviceCopy() {
  const { snapshot, refresh } = useKitchen();
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  if (snapshot?.needsSession || snapshot?.isGuest) return null;
  const run = async (copy: boolean) => {
    if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch(copy ? "/api/kitchen" : "/api/kitchen?device-copy=1", { method: copy ? "POST" : "GET", cache: "no-store", headers: copy ? { "content-type": "application/json" } : undefined, body: copy ? JSON.stringify({ action: "copy-device-to-account", owner: snapshot?.owner, digest: preview?.digest }) : undefined });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (copy) { setPreview(null); await refresh(); } else setPreview(body);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <details className="space-y-3 rounded-xl border border-stone-200 p-3"><summary className="min-h-11 cursor-pointer font-bold">この端末の在庫をアカウントへコピー</summary><p className="text-sm">端末とアカウント両方のログイン情報をサーバーで確認します。空のアカウントへ全量をコピーし、端末の原本・ID・履歴を残します。コピー後の別々の変更は自動結合しません。</p><button type="button" disabled={busy} className="min-h-11 rounded-lg border p-2" onClick={() => void run(false)}>コピー元と件数を確認</button>{error && <p role="alert" className="text-sm text-amber-900">{error}</p>}{preview && <div className="space-y-2 text-sm"><p>{preview.locations.join("、")}：在庫{preview.lots}件、献立{preview.plans}件、履歴{preview.transactions}件 / 確認版{preview.sourceRevision}</p>{preview.canCopy ? <button type="button" disabled={busy} className="min-h-11 rounded-lg bg-emerald-800 p-2 text-white" onClick={() => void run(true)}>確認した内容を空のアカウントへコピー</button> : <p>アカウントにデータがあります。上書きは行いません。</p>}</div>}</details>;
}
