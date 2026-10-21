"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useKitchen } from "@/lib/kitchen/client";
import { useAllRecipes } from "@/lib/useStore";
import type { Cooking, KitchenState, Lot, Plan, ShoppingRow } from "@/lib/kitchen/model";
import { requirements, ingredientId, remainingDemand, usable } from "@/lib/kitchen/planning";
import { evidencedWeight, format, parseQuantity, positive, remainingLabel, showQuantity } from "@/lib/kitchen/quantity";
import { packageSuggestion } from "@/lib/kitchen/engine";
import type { Recipe } from "@/lib/recipe";
import KitchenAi from "./KitchenAi";
import { rankRecipes, feedbackMatches } from "@/lib/kitchen/quality";
import DeviceImport from "./DeviceImport";
import VerifiedDeviceCopy from "./VerifiedDeviceCopy";
import StorageGuidance from "./StorageGuidance";
import { operationSummary } from "@/lib/kitchen/operationSummary";
import { videoEvidenceLabel } from "@/lib/kitchen/videoFrames";
import { MealSelection, MealManager, EatingPlans, RecipeDrafts, StepControls } from "./KitchenFollowThrough";

type Tab = "plans" | "shopping" | "inventory" | "settings" | "history";
const inputClass = "w-full min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 focus:outline-2 focus:outline-emerald-700";
function Button({ children, onClick, type = "button", secondary = false, disabled = false }: { children: ReactNode; onClick?: () => void; type?: "button" | "submit"; secondary?: boolean; disabled?: boolean }) {
  const { busy } = useKitchen();
  return <button type={type} disabled={disabled || busy} onClick={onClick} className={`min-h-11 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50 ${secondary ? "border border-stone-300 bg-white text-stone-800" : "bg-emerald-800 text-white"}`}>{children}</button>;
}
function Field({ label, name, value, type = "text", placeholder, required = false }: { label: string; name: string; value?: string; type?: string; placeholder?: string; required?: boolean }) { return <label className="block space-y-1 text-sm text-stone-700"><span>{label}</span><input name={name} defaultValue={value} type={type} placeholder={placeholder} required={required} className={inputClass} /></label>; }
function Zone({ name = "compartment", value = "冷蔵" }: { name?: string; value?: string }) { return <label className="block space-y-1 text-sm"><span>保存区画</span><select name={name} defaultValue={value} className={inputClass}>{["冷蔵", "冷凍", "常温", "未確認"].map(z => <option key={z}>{z}</option>)}</select></label>; }
function Values(event: FormEvent<HTMLFormElement>) { event.preventDefault(); return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>; }
function Sheet({ title, children }: { title: string; children: ReactNode }) { return <section className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-stone-200"><h2 className="text-lg font-bold text-stone-900">{title}</h2>{children}</section>; }
function Details({ title, children }: { title: string; children: ReactNode }) { return <details className="border-t border-stone-200 pt-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold text-emerald-900">{title}</summary><div className="space-y-3 pb-2">{children}</div></details>; }
const localTime = (value = new Date()) => new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function KitchenScreen({ initialTab = "plans", recipeId }: { initialTab?: Tab; recipeId?: string }) {
  const api = useKitchen();
  const [tab, setTab] = useState<Tab>(initialTab);
  const state = api.snapshot?.state;
  if (!api.snapshot) return <div className="p-6" role="status">在庫を確認しています…{api.error && <p>{api.error}</p>}</div>;
  return <div className="mx-auto max-w-2xl space-y-5 px-4 py-5 pb-12 text-stone-800">
    <header><h1 className="text-2xl font-bold">今日の台所</h1><p className="mt-1 text-sm text-stone-600">献立から、買い物、調理、残りの保存まで。</p></header>
    {api.error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{api.error}</p>}
    {api.notice && <p role="status" className="text-sm text-emerald-800">{api.notice}</p>}
    {api.busy && <p role="status" className="text-sm">保存中です…</p>}
    {api.pending && !api.busy && <Sheet title={`保存待ちの操作：${api.pendingCount}件`}><p className="text-sm">表示には保留操作を含みます。通信復帰後は同じ操作IDで順番に保存します。別端末で更新されていた場合は変更内容を確認できます。</p><div className="flex flex-wrap gap-2"><Button onClick={() => void api.retry()}>同じ操作の結果を確認</Button><Button secondary onClick={() => void api.reviewPending()}>最新の在庫と照合</Button><Button secondary onClick={() => void api.dismissPending()}>送信結果を照合して保留を解除</Button></div>{api.review && <div className="space-y-2"><p className="font-bold">最新データに適用した場合の変更</p>{api.review.changes.map((c, i) => <p key={i} className="text-sm">{c}</p>)}<details><summary className="min-h-11 cursor-pointer">保留操作の内容</summary><ul className="space-y-3 text-sm">{api.review.queue.map(v => <li key={v.command.id}>{operationSummary(state, v.command).map((line, i) => <p className="break-words" key={i}>{line}</p>)}</li>)}</ul></details><Button onClick={() => void api.confirmPending()}>この変更内容で再送</Button></div>}</Sheet>}
    {!state ? <Sheet title="残量をつなげて管理する">
      <VerifiedDeviceCopy />
      {api.snapshot.isGuest && <DeviceImport />}
      {api.snapshot.needsSession ? <><p>既存データを引き継ぐ場合は、先に利用中のアカウントへログインしてください。旧端末の未ログイン在庫は、そのまま残ります。</p><Link className="block text-emerald-900 underline" href="/mypage">ログインを確認</Link><Button onClick={() => void api.guest()}>この端末で新しく始める</Button></> : <><p className="text-sm">既存の在庫と買い物を「いつもの場所」へコピーします。旧データと履歴は保存されます。開始後は、新しい画面から購入・調理を記録します。</p><ul className="text-sm">{Object.entries(api.snapshot.legacyCounts || {}).filter(([, n]) => n).map(([key, n]) => <li key={key}>{key.includes("shopping") ? "買い物" : key.includes("meals") ? "過去の献立（履歴保管）" : "在庫"}：{n}件</li>)}</ul><Button onClick={() => void api.activate()}>内容を引き継いで開始</Button></>}
    </Sheet> : <>
      <label className="block rounded-2xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-950">今使っている場所<select aria-label="今使っている場所" className={`${inputClass} mt-1 border-emerald-700/30`} value={api.locationId} onChange={e => api.chooseLocation(e.target.value)}>{state.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <nav aria-label="台所の作業" className="flex flex-wrap gap-2">{([["plans", "献立・調理"], ["shopping", "買い物"], ["inventory", "残り・保存"], ["settings", "場所・道具"], ["history", "履歴"]] as const).map(([key, label]) => <button key={key} onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined} className={`min-h-11 rounded-full px-3 text-sm ${tab === key ? "bg-emerald-800 font-bold text-white" : "bg-white ring-1 ring-stone-200"}`}>{label}</button>)}</nav>
      <div key={`${state.owner}:${api.locationId}:${tab}`}>
        {tab === "plans" && <Plans state={state} recipeId={recipeId} />}
        {tab === "shopping" && <Shopping state={state} />}
        {tab === "inventory" && <Inventory state={state} />}
        {tab === "settings" && <Settings state={state} />}
        {tab === "history" && <History state={state} />}
      </div>
      <p className="text-xs text-stone-500">{api.snapshot.ai?.enabled ? "AI提案は確認してから使います。数量と在庫は計算処理で管理します。" : "AI提案は接続・利用費用の確認待ちです。保存済みレシピと数量計算は利用できます。"}</p>
    </>}
  </div>;
}

function Inventory({ state }: { state: KitchenState }) {
  const { locationId, send } = useKitchen();
  const lots = state.lots.filter(l => l.locationId === locationId && (!l.quantity || positive(l.quantity.value)));
  return <div className="space-y-5"><Sheet title="残っているもの">
    {!lots.length && <p className="text-sm">食材を追加すると、この場所の残量から献立を考えられます。</p>}
    {lots.map(l => <LotRow key={l.id} lot={l} state={state} />)}
    <Details title="食材・作り置きを追加"><form className="space-y-3" onSubmit={async e => { const p = Values(e); await send("lot.add", p); }}>
      <Field label="名前" name="name" required placeholder="白菜" /><Field label="今ある量（不明なら空欄）" name="amount" placeholder="1/4玉" />
      <label className="block text-sm">種類<select name="kind" className={inputClass}><option value="raw">未調理の食材</option><option value="prepared">作り置き</option></select></label>
      <Zone /><Field label="状態" name="condition" placeholder="切りかけ・開封済みなど" />
      <Field label="期限（確認できた場合）" name="expiresOn" type="date" /><Field label="期限の根拠" name="expiryBasis" placeholder="包装の表示、確認した保存条件など" />
      <Button type="submit">今ある量を登録</Button>
    </form></Details>
  </Sheet></div>;
}
function LotRow({ lot: l, state }: { lot: Lot; state: KitchenState }) {
  const { send } = useKitchen();
  return <article className="border-t border-stone-200 pt-3 first:border-0 first:pt-0">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{l.name}</h3><p className="text-xs text-stone-600">{l.kind === "prepared" ? "作り置き" : "食材"} / {l.compartment} / {l.condition}</p></div><strong className="shrink-0 text-lg">{showQuantity(l.quantity)}</strong></div>
    {l.presence !== "ある" && <p className="text-sm text-amber-900">{l.presence}（使用可能な在庫には含めません）</p>}
    <p className="mt-1 text-xs text-stone-500" title={l.id}>ロット {state.lots.findIndex(v => v.id === l.id) + 1}{l.cookedAt ? ` / 作成 ${new Date(l.cookedAt).toLocaleString("ja-JP")}` : ""}</p>
    {l.storageMethod && <p className="mt-2 text-sm">保存記録：{l.storageMethod}</p>}
    <p className="mt-1 text-xs text-stone-600">{l.expiresOn ? `期限 ${l.expiresOn} / ${l.expiryBasis || "根拠未確認"}` : "期限は未確認"}。日数だけで安全とは判断しません。</p>
    <StorageGuidance conditions={l} />
    <Details title="残量・保存先を確認／変更"><form className="space-y-3" onSubmit={async e => { const p = Values(e); if (!p.amount) delete p.amount; if (!p.weightGrams) delete p.weightGrams; await send("lot.update", { ...p, lotId: l.id, lotRevision: l.revision }); }}>
      <Field label="今の残量" name="amount" value={l.quantity ? showQuantity(l.quantity) : ""} />
      <label className="block text-sm">確認状態<select name="presence" defaultValue={l.presence} className={inputClass}>{["ある", "ない", "見当たらない", "未確認"].map(v => <option key={v}>{v}</option>)}</select></label>
      <label className="block text-sm">場所<select name="targetLocationId" defaultValue={l.locationId} className={inputClass}>{state.locations.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <Zone value={l.compartment} /><Field label="開封・解凍などの状態" name="condition" value={l.condition} /><Field label="実際の保存方法" name="storageMethod" value={l.storageMethod} />
      <Field label="期限" name="expiresOn" type="date" value={l.expiresOn} /><Field label="期限の根拠" name="expiryBasis" value={l.expiryBasis} />
      <Details title="この残量の重量を登録"><p className="text-xs">量と重さの対応が確認できる場合だけ登録します。空欄のままなら重量の併記はしません。</p><Field label="今の残量全体の重さ" name="weightGrams" placeholder="300g" /><Field label="重さの根拠" name="weightBasis" placeholder="はかりで計量" /><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="weightEstimated" />実測ではなく根拠のある推定</label></Details>
      <Button type="submit">残量・保存先を更新</Button>
    </form></Details>
    {l.kind === "prepared" && <Details title="食べる予定を登録"><form className="space-y-3" onSubmit={async e => { const v = Values(e); await send("eating.plan", { lotId: l.id, amount: v.amount, eatAt: new Date(v.eatAt).toISOString() }); }}><Field label="食べる予定量" name="amount" required /><Field label="食べる予定日時" name="eatAt" type="datetime-local" value={localTime()} required /><Button type="submit">食べる予定を保存</Button></form></Details>}
    {l.kind === "prepared" && <Details title="食べた量を記録"><form className="space-y-3" onSubmit={async e => { await send("lot.eat", { ...Values(e), lotId: l.id }); }}><Field label="食べた量" name="amount" required /><Button type="submit">食べた量を確定</Button></form></Details>}
    <Details title="捨てた量を記録"><form className="space-y-3" onSubmit={async e => { await send("lot.discard", { ...Values(e), lotId: l.id }); }}><Field label="捨てた量" name="amount" required /><Field label="理由" name="reason" /><Button type="submit" secondary>廃棄を記録</Button></form></Details>
  </article>;
}

function Shortages({ state }: { state: KitchenState }) {
  const { locationId } = useKitchen();
  const rows = requirements(state, locationId);
  const copy = () => navigator.clipboard.writeText(rows.map(r => `${r.name}：必要${showQuantity(r.quantity)} / 不足${showQuantity(r.shortage)} / 未購入リスト${showQuantity(r.ordered)} / 追加${showQuantity(r.toAdd)}`).join("\n"));
  return <Sheet title="献立全体で足りない量">
    {!rows.length && <p className="text-sm">献立を追加すると、必要量をまとめて計算します。</p>}
    {rows.map((r, i) => <div key={i} className="border-b border-stone-100 pb-2 last:border-0"><div className="flex justify-between gap-2"><strong>{r.name}</strong><span>不足 {showQuantity(r.shortage)}</span></div><p className="text-xs text-stone-600">必要 {showQuantity(r.quantity)} / 未購入リスト {showQuantity(r.ordered)} / 追加 {showQuantity(r.toAdd)}</p>{r.warnings.map(w => <p key={w} className="text-xs text-amber-900">{w}</p>)}</div>)}
    {!!rows.length && <Button secondary onClick={() => void copy()}>不足量をコピー</Button>}
  </Sheet>;
}
function Shopping({ state }: { state: KitchenState }) {
  const { locationId, send } = useKitchen();
  const rows = state.shopping.filter(r => r.locationId === locationId && !r.purchasedBy && !r.archived);
  return <div className="space-y-5"><Shortages state={state} /><Button onClick={() => void send("shopping.recalculate", {})}>不足分を買い物に反映</Button>
    <Sheet title="お店で買うもの"><p className="text-sm text-stone-600">予定を編集しても在庫は増えません。店で選んだ実際の量を購入確定します。</p>
      {!rows.length && <p>買い物項目はありません。</p>}
      {rows.map(r => <PurchaseRow key={r.id} row={r} state={state} />)}
      <Details title="自分で項目を追加"><form className="space-y-3" onSubmit={async e => { await send("shopping.add", Values(e)); }}><Field label="食材名" name="name" required /><Field label="購入予定量（不明なら空欄）" name="amount" /><Button type="submit">買い物に追加</Button></form></Details>
    </Sheet>
  </div>;
}
function PurchaseRow({ row: r, state }: { row: ShoppingRow; state: KitchenState }) {
  const { send } = useKitchen();
  const [amount, setAmount] = useState(r.quantity ? showQuantity(r.quantity) : ""), [product, setProduct] = useState(r.product), [store, setStore] = useState(r.store), [contents, setContents] = useState(r.packageContents ? showQuantity(r.packageContents) : ""), [unit, setUnit] = useState(r.packageUnit || "袋"), [remember, setRemember] = useState(true), [zone, setZone] = useState("冷蔵");
  const profiles = state.packages.filter(p => p.active && p.ingredient === r.ingredient && (!product || p.product === product) && (!store || p.store === store));
  const contentsQ = parseQuantity(contents), need = r.quantity;
  const suggestion = need && contentsQ ? packageSuggestion(need, contentsQ) : null;
  const payload = () => ({ shoppingId: r.id, amount, product, store, contents, packageUnit: unit, remember, compartment: zone });
  return <article className="space-y-3 border-t border-stone-200 pt-4">
    <h3 className="font-bold">{r.name} <span className="text-xs font-normal text-stone-600">{r.source === "manual" ? "手動追加" : ""}</span></h3>
    <label className="block text-sm">実際に買う量<input aria-label={`${r.name}の購入量`} className={inputClass} value={amount} onChange={e => setAmount(e.target.value)} placeholder="3本" /></label>
    <div className="grid grid-cols-2 gap-2"><label className="text-sm">1包装の入数<input aria-label={`${r.name}の1包装の入数`} className={inputClass} placeholder="3本" value={contents} onChange={e => setContents(e.target.value)} /></label><label className="text-sm">包装の単位<input aria-label={`${r.name}の包装単位`} className={inputClass} value={unit} onChange={e => setUnit(e.target.value)} /></label></div>
    {suggestion && <button className="min-h-11 w-full rounded-lg bg-emerald-50 p-3 text-left text-sm text-emerald-950" onClick={() => setAmount(showQuantity(suggestion.actual))}>必要分なら {format(suggestion.count)}{unit}・{showQuantity(suggestion.actual)} にする</button>}
    {!!profiles.length && <div className="space-y-2 text-sm"><p>覚えている包装から選ぶ</p>{profiles.map(p => { const next = need ? packageSuggestion(need, p.contents) : null; return <button key={p.id} className="block min-h-11 w-full rounded-lg border border-stone-200 p-2 text-left" onClick={() => { setContents(showQuantity(p.contents)); setUnit(p.unit); setProduct(p.product); setStore(p.store); if (next) setAmount(showQuantity(next.actual)); }}>{p.product || "商品未指定"} / {p.store || "店未指定"}：{showQuantity(p.contents)}入り{next ? ` → ${format(next.count)}${p.unit}` : ""}</button>; })}</div>}
    <Details title="商品・店・保存先"><label className="block text-sm">商品（任意）<input className={inputClass} value={product} onChange={e => setProduct(e.target.value)} /></label><label className="block text-sm">店（任意）<input className={inputClass} value={store} onChange={e => setStore(e.target.value)} /></label><label className="block text-sm">入庫先の区画<select className={inputClass} value={zone} onChange={e => setZone(e.target.value)}>{["冷蔵", "冷凍", "常温", "未確認"].map(z => <option key={z}>{z}</option>)}</select></label></Details>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />この商品の入数を覚える</label>
    <div className="flex flex-wrap gap-2"><Button secondary onClick={() => void send("shopping.edit", payload())}>予定を保存</Button><Button onClick={() => void send("shopping.purchase", payload())}>購入を確定して入庫</Button></div>
  </article>;
}

function Plans({ state, recipeId }: { state: KitchenState; recipeId?: string }) {
  const { locationId, send } = useKitchen();
  const recipes = useAllRecipes().filter(r => !r.draft);
  const [selected, setSelected] = useState(recipeId || recipes[0]?.id || "");
  const [cookAt, setCookAt] = useState(localTime());
  const [mealId, setMealId] = useState("");
  const selectedRecipe = recipes.find(r => r.id === selected);
  const plans = state.plans.filter(p => p.locationId === locationId && ["planned", "partial"].includes(p.status));
  const prepared = state.lots.filter(l => l.kind === "prepared" && usable(l, locationId, new Date().toISOString(), state.locations.find(p => p.id === locationId)?.timeZone)).sort((a, b) => (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999"));
  const ranked = rankRecipes(recipes, state, locationId);
  return <div className="space-y-5">
    <MealManager state={state} />
    <EatingPlans state={state} />
    <RecipeDrafts state={state} />
    {!!prepared.length && <Sheet title="作り置きを次の一皿へ">{prepared.map(l => <PreparedPlan key={l.id} lot={l} cookAt={cookAt} />)}</Sheet>}
    <Sheet title="保存済みレシピから選ぶ"><p className="text-sm text-stone-600">実際に作った献立と有効な感想を使って候補を並べます。主菜を替えるときは、副菜を含めた全量も確認してください。</p>
      <label className="block text-sm">料理<select className={inputClass} value={selected} onChange={e => setSelected(e.target.value)}>{ranked.map(({recipe: r}) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      {!!ranked.find(r => r.recipe.id === selected)?.reasons.length && <p className="text-xs text-stone-600">{ranked.find(r => r.recipe.id === selected)!.reasons.join("、")}</p>}
      {selectedRecipe && <p className="text-sm">{selectedRecipe.servings > 0 ? `${selectedRecipe.servings}人分` : "人数未確認"} / 調理時間 {selectedRecipe.cookMinutes !== undefined ? `${selectedRecipe.cookMinutes}分` : selectedRecipe.tags.cookTime ? `${selectedRecipe.tags.cookTime}分程度（分類の目安）` : "未確認"}{selectedRecipe.sideDishes?.length ? ` / 副菜候補：${selectedRecipe.sideDishes.join("、")}` : ""}</p>}
      {selectedRecipe && <Details title="材料・手順・出典を確認"><ul className="space-y-1 text-sm">{selectedRecipe.ingredients.map((i, n) => <li key={n}>{i.name}：{i.amount || "量不明"}</li>)}</ul><ol className="space-y-2 text-sm">{selectedRecipe.steps.map((s, i) => <li key={i}><strong>{s.title}</strong><p>{s.text}</p></li>)}</ol><RecipeEvidence recipe={selectedRecipe} /></Details>}
      <label className="block text-sm">調理する日時<input className={inputClass} type="datetime-local" value={cookAt} onChange={e => setCookAt(e.target.value)} /></label>
      <MealSelection state={state} value={mealId} onChange={setMealId} />
      <Button disabled={!selectedRecipe || !cookAt} onClick={() => selectedRecipe && void send("plan.add", { recipe: selectedRecipe, mealId, cookAt: new Date(cookAt).toISOString() })}>献立に追加</Button>
      <Details title="新しい料理を自分で追加"><CustomPlan cookAt={cookAt} /></Details>
    </Sheet>
    <Shortages state={state} />
    {plans.map(p => { const c = state.cooking.find(c => c.planId === p.id && !c.completedBy); return c ? <CookingPanel key={c.id} cooking={c} plan={p} state={state} /> : <PlanPanel key={p.id} plan={p} state={state} />; })}
    <KitchenAi />
  </div>;
}
function CustomPlan({ cookAt, prepared }: { cookAt: string; prepared?: Lot }) {
  const { send } = useKitchen();
  return <form className="space-y-3" onSubmit={async e => {
    const p = Values(e), lines = p.materials.split("\n").filter(Boolean).map(line => { const [name, ...amount] = line.split(/[:：]/); return { name: name.trim(), amount: amount.join(":").trim() }; });
    if (prepared) lines.unshift({ name: prepared.name, amount: p.preparedAmount });
    const r: Recipe = { id: crypto.randomUUID(), name: p.name, emoji: "🍳", catch: "本人が入力した料理", servings: 0, ingredients: lines.map((d, i) => ({ ...d, inventoryKind: prepared && i === 0 ? "prepared" : "raw" })), steps: p.steps.split("\n").filter(Boolean).map((text, i) => ({ title: `作業${i + 1}`, text })), tags: {}, sources: [], leftoverStorage: [], createdAt: Date.now() };
    await send("plan.add", { recipe: r, saveRecipe: true, cookAt: new Date(cookAt).toISOString(), demands: lines.map((d, i) => ({ ...d, ...(prepared && i === 0 ? { kind: "prepared", lotId: prepared.id } : {}) })) });
  }}>
    <Field label="料理名" name="name" required placeholder={prepared ? `${prepared.name}のグラタン` : "料理名"} />
    {prepared && <Field label={`${prepared.name}を使う量`} name="preparedAmount" required value={showQuantity(prepared.quantity)} />}
    <label className="block text-sm">{prepared ? "追加する材料" : "材料と必要量"}（1行に「食材：量」）<textarea name="materials" className={inputClass} rows={4} placeholder="にんじん：1本" /></label>
    <label className="block text-sm">手順（1行に1作業）<textarea name="steps" className={inputClass} rows={4} required /></label><Button type="submit">この料理を献立に追加</Button>
  </form>;
}
function PreparedPlan({ lot, cookAt }: { lot: Lot; cookAt: string }) {
  return <div className="border-b border-stone-100 pb-3"><strong>{lot.name} {showQuantity(lot.quantity)}</strong><p className="text-xs text-stone-600">{lot.compartment} / {lot.storageMethod || "保存方法未確認"} / {lot.expiresOn ? `期限 ${lot.expiresOn}（${lot.expiryBasis || "根拠未確認"}）` : "期限未確認"}</p><Details title="そのまま食べる・別の料理に使う"><p className="text-sm">パスタに合わせるほか、グラタンなど別の料理にも使えます。使う量と追加材料、実際の手順を確認してください。元の原材料はもう一度減算しません。</p><CustomPlan prepared={lot} cookAt={cookAt} /></Details></div>;
}
function PlanPanel({ plan: p, state }: { plan: Plan; state: KitchenState }) {
  const { send } = useKitchen();
  const recipes = useAllRecipes().filter(r => !r.draft);
  return <Sheet title={p.name}>{p.mealId && <p className="text-sm font-bold text-emerald-900">{state.meals?.find(m => m.id === p.mealId)?.name}</p>}<p className="text-sm">{new Date(p.cookAt).toLocaleString("ja-JP")} / {p.status === "partial" ? "一部調理済み" : "まだ作っていません"}</p>
    <ul className="space-y-1 text-sm">{p.demands.map((d, i) => <li key={i}>{d.name}：{showQuantity(d.quantity)}</li>)}</ul>
    <RecipeEvidence recipe={p.recipe} />
    {p.reviewNeeded && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">{p.reviewNeeded}</p>}
    {p.status === "planned" && <Details title="料理を差し替える"><form className="space-y-3" onSubmit={async e => { const v = Values(e), recipe = recipes.find(r => r.id === v.recipeId); if (recipe) await send("plan.replace", { planId: p.id, recipe }); }}><label className="block text-sm">新しい料理<select name="recipeId" defaultValue={p.recipe.id} className={inputClass}>{recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><p className="text-xs">選択した食事の主菜・副菜・汁物をまとめて再確認します。未分類の旧献立は同じ調理日時を基準にします。必要量は直ちに再計算し、手動の買い物は残します。</p><Button type="submit">料理を差し替えて全量を見直す</Button></form></Details>}
    {state.feedback.filter(f => f.locationId === p.locationId && feedbackMatches(f, p.recipe)).slice(-3).map(f => <p className="rounded-lg bg-stone-50 p-3 text-sm" key={f.id}>前回の感想：{[f.salt, f.amount, f.eaten, f.notes].filter(Boolean).join("、")}</p>)}
    <div className="flex flex-wrap gap-2"><Button onClick={() => void send("cook.start", { planId: p.id })}>残量を確認して調理開始</Button><Button secondary onClick={() => void send("plan.skip", { planId: p.id })}>外食・作らなかった</Button></div>
    <Details title="日時・必要量を見直す"><form className="space-y-3" onSubmit={async e => { const v = Values(e); await send("plan.edit", { planId: p.id, mealId: v.mealId, cookAt: new Date(v.cookAt).toISOString(), eatMinutes: v.eatMinutes, cleanupMinutes: v.cleanupMinutes, equipmentUsage: state.equipment.filter(t => t.locationId === p.locationId && v[`tool-${t.id}`] === "on").map(t => ({ equipmentId: t.id, count: Number(v[`count-${t.id}`] || 1), amount: v[`capacity-${t.id}`], fromStep: v[`from-${t.id}`] === "" ? undefined : Number(v[`from-${t.id}`]) - 1, throughStep: v[`through-${t.id}`] === "" ? undefined : Number(v[`through-${t.id}`]) - 1 })), demands: p.demands.map((d, i) => ({ ...d, amount: v[`amount-${i}`] })) }); }}><MealSelection state={state} value={p.mealId || ""} /><Field label="調理日時" name="cookAt" type="datetime-local" value={localTime(new Date(p.cookAt))} /><div className="grid grid-cols-2 gap-2"><Field label="食べる時間（分・任意）" name="eatMinutes" type="number" value={p.eatMinutes?.toString()} /><Field label="片付ける時間（分・任意）" name="cleanupMinutes" type="number" value={p.cleanupMinutes?.toString()} /></div>{p.demands.map((d, i) => <Field key={i} label={d.name} name={`amount-${i}`} value={d.quantity ? showQuantity(d.quantity) : ""} placeholder="量を確認して入力" />)}<Details title="この料理で使う道具・容量"><p className="text-xs">使用量は料理が実際に占める容量を確認して入力します。材料のgから鍋のLを推定しません。同時使用数と容量は調理・工程の開始時に検査します。工程1は材料準備、2は道具準備、3からレシピの作業です。最後に保存・片付けが続きます。</p>{state.equipment.filter(t => t.locationId === p.locationId).map(t => <div key={t.id}><label className="flex min-h-11 items-center gap-2 text-sm"><input name={`tool-${t.id}`} type="checkbox" defaultChecked={p.equipmentUsage?.some(u => u.equipmentId === t.id)} />{t.name}（{t.capacity || "容量未確認"}・同時{t.slots || 1}個まで）</label><Field label={`${t.name}の使用数`} name={`count-${t.id}`} type="number" value={String(p.equipmentUsage?.find(u => u.equipmentId === t.id)?.count || 1)} /><Field label={`${t.name}に入れる量（確認できた場合）`} name={`capacity-${t.id}`} value={p.equipmentUsage?.find(u => u.equipmentId === t.id)?.amount} placeholder="1L" /><Field label={`${t.name}の使用開始工程（空欄は調理全体）`} name={`from-${t.id}`} type="number" value={p.equipmentUsage?.find(u => u.equipmentId === t.id)?.fromStep === undefined ? "" : String(p.equipmentUsage!.find(u => u.equipmentId === t.id)!.fromStep! + 1)} /><Field label={`${t.name}の使用終了工程`} name={`through-${t.id}`} type="number" value={p.equipmentUsage?.find(u => u.equipmentId === t.id)?.throughStep === undefined ? "" : String(p.equipmentUsage!.find(u => u.equipmentId === t.id)!.throughStep! + 1)} /></div>)}</Details><Button type="submit">量・道具を確認して予定を更新</Button></form></Details>
  </Sheet>;
}

function RecipeEvidence({ recipe }: { recipe: Recipe }) {
  const evidence = recipe.importEvidence;
  return <div className="space-y-2 text-xs text-stone-600">
    {videoEvidenceLabel(evidence?.evidence) && <p>{videoEvidenceLabel(evidence?.evidence)}</p>}
    {recipe.sources.filter(s => /^https?:\/\//.test(s.url)).map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" className="block underline">出典：{s.label}</a>)}
    {evidence && <><p>取り込み後も、元の読み取り結果と本人の修正を保持しています。</p><p>読取元：{evidence.evidence?.kind === "video" ? "動画から取得できた素材" : evidence.evidence?.kind === "photo" ? "アップロードした写真" : "レシピ探索"} / {evidence.confidence === "high" ? "読み取り結果を確認して使用" : "推定や欠損の確認が必要"}</p>{Array.isArray(evidence.missing) && evidence.missing.length > 0 && <p>取り込み時の欠損：{evidence.missing.join("、")}</p>}{Array.isArray(evidence.corrections) && evidence.corrections.map((c, i) => <p key={i}>本人修正：{c.note}</p>)}</>}
  </div>;
}

function CookingPanel({ cooking: c, plan: p, state }: { cooking: Cooking; plan: Plan; state: KitchenState }) {
  const { send, locationId } = useKitchen();
  const [showComplete, setComplete] = useState(false);
  const needed = remainingDemand(p.demands, p.consumed);
  const raw = [...new Set(c.allocations.map(a => a.lotId))].map(id => state.lots.find(l => l.id === id)!).filter(l => l.kind === "raw");
  const steps = c.steps;
  return <Sheet title={`${p.name}を作る`}>
    <p className="text-xs text-stone-600">確認時点 {new Date(c.startedAt).toLocaleString("ja-JP")} / 手順は開始時の内容を保持</p>
    {c.allocations.map((a, i) => { const l = state.lots.find(l => l.id === a.lotId)!; const label = remainingLabel(l.name, a.basis, a.quantity); return <div key={i} className="border-l-4 border-emerald-700 py-2 pl-3"><p className="text-xl font-bold leading-relaxed">{label.primary}</p><p className="text-sm">{label.secondary}</p>{evidencedWeight(a.quantity, l.weightEvidence) && <p className="text-xs">{evidencedWeight(a.quantity, l.weightEvidence)}</p>}<p className="mt-1 text-xs text-stone-500" title={l.id}>{state.locations.find(v => v.id === l.locationId)?.name} / {l.compartment} / ロット {state.lots.findIndex(v => v.id === l.id) + 1} / 版 {a.revision}</p>{l.revision !== a.revision && <p role="alert" className="text-sm text-amber-900">在庫が変わっています。いったん中断して残量を確認してください。</p>}</div>; })}
    <ol className="space-y-2">{steps.map((s, i) => <li key={i}><button className={`flex min-h-14 w-full gap-3 rounded-xl border p-3 text-left ${c.checked.includes(i) ? "border-emerald-200 bg-emerald-50" : "border-stone-200"}`} aria-pressed={c.checked.includes(i)} onClick={() => void send("cook.check", { cookingId: c.id, step: i })}><span aria-hidden="true" className="mt-0.5">{c.checked.includes(i) ? "✓" : "○"}</span><span><strong className="block">{s.title}</strong><span className="block whitespace-pre-wrap text-sm leading-relaxed">{s.text}</span></span></button></li>)}</ol>
    <StepControls cooking={c} plan={p} state={state} />
    {c.correction && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">明示された訂正：{c.correction}</p>}
    <Details title="手順の訂正を記録"><form className="space-y-3" onSubmit={async e => { await send("cook.correct", { ...Values(e), cookingId: c.id }); }}><Field label="変更した点（元の手順は残ります）" name="note" required /><Button type="submit">訂正を明示</Button></form></Details>
    <div className="flex flex-wrap gap-2"><Button onClick={() => setComplete(v => !v)}>作った・保存量を確認</Button><Button secondary onClick={() => void send("cook.cancel", { cookingId: c.id })}>調理を中断</Button></div>
    {showComplete && <form className="space-y-4 rounded-xl bg-stone-50 p-3" onSubmit={async e => {
      const v = Values(e); const output = v.made ? [{ name: v.outputName, made: v.made, eaten: v.eaten, saved: v.saved, discarded: v.discarded, left: v.left, plannedEat: v.plannedEat, eatAt: v.eatAt ? new Date(v.eatAt).toISOString() : undefined, locationId: v.target, compartment: v.outputZone, method: v.method, expiresOn: v.expiresOn, expiryBasis: v.expiryBasis }] : [];
      await send("cook.complete", { cookingId: c.id, actual: needed.map((d, i) => ({ ...d, amount: v[`actual-${i}`] })), outputs: output, unknownOutput: !v.made && v.unknownOutput === "on", outputName: v.outputName, partial: v.partial === "on", rawStorage: raw.map(l => ({ lotId: l.id, compartment: v[`zone-${l.id}`], condition: v[`condition-${l.id}`], method: v[`method-${l.id}`] })) });
    }}>
      <h3 className="font-bold">実際に使った量</h3>{needed.map((d, i) => <Field key={i} label={d.name} name={`actual-${i}`} value={d.quantity ? showQuantity(d.quantity) : ""} required />)}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="partial" />一部だけ作った（残りは予定に残す）</label>
      <StorageGuidance conditions={{ kind: "prepared", cookedAt: c.startedAt }} />
      <h3 className="font-bold">完成した料理</h3><p className="text-xs">食数・皿数・実測したgなど、同じ単位で記録します。未計量なら保存量を確定せず、後で在庫から確認できます。</p>
      <Field label="料理名" name="outputName" value={p.name} /><Field label="完成量（未確認なら空欄）" name="made" placeholder="3食" /><label className="flex min-h-11 items-center gap-2 text-sm"><input name="unknownOutput" type="checkbox" />残りはあるが量・保存をまだ確認していない</label>
      <div className="grid grid-cols-2 gap-2"><Field label="今回食べた量" name="eaten" placeholder="1食" /><Field label="保存する量" name="saved" placeholder="2食" /></div><Field label="捨てた量（なければ空欄）" name="discarded" placeholder="0食" />
      <Field label="残した・まだ保存していない量（なければ空欄）" name="left" placeholder="0食" />
      <Field label="未保存の残りのうち、これから食べる予定量" name="plannedEat" placeholder="1食" /><Field label="食べる予定時刻（任意）" name="eatAt" type="datetime-local" /><p className="text-xs">予定量はまだ食べたことにしません。食事後に実食を記録します。</p>
      <label className="block text-sm">保存する場所<select name="target" defaultValue={locationId} className={inputClass}>{state.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><Zone name="outputZone" />
      <Field label="実際の保存方法" name="method" value={c.recipe.leftoverStorage.find(s => s.ingredient === p.name)?.method || "浅い容器に小分け"} placeholder="小分け容器など、実際の方法を確認" /><p className="text-xs">保存方法は候補です。実際の方法に直してから確定してください。</p>
      <Field label="確認した期限" name="expiresOn" type="date" /><Field label="期限の根拠" name="expiryBasis" />
      {raw.map(l => { const suggested = c.recipe.leftoverStorage.find(s => ingredientId(s.ingredient) === l.ingredient)?.method || ""; return <Details key={l.id} title={`残った${l.name}の保存`}><p className="text-xs">残材料は在庫に残ります。再度追加しません。案内は候補なので実際の方法を確認してください。</p><Zone name={`zone-${l.id}`} value={l.compartment} /><Field label="状態" name={`condition-${l.id}`} value={l.condition === "新品" ? "開封済み" : l.condition} /><Field label="保存方法の候補" name={`method-${l.id}`} value={suggested} /></Details>; })}
      <Button type="submit">実使用量と保存内容を確定</Button>
    </form>}
  </Sheet>;
}

function Settings({ state }: { state: KitchenState }) {
  const { locationId, send } = useKitchen(), place = state.locations.find(l => l.id === locationId)!;
  return <div className="space-y-5"><Sheet title="場所の名前"><form className="space-y-3" onSubmit={async e => { await send("location.rename", Values(e)); }}><Field label="今の場所の名前" name="name" value={place.name} required /><Field label="この場所のタイムゾーン" name="timeZone" value={place.timeZone || "UTC"} /><Button type="submit">名前・タイムゾーンを変更</Button></form><Details title="別の場所を追加"><form className="space-y-3" onSubmit={async e => { await send("location.add", Values(e)); }}><Field label="好きな名前" name="name" placeholder="旅行先のキッチン" required /><Field label="タイムゾーン" name="timeZone" value={Intl.DateTimeFormat().resolvedOptions().timeZone} /><Button type="submit">場所を追加</Button></form></Details></Sheet>
    <Sheet title="この場所の調理道具">{state.equipment.filter(e => e.locationId === locationId).map(e => <div className="flex items-center justify-between gap-2 text-sm" key={e.id}><span>{e.name} / {e.capacity || "容量未確認"}</span><Button secondary onClick={() => void send("equipment.remove", { equipmentId: e.id })}>削除</Button></div>)}<form className="space-y-3" onSubmit={async e => { await send("equipment.add", Values(e)); }}><Field label="道具の名前" name="name" required placeholder="フライパン" /><Field label="容量・サイズ" name="capacity" placeholder="2L・26cm" /><Field label="同時に使える数（口数・個数）" name="slots" type="number" value="1" /><Button type="submit">道具を追加</Button></form></Sheet>
    <Sheet title="献立の好み"><form className="space-y-3" onSubmit={async e => { const v = Values(e); await send("preferences.save", { variety: v.variety === "on", servingNote: v.servingNote, retiredRules: v.retiredRules.split("\n").filter(Boolean) }); }}><label className="flex min-h-11 items-center gap-2 text-sm"><input name="variety" type="checkbox" defaultChecked={state.preferences.variety} />最近の献立と味付け・主食を変える</label><Field label="食べ切れる量・好みのメモ" name="servingNote" value={state.preferences.servingNote} /><label className="block text-sm">今後使わない古い方針（1行ずつ）<textarea name="retiredRules" className={inputClass} defaultValue={state.preferences.retiredRules.join("\n")} /></label><Button type="submit">好みを保存</Button></form><p className="text-xs">個人の量や食習慣は、ほかの利用者の初期設定には反映しません。予定表の外部連携はまだ行いません。</p></Sheet>
    <Sheet title="覚えている包装">{state.packages.filter(p => p.active).map(p => <div key={p.id} className="space-y-2 border-b border-stone-100 pb-3"><p className="text-sm">{p.ingredient}：{showQuantity(p.contents)} / {p.product || "商品未指定"} / {p.store || "店未指定"}</p><Button secondary onClick={() => void send("package.forget", { profileId: p.id })}>この入数を忘れる</Button></div>)}<p className="text-xs">修正は買い物の入数欄で行えます。別の商品・店舗は別々に記憶します。</p></Sheet>
    <Sheet title="データの控え"><a className="inline-block min-h-11 rounded-xl border border-stone-300 px-4 py-3 text-sm" href="/api/kitchen?export=1" download>在庫・履歴のバックアップを保存</a><p className="text-xs">元の在庫・買い物・献立も移行時の原本として保持しています。</p></Sheet>
  </div>;
}
function History({ state }: { state: KitchenState }) {
  const { locationId, send } = useKitchen();
  const transactions = state.transactions.filter(t => t.locationId === locationId).slice().reverse();
  const labels: Record<string, string> = { "shopping.purchase": "購入", "cook.complete": "調理・保存", "lot.discard": "廃棄", "lot.eat": "作り置きを食べた", "eating.complete": "予定から実食を記録", "transaction.undo": "取消", "plan.skip": "外食・作らなかった", "purchase.correct": "購入量の訂正", "lot.add": "在庫登録", "lot.update": "残量・保存先の更新" };
  return <div className="space-y-5"><Sheet title="実際に行ったこと">{transactions.filter(t => labels[t.type]).map(t => <article key={t.id} className="space-y-2 border-b border-stone-200 pb-3"><h3 className="font-bold">{labels[t.type]}{t.reversedBy ? "（取消済み）" : ""}</h3><p className="text-xs">{new Date(t.at).toLocaleString("ja-JP")}{t.note ? ` / ${t.note}` : ""}</p><p className="text-sm">{t.changes.map(c => `${state.lots.find(l => l.id === c.lotId)?.name} ${showQuantity(c.delta)}`).join("、")}{t.createdLots.map(id => state.lots.find(l => l.id === id)?.name).filter(Boolean).join("、")}</p>
      {!t.reversedBy && ["shopping.purchase", "cook.complete", "lot.discard", "lot.eat", "eating.complete", "plan.skip"].includes(t.type) && <Button secondary onClick={() => void send("transaction.undo", { transactionId: t.id })}>この操作を取り消す</Button>}
      {t.type === "shopping.purchase" && !t.reversedBy && <Details title="実購入量を訂正"><form className="space-y-3" onSubmit={async e => { await send("purchase.correct", { ...Values(e), transactionId: t.id }); }}><Field label="実際に買った合計量" name="amount" value={showQuantity(state.shopping.find(r => r.id === t.shoppingId)?.quantity || null)} required /><Button type="submit">購入量を訂正</Button></form></Details>}
      {t.type === "cook.complete" && t.planId && <Details title="次回のために感想を残す"><form className="space-y-3" onSubmit={async e => { await send("feedback.save", { ...Values(e), planId: t.planId, recipeId: state.plans.find(p => p.id === t.planId)!.recipe.id }); }}><Field label="塩気" name="salt" placeholder="少し塩辛かった" /><Field label="量" name="amount" placeholder="副菜を含めると多かった" /><Field label="完食度" name="eaten" placeholder="完食" /><Field label="作り方の感想" name="notes" /><Button type="submit">感想を保存</Button></form></Details>}
    </article>)}</Sheet><Sheet title="次回に使う感想">{state.feedback.filter(f => f.locationId === locationId && f.active).map(f => <div key={f.id} className="space-y-2 text-sm"><p>{[f.salt, f.amount, f.eaten, f.notes].filter(Boolean).join("、")}</p><Button secondary onClick={() => void send("feedback.retire", { feedbackId: f.id })}>今後は使わない</Button></div>)}</Sheet></div>;
}
