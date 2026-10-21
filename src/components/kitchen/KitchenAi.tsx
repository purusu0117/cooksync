"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useKitchen } from "@/lib/kitchen/client";
import ImportedRecipePreview, { type ImportResult } from "@/components/recipes/ImportedRecipePreview";
import { usable } from "@/lib/kitchen/planning";
import { feedbackMatches, rankRecipes, mealProfile } from "@/lib/kitchen/quality";
import { showQuantity } from "@/lib/kitchen/quantity";
import { photoUploadError } from "@/lib/kitchen/limits";
import { readAiResponse } from "@/lib/kitchen/aiResponse";
import VideoFrameInput from "./VideoFrameInput";
const field = "w-full min-h-11 rounded-lg border border-stone-300 bg-white p-3 text-base";
const action = "w-full min-h-12 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-50";
interface Job { endpoint: string; id: string; owner: string; locationId: string }
export default function KitchenAi() {
  const { snapshot, locationId } = useKitchen(), state = snapshot!.state!, enabled = snapshot?.ai?.enabled;
  const searchWithinBudget = snapshot?.ai?.searchWithinBudget !== false;
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [results, setResults] = useState<ImportResult[]>([]), [job, setJob] = useState<Job | null>(null);
  const [operationId, setOperationId] = useState("");
  const [mode, setMode] = useState<"search" | "photo" | "video">("search");
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
          setResults(body.recipes ? body.recipes.map((r: ImportResult["recipe"]) => ({ recipe: r, missing: r?.readMissing || [], evidence: { kind: "research", capturedAt: new Date().toISOString() } })) : [body]);
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
    e.preventDefault();
    if (!searchWithinBudget) { setMessage("Web検索は設定された利用枠が足りないため開始できません。"); return; }
    const wish = String(new FormData(e.currentTarget).get("wish") || "");
    const now = new Date().toISOString(), current = state.lots.filter(l => usable(l, locationId, now, state.locations.find(p => p.id === locationId)?.timeZone));
    const knownRecipes = [...new Map([...state.plans.filter(p => p.locationId === locationId).map(p => p.recipe), ...state.recipes].map(r => [r.id, r])).values()];
    const savedRecipes = rankRecipes(knownRecipes, state, locationId).slice(0, 12).map(({ recipe: r, reasons }) => ({ id: r.id, name: r.name, servings: r.servings, ingredients: r.ingredients, sources: r.sources, reasons }));
    const context = { stock: current.map(l => ({ name: l.name, amount: showQuantity(l.quantity), kind: l.kind, condition: l.condition, compartment: l.compartment, storedAt: l.storedAt, expiresOn: l.expiresOn, expiryBasis: l.expiryBasis, storageMethod: l.storageMethod })), savedRecipes, equipment: state.equipment.filter(e => e.locationId === locationId), preferences: state.preferences, feedback: state.feedback.filter(f => f.active && f.locationId === locationId && knownRecipes.some(r => feedbackMatches(f, r))).map(f => ({ ...f, recipeName: knownRecipes.find(r => feedbackMatches(f, r))?.name })), recentActualMeals: state.plans.filter(p => p.locationId === locationId && ["cooked", "partial"].includes(p.status)).slice(-10).map(p => ({ name: p.name, ...mealProfile(p.recipe) })) };
    void start("/api/research", JSON.stringify({ wish: `${wish}\n参考条件（不明は補完しない。retiredRulesは廃止済みで適用禁止。保存期限は出典と条件がなければ不明。主菜・副菜・汁物を合わせた量、味付け・主食・たんぱく源の偏り、道具の容量、調理と食事・片付けの時間を別々に考慮する）：${JSON.stringify(context)}`, fridge: current.filter(l => l.kind === "raw").map(l => l.name), expiring: current.filter(l => l.expiresOn).map(l => l.name), shopMode: "buy" }), true);
  };
  return <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4"><div className="flex items-center justify-between gap-2"><h2 className="text-lg font-bold">レシピを探す・取り込む</h2><span className="text-xs text-stone-600">{enabled ? "AI利用可" : "AI停止中"}</span></div>
    {!enabled && <p className="text-sm text-amber-900">AIは現在利用できません。保存済みのレシピから献立を選べます。</p>}
    {enabled && !searchWithinBudget && <p className="text-sm text-amber-800">Web検索は設定された利用枠が足りないため開始できません。保存済みレシピは引き続き選べます。</p>}
    <fieldset disabled={!enabled || busy || !!job} className="space-y-4 disabled:opacity-60">
      <div aria-label="レシピの探し方" className="grid grid-cols-3 rounded-xl bg-stone-100 p-1">{([["search", "検索"], ["photo", "写真"], ["video", "動画"]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)} className={`min-h-11 rounded-lg text-sm font-bold ${mode === key ? "bg-white text-emerald-900 shadow-sm" : "text-stone-600"}`}>{label}</button>)}</div>
      {mode === "search" && <form className="space-y-3" onSubmit={research}><label className="block text-sm">何を作りたいですか？<input name="wish" className={field} placeholder="作り置きを使って、20分で作りたい" /></label><p className="text-xs text-stone-600">今の場所の在庫・道具・好みを使って探します。</p><button className={action} type="submit" disabled={!searchWithinBudget}>レシピを探す</button></form>}
      {mode === "photo" && <form className="space-y-3" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget), files = form.getAll("image").filter((v): v is File => v instanceof File), error = photoUploadError(files); if (error) { setMessage(error); return; } void start("/api/import-photo", form, false); }}><label className="block text-sm">レシピの写真を選ぶ<input type="file" name="image" multiple accept="image/jpeg,image/png,image/webp,image/gif" className={field} required /></label><p className="text-xs text-stone-600">4枚まで・合計3MB以内。読み取り後に確認して保存します。</p><button className={action} type="submit">写真を読み取る</button></form>}
      {mode === "video" && <div className="space-y-4"><form className="space-y-3" onSubmit={e => { e.preventDefault(); const url = new FormData(e.currentTarget).get("url"); void start("/api/import-video", JSON.stringify({ url }), true); }}><label className="block text-sm">料理動画のリンク<input type="url" name="url" className={field} placeholder="https://…" required /></label><p className="text-xs text-stone-600">取得できた説明や素材から読み取ります。映像を取得できない場合は、その状態を表示します。</p><button className={action} type="submit">リンクから読み取る</button></form><details className="border-t border-stone-200 pt-2"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold text-emerald-900">スマホに保存した動画を使う</summary><VideoFrameInput key={currentScope} onSubmit={form => void start("/api/import-photo", form, false)} /></details></div>}
    </fieldset>
    {message && <p role="status" className="rounded-lg bg-stone-50 p-3 text-sm">{message}</p>}
    {(busy || job) && <button type="button" className={field} onClick={() => void cancel()}>このAI処理を取り消す</button>}
    {results.map((result, i) => <ImportedRecipePreview key={i} result={result} onDiscard={() => setResults(results.filter((_, n) => n !== i))} />)}
    <details className="text-xs text-stone-600"><summary className="min-h-11 cursor-pointer py-2">AIの利用状況・素材について</summary><p>{snapshot?.ai?.model} / {snapshot?.ai?.environment}</p>{snapshot?.ai?.expiresAt && Number.isFinite(Date.parse(snapshot.ai.expiresAt)) && <p>AIの利用期限：{new Date(snapshot.ai.expiresAt).toLocaleString("ja-JP")}。期限後も在庫・買い物・調理記録は利用できます。</p>}<p>アップロード・参照する素材の利用条件を確認してください。リンクだけで転載許諾を確認した扱いにはしません。</p></details>
  </section>;
}
