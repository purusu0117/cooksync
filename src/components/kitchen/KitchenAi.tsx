"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useKitchen } from "@/lib/kitchen/client";
import ImportedRecipePreview, { type ImportResult } from "@/components/recipes/ImportedRecipePreview";
import { usable } from "@/lib/kitchen/planning";
import { feedbackMatches } from "@/lib/kitchen/quality";
import { showQuantity } from "@/lib/kitchen/quantity";
import { photoUploadError } from "@/lib/kitchen/limits";
import { readAiResponse } from "@/lib/kitchen/aiResponse";
import VideoFrameInput from "./VideoFrameInput";
const field = "w-full min-h-11 rounded-lg border border-stone-300 bg-white p-3 text-sm";
interface Job { endpoint: string; id: string; owner: string; locationId: string }
export default function KitchenAi() {
  const { snapshot, locationId } = useKitchen(), state = snapshot!.state!, enabled = snapshot?.ai?.enabled;
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [results, setResults] = useState<ImportResult[]>([]), [job, setJob] = useState<Job | null>(null);
  const [operationId, setOperationId] = useState("");
  const cancelled = useRef(false);
  const scope = useRef(`${state.owner}:${locationId}`), currentScope = `${state.owner}:${locationId}`;
  useEffect(() => { scope.current = currentScope; return () => { scope.current = "unmounted"; }; }, [currentScope]);
  const jobKey = `cooksync:kitchen:aiJob:${state.owner}:${locationId}`;
  useEffect(() => {
    let stored: Job | null = null; try { stored = JSON.parse(localStorage.getItem(jobKey) || "null"); } catch { /* malformed cache */ }
    let preview: ImportResult[] = []; try { const value = JSON.parse(localStorage.getItem(`${jobKey}:preview`) || "[]"); if (Array.isArray(value)) preview = value; } catch { /* malformed cache */ }
    const timer = setTimeout(() => { if (stored && stored.owner === state.owner && stored.locationId === locationId) setJob(stored); if (preview.length) { setResults(preview); setMessage("読み取り結果です。出典・欠損・分量を確認して保存してください。"); localStorage.removeItem(`${jobKey}:preview`); } }, 0);
    return () => clearTimeout(timer);
  }, [jobKey, state.owner, locationId]);
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`${job.endpoint}?jobId=${encodeURIComponent(job.id)}&locationId=${encodeURIComponent(job.locationId)}`, { signal: controller.signal, cache: "no-store", headers: { "x-cooksync-owner": job.owner } });
        const body = await readAiResponse(response);
        if (body.status === "cancelled") { setJob(null); setBusy(false); setMessage(body.error); localStorage.removeItem(jobKey); return; }
        if (body.status === "error" || body.status === "missing") localStorage.removeItem(jobKey);
        if (!response.ok || body.status === "error" || body.status === "missing") throw new Error(body.error || "処理結果が見つかりません。再開前に履歴を確認してください");
        if (body.status === "done" && !cancelled.current) {
          setResults(body.recipes ? body.recipes.map((r: ImportResult["recipe"]) => ({ recipe: r, evidence: { kind: "research", capturedAt: new Date().toISOString() } })) : [body]);
          setMessage("読み取り結果です。出典・欠損・分量を確認して保存してください。"); setJob(null); setBusy(false); localStorage.removeItem(jobKey); return;
        }
        setMessage(body.step || "処理中です。完了しても在庫や献立には自動反映しません。");
        timer = setTimeout(poll, 3000);
      } catch (e) { if (!controller.signal.aborted) { setMessage((e as Error).message); setBusy(false); setJob(null); } }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [job, jobKey]);
  const start = async (endpoint: string, body: BodyInit, json: boolean) => {
    if (!enabled || busy || job) return;
    localStorage.removeItem(jobKey);
    setBusy(true); setResults([]); setMessage("処理を開始しています…"); const captured = currentScope;
    const operation = crypto.randomUUID(); setOperationId(operation); cancelled.current = false;
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "x-cooksync-owner": state.owner, "x-cooksync-location-id": locationId, "x-cooksync-operation-id": operation, ...(json ? { "content-type": "application/json" } : {}) }, body });
      if (response.status === 413) throw new Error("送信容量が大きすぎます。写真は合計3MB以内にしてください");
      const value = await readAiResponse(response); if (!response.ok) throw new Error(value.error || "処理を開始できませんでした");
      if (cancelled.current) return;
      if (value.jobId) { const pending = { endpoint, id: value.jobId, owner: state.owner, locationId }; localStorage.setItem(jobKey, JSON.stringify(pending)); if (scope.current === captured) setJob(pending); }
      else if (scope.current !== captured) { localStorage.setItem(`${jobKey}:preview`, JSON.stringify([value])); return; }
      else { setResults([value]); setBusy(false); setMessage("読み取れなかった量は不明のままです。保存前に確認してください。"); }
    } catch (e) { if (scope.current === captured) { setMessage((e as Error).message); setBusy(false); } }
  };
  const cancel = async () => {
    const id = job?.id || operationId; if (!id) return;
    try {
      const response = await fetch(`/api/kitchen/ai-job?jobId=${encodeURIComponent(id)}&locationId=${encodeURIComponent(locationId)}`, { method: "DELETE", headers: { "x-cooksync-owner": state.owner } });
      const value = await readAiResponse(response); if (!response.ok) throw new Error(value.error);
      cancelled.current = true; setJob(null); setBusy(false); setResults([]); localStorage.removeItem(jobKey);
      setMessage("取消を記録しました。結果は保存しません。実行済みの費用は照合まで保持します。");
    } catch (e) { setMessage((e as Error).message); }
  };
  const research = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const wish = String(new FormData(e.currentTarget).get("wish") || "");
    const now = new Date().toISOString(), current = state.lots.filter(l => usable(l, locationId, now, state.locations.find(p => p.id === locationId)?.timeZone));
    const context = { stock: current.map(l => ({ name: l.name, amount: showQuantity(l.quantity), kind: l.kind, condition: l.condition, compartment: l.compartment })), equipment: state.equipment.filter(e => e.locationId === locationId), preferences: state.preferences, feedback: state.feedback.filter(f => f.active && f.locationId === locationId && [...state.recipes, ...state.plans.filter(p => p.locationId === locationId).map(p => p.recipe)].some(r => feedbackMatches(f, r))), recentActualMeals: state.plans.filter(p => p.locationId === locationId && ["cooked", "partial"].includes(p.status)).slice(-10).map(p => p.name) };
    void start("/api/research", JSON.stringify({ wish: `${wish}\n参考条件（不明は補完しない。retiredRulesは廃止済みで適用禁止。保存期限は出典と条件がなければ不明。主菜・副菜・汁物を合わせた量、味付け・主食・たんぱく源の偏り、道具の容量、調理と食事・片付けの時間を別々に考慮する）：${JSON.stringify(context)}`, fridge: current.filter(l => l.kind === "raw").map(l => l.name), expiring: current.filter(l => l.expiresOn).map(l => l.name), shopMode: "buy" }), true);
  };
  return <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4"><h2 className="text-lg font-bold">新しい候補・写真・動画</h2>
    <p className="text-sm text-stone-600">{enabled ? `${snapshot.ai!.model} / ${snapshot.ai!.environment}。選択した場所の条件で処理します。` : "AI接続は停止中です。対象組織・残高・キーの所属・費用上限を確認してから利用できます。"}</p>
    <fieldset disabled={!enabled || busy || !!job} className="space-y-4 disabled:opacity-60">
      <form className="space-y-2" onSubmit={research}><label className="block text-sm">作りたい料理・今の予定<input name="wish" className={field} placeholder="作り置きを使って、20分で作りたい" /></label><button className={`${field} font-bold text-emerald-900`} type="submit">在庫・道具・感想を使って候補を探す</button></form>
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget), files = form.getAll("image").filter((v): v is File => v instanceof File), error = photoUploadError(files); if (error) { setMessage(error); return; } void start("/api/import-photo", form, false); }}><label className="block text-sm">レシピの写真（4枚まで、合計3MB以内）<input type="file" name="image" multiple accept="image/jpeg,image/png,image/webp,image/gif" className={field} required /></label><button className={`${field} font-bold text-emerald-900`} type="submit">写真を読み取る</button></form>
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); const url = new FormData(e.currentTarget).get("url"); void start("/api/import-video", JSON.stringify({ url }), true); }}><label className="block text-sm">公開されている料理動画のURL<input type="url" name="url" className={field} required /></label><button className={`${field} font-bold text-emerald-900`} type="submit">取得できた素材から読み取る</button></form>
      <VideoFrameInput key={currentScope} onSubmit={form => void start("/api/import-photo", form, false)} />
    </fieldset>
    {message && <p role="status" className="rounded-lg bg-stone-50 p-3 text-sm">{message}</p>}
    {(busy || job) && <button type="button" className={field} onClick={() => void cancel()}>このAI処理を取り消す</button>}
    {results.map((result, i) => <ImportedRecipePreview key={i} result={result} onDiscard={() => setResults(results.filter((_, n) => n !== i))} />)}
    <p className="text-xs text-stone-500">アップロード・参照する素材の利用条件を確認してください。リンクだけで転載許諾を確認した扱いにはしません。</p>
  </section>;
}
