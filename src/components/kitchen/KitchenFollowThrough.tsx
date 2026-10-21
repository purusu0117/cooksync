"use client";
import { useState } from "react";
import { useKitchen } from "@/lib/kitchen/client";
import type { Cooking, KitchenState, Plan } from "@/lib/kitchen/model";
import { showQuantity } from "@/lib/kitchen/quantity";
import { usesAtStep } from "@/lib/kitchen/equipment";
const field = "block w-full min-h-11 rounded-lg border border-stone-300 bg-white p-2 text-base";
const button = "min-h-11 rounded-lg bg-emerald-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-50";
const panel = "space-y-3 rounded-2xl bg-white p-4 ring-1 ring-stone-200";
const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export function MealSelection({ state, value, onChange }: { state: KitchenState; value: string; onChange?: (v: string) => void }) {
  const { locationId } = useKitchen();
  const options = <><option value="">食事を選ばず個別に追加</option>{state.meals?.filter(m => m.locationId === locationId).map(m => <option key={m.id} value={m.id}>{m.name} / {new Date(m.eatAt).toLocaleString("ja-JP")}</option>)}</>;
  return <label className="block text-sm">一緒に食べる献立{onChange ? <select className={field} name="mealId" value={value} onChange={e => onChange(e.target.value)}>{options}</select> : <select className={field} name="mealId" defaultValue={value}>{options}</select>}</label>;
}
export function MealManager({ state }: { state: KitchenState }) {
  const { send, locationId, busy } = useKitchen();
  return <details className={panel}><summary className="min-h-11 cursor-pointer font-bold">食事をまとめる・予定時刻</summary>
    <p className="text-sm">調理する時刻が違っても、同じ食事に主菜・副菜・汁物をまとめられます。</p>
    {state.meals?.filter(m => m.locationId === locationId).map(m => <form key={m.id} className="space-y-2 border-b pb-3" onSubmit={e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.currentTarget)); void send("meal.edit", { mealId: m.id, name: v.name, eatAt: new Date(String(v.eatAt)).toISOString() }); }}><label>食事名<input className={field} name="name" defaultValue={m.name} required /></label><label>食べる日時<input className={field} type="datetime-local" name="eatAt" defaultValue={localTime(new Date(m.eatAt))} required /></label><p className="text-sm">{state.plans.filter(p => p.mealId === m.id).map(p => p.name).join("・") || "料理はまだありません"}</p><button className={button} disabled={busy}>予定を更新</button></form>)}
    <form className="space-y-2" onSubmit={async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.currentTarget)); await send("meal.add", { name: v.name, eatAt: new Date(String(v.eatAt)).toISOString() }); }}><label>新しい食事名<input name="name" className={field} placeholder="今夜の夕食" required /></label><label>食べる日時<input name="eatAt" type="datetime-local" className={field} defaultValue={localTime(new Date())} required /></label><button className={button} disabled={busy}>食事を追加</button></form>
  </details>;
}
export function EatingPlans({ state }: { state: KitchenState }) {
  const { locationId, send, busy } = useKitchen();
  const plans = state.eatingPlans?.filter(p => p.locationId === locationId && p.status === "planned") || [];
  if (!plans.length) return null;
  return <section className={panel}><h2 className="text-lg font-bold">これから食べる予定</h2><p className="text-sm">食事後に実際に食べた量を記録します。残りは在庫に残ります。</p>{plans.map(p => <form key={p.id} className="space-y-2 border-t pt-3" onSubmit={e => { e.preventDefault(); void send("eating.complete", { eatingId: p.id, amount: new FormData(e.currentTarget).get("amount") }); }}><strong>{state.lots.find(l => l.id === p.lotId)?.name}</strong><p className="text-xs">予定 {showQuantity(p.quantity)} / {new Date(p.eatAt).toLocaleString("ja-JP")}</p><label>実際に食べた量<input className={field} name="amount" defaultValue={showQuantity(p.quantity)} required /></label><div className="flex flex-wrap gap-2"><button className={button} disabled={busy}>食べた量を記録</button><button className={button} disabled={busy} type="button" onClick={() => void send("eating.cancel", { eatingId: p.id })}>食べる予定を取消</button></div></form>)}</section>;
}
export function RecipeDrafts({ state }: { state: KitchenState }) {
  const { send, busy } = useKitchen();
  const drafts = state.recipes.filter(r => r.draft);
  if (!drafts.length) return null;
  return <section className={panel}><h2 className="text-lg font-bold">確認待ちのレシピ下書き</h2>{drafts.map(r => <details key={r.id}><summary className="min-h-11 cursor-pointer py-2 font-bold">{r.name}</summary><form className="space-y-3" onSubmit={e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.currentTarget)); const ingredients = String(v.ingredients).split("\n").filter(Boolean).map(line => { const [name, ...rest] = line.split(/[:：]/); return { name: name.trim(), amount: rest.join(":").trim() }; }); const steps = String(v.steps).split("\n").filter(Boolean).map((text, i) => ({ title: `作業${i + 1}`, text })); void send("recipe.save", { recipe: { ...r, name: v.name, ingredients, steps, draft: !ingredients.length || !steps.length }, note: "本人が下書きの材料・手順を確認して補完" }); }}><label>料理名<input className={field} name="name" defaultValue={r.name} required /></label><p className="text-xs">不明な分量は空欄で残せます。元の読取結果・欠損・出典は保持します。</p><label>材料（1行に食材：量）<textarea className={field} name="ingredients" rows={4} defaultValue={r.ingredients.map(i => `${i.name}：${i.amount}`).join("\n")} /></label><label>手順（1行に1作業）<textarea className={field} name="steps" rows={4} defaultValue={r.steps.map(s => s.text).join("\n")} /></label><button className={button} disabled={busy}>確認した内容を保存</button></form></details>)}</section>;
}
export function StepControls({ cooking, plan, state }: { cooking: Cooking; plan: Plan; state: KitchenState }) {
  const { send, busy } = useKitchen();
  const [selected, setSelected] = useState(0);
  if (!plan.equipmentUsage?.some(u => u.fromStep !== undefined)) return null;
  const active = cooking.activeStep;
  return <section className="space-y-3 rounded-xl bg-emerald-50 p-3"><h3 className="font-bold">工程と道具の使用</h3><p className="text-xs">工程を開始して道具を確保します。複数工程にまたがる道具は、指定した終了工程まで確保します。チェック済みへの変更だけでは道具の確保を変更しません。</p>{active === undefined ? <><label>始める工程<select className={field} value={selected} onChange={e => setSelected(Number(e.target.value))}>{cooking.steps.map((s, i) => <option key={i} value={i}>{i + 1}. {s.title}{cooking.checked.includes(i) ? "（確認済み）" : ""}</option>)}</select></label><button className={button} disabled={busy} onClick={() => void send("cook.step.start", { cookingId: cooking.id, step: selected })}>この工程を開始</button></> : <><p>実行中：{active + 1}. {cooking.steps[active].title}</p><p className="text-sm">使用中：{plan.equipmentUsage.filter(u => usesAtStep(u, active)).map(u => state.equipment.find(t => t.id === u.equipmentId)?.name).join("、") || "登録された道具なし"}</p><button className={button} disabled={busy} onClick={() => void send("cook.step.finish", { cookingId: cooking.id, step: active })}>工程を終了（道具は指定した終了工程で解放）</button></>}</section>;
}
