import type { Recipe } from "../recipe";
import { equipmentIssues, usesAtStep } from "./equipment";
import { recipeBasis } from "./quality";
import { add, ceil, compare, convert, div, mul, neg, parseQuantity, positive, showQuantity, sub, zero, type Quantity } from "./quantity";
import { aggregate, allocate, ingredientId, remainingDemand, requirements, verifyAllocations } from "./planning";
import { LEGACY_MUTABLE, type Compartment, type Demand, type KitchenCommand, type KitchenState, type Lot, type Transaction } from "./model";

export class KitchenError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KitchenError("入力形式を確認してください");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 200, optional = false): string {
  if ((value === undefined || value === null) && optional) return "";
  if (typeof value !== "string" || value.length > max || (!optional && !value.trim())) throw new KitchenError("入力内容を確認してください");
  return value.trim();
}
function list(value: unknown, max = 200): unknown[] { if (!Array.isArray(value) || value.length > max) throw new KitchenError("一覧の形式を確認してください"); return value; }
function quantity(value: unknown, allowZero = false): Quantity {
  const q = parseQuantity(text(value, 100));
  if (!q || (!allowZero && !positive(q.value))) throw new KitchenError("数量を単位付きで入力してください（例：1/4玉、3本）");
  return q;
}
function instant(value: unknown): string { const s = text(value, 50); const date = new Date(s); if (!Number.isFinite(date.getTime())) throw new KitchenError("日時を確認してください"); return date.toISOString(); }
function compartment(value: unknown): Compartment { if (!["冷蔵", "冷凍", "常温", "未確認"].includes(String(value))) throw new KitchenError("保存区画を確認してください"); return value as Compartment; }
export function timeZone(value: unknown): string { const zone = text(value || "UTC", 100); try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return zone; } catch { throw new KitchenError("タイムゾーンを確認してください"); } }
function expiry(value: unknown): string | undefined { if (!value) return undefined; const s = text(value, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s))) throw new KitchenError("期限の日付を確認してください"); return s; }
function minutes(value: unknown): number | undefined { if (value === undefined || value === "") return undefined; const n = Number(value); if (!Number.isInteger(n) || n < 0 || n > 600) throw new KitchenError("所要時間を0〜600分で確認してください"); return n; }
function demands(value: unknown): Demand[] { return list(value).map(v => { const d = object(v); const name = text(d.name); return { ingredient: ingredientId(name), name, quantity: d.amount ? quantity(d.amount, true) : null, originalQuantity: text(d.amount, 100, true), kind: d.kind === "prepared" ? "prepared" : "raw", ...(d.lotId ? { lotId: text(d.lotId) } : {}) }; }); }
function weightEvidence(p: Record<string, unknown>, q: Quantity | null): Lot["weightEvidence"] {
  if (!p.weightGrams) return undefined;
  if (!q || !positive(q.value)) throw new KitchenError("重量に対応する現在量を確認してください");
  const grams = convert(quantity(p.weightGrams), "g");
  if (!grams) throw new KitchenError("重量はgまたはkgで入力してください");
  return { quantity: q, grams, estimated: p.weightEstimated === "on", basis: text(p.weightBasis, 1000) };
}
function recipe(value: unknown, allowDraft = false): Recipe {
  const r = object(value);
  const ingredients = list(r.ingredients).map(v => { const i = object(v); return { name: text(i.name), amount: text(i.amount, 100, true), group: text(i.group, 200, true) || undefined, toBuy: i.toBuy === true, basicSeasoning: i.basicSeasoning === true, inventoryKind: i.inventoryKind === "prepared" ? "prepared" as const : "raw" as const }; });
  const steps = list(r.steps).map(v => { const s = object(v); return { title: text(s.title), text: text(s.text, 5000), tip: text(s.tip, 2000, true), ...(Number.isInteger(s.fromPhoto) && Number(s.fromPhoto) > 0 ? { fromPhoto: Number(s.fromPhoto) } : {}) }; });
  const draft = r.draft === true || !ingredients.length || !steps.length;
  if (draft && !allowDraft) throw new KitchenError("下書きの材料と手順を確認して完成させてください");
  return { id: text(r.id), draft, name: text(r.name), emoji: text(r.emoji, 20, true) || "🍳", catch: text(r.catch, 2000, true), servings: typeof r.servings === "number" && Number.isFinite(r.servings) && r.servings > 0 ? r.servings : 0, ingredients, steps, ...(r.sideDishes ? { sideDishes: list(r.sideDishes, 20).map(v => text(v, 500)) } : {}), ...(r.variations ? { variations: list(r.variations, 50).map(v => text(v, 2000)) } : {}), ...(typeof r.cookMinutes === "number" && Number.isFinite(r.cookMinutes) && r.cookMinutes >= 0 ? { cookMinutes: r.cookMinutes } : {}), leftoverStorage: list(r.leftoverStorage || []).map(v => { const s = object(v); return { ingredient: text(s.ingredient), method: text(s.method, 2000) }; }), tags: r.tags ? object(r.tags) : {}, sources: list(r.sources || []).map(v => { const s = object(v); return { label: text(s.label), url: text(s.url, 2000) }; }).filter(s => /^https?:\/\//.test(s.url)), createdAt: typeof r.createdAt === "number" ? r.createdAt : 0, ...(r.importEvidence ? { importEvidence: structuredClone(object(r.importEvidence)) as unknown as Recipe["importEvidence"] } : {}) };
}
export function decodeCommand(value: unknown): KitchenCommand {
  const c = object(value), id = text(c.id, 100), locationId = text(c.locationId, 200, true);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id) || !Number.isSafeInteger(c.expectedRevision) || Number(c.expectedRevision) < 0) throw new KitchenError("操作の版を確認してください");
  return { id, locationId, expectedRevision: Number(c.expectedRevision), type: text(c.type, 60), payload: object(c.payload) };
}
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJSON(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function initialState(owner: string, legacy: Record<string, unknown>, legacyRevision: number, now: string): KitchenState {
  const locationId = "default";
  const original = Object.fromEntries(LEGACY_MUTABLE.filter(k => legacy[k] !== undefined).map(k => [k, structuredClone(legacy[k])]));
  const state: KitchenState = { schema: 3, owner, revision: 0, locations: [{ id: locationId, name: "いつもの場所", createdAt: now }], lots: [], plans: [], shopping: [], packages: [], cooking: [], transactions: [], feedback: [], equipment: [], recipes: [], preferences: { variety: true, servingNote: "", retiredRules: [] }, operations: {}, migration: { version: 1, at: now, legacyRevision, original } };
  // Preserve existing recipe objects verbatim; validating a future edit must not erase an old record.
  state.recipes = structuredClone(list(legacy["fridge-app:recipes:v1"] || [], 10000)) as Recipe[];
  const food = legacy["fridge-app:items:v2"] ?? legacy["fridge-app:items:v1"] ?? [];
  for (const [index, item] of list(food, 10000).entries()) {
    const v = object(item), name = text(v.name), originalQuantity = text(v.quantity, 100, true);
    state.lots.push({ id: text(v.id, 200, true) || `legacy-food-${index}`, locationId, name, ingredient: ingredientId(name), kind: "raw", quantity: parseQuantity(originalQuantity), originalQuantity, presence: "ある", compartment: v.zone === "冷凍" ? "冷凍" : "未確認", condition: v.openedOn ? "開封済み" : v.cutOn ? "切りかけ" : "未確認", revision: 0, createdAt: typeof v.createdAt === "number" ? new Date(v.createdAt).toISOString() : now, availableAt: now, expiresOn: typeof v.expiresOn === "string" ? v.expiresOn : undefined, expiryBasis: v.expiresOn ? "旧データの期限（根拠未確認）" : undefined, legacy: structuredClone(v) });
  }
  for (const [index, item] of list(legacy["fridge-app:shopping:v1"] || [], 10000).entries()) {
    const v = object(item), name = text(v.name), amount = text(v.amount, 100, true);
    state.shopping.push({ id: text(v.id, 200, true) || `legacy-shopping-${index}`, locationId, name, ingredient: ingredientId(name), quantity: parseQuantity(amount), originalQuantity: amount, source: "legacy", archived: v.checked === true, planIds: [], product: "", store: "", legacy: structuredClone(v) });
  }
  // Historical `made`/`checked` flags are kept in the migration original, never replayed as transactions.
  const ids = state.lots.map(l => l.id); if (new Set(ids).size !== ids.length) throw new KitchenError("旧在庫のIDが重複しています。移行前に確認が必要です", 409);
  const shoppingIds = state.shopping.map(l => l.id); if (new Set(shoppingIds).size !== shoppingIds.length) throw new KitchenError("旧買い物のIDが重複しています。移行前に確認が必要です", 409);
  return state;
}

export function execute(state: KitchenState, owner: string, command: KitchenCommand, now: string): KitchenState {
  if (state.owner !== owner) throw new KitchenError("このデータは利用できません", 403);
  const fingerprint = canonicalJSON({ type: command.type, locationId: command.locationId, payload: command.payload });
  const done = state.operations[command.id];
  if (done) { if (done.fingerprint !== fingerprint) throw new KitchenError("同じ操作IDの内容が変わっています", 409); return state; }
  if (state.revision !== command.expectedRevision) throw new KitchenError("在庫や予定が更新されました。内容を確認してやり直してください", 409);
  const s = structuredClone(state), p = command.payload, locationId = command.locationId;
  if (!s.locations.some(l => l.id === locationId)) throw new KitchenError("この場所は利用できません", 403);
  const id = (suffix: string) => `${command.id}-${suffix}`;
  const lot = (value: unknown) => { const l = s.lots.find(l => l.id === text(value) && l.locationId === locationId); if (!l) throw new KitchenError("在庫が見つかりません", 404); return l; };
  const plan = () => { const a = s.plans.find(a => a.id === text(p.planId) && a.locationId === locationId); if (!a) throw new KitchenError("献立が見つかりません", 404); return a; };
  const tx: Transaction = { id: id("tx"), commandId: command.id, locationId, type: command.type, at: now, changes: [], createdLots: [] };
  const change = (l: Lot, delta: Quantity) => {
    if (!l.quantity) throw new KitchenError(`${l.name}の量を確認してください`);
    const q = convert(delta, l.quantity.unit); if (!q) throw new KitchenError(`${l.name}の単位を確認してください`);
    const result = add(l.quantity.value, q.value); if (compare(result, zero()) < 0) throw new KitchenError(`${l.name}の残量を超えています`, 409);
    tx.changes.push({ lotId: l.id, delta: q, beforeRevision: l.revision }); l.quantity = { ...l.quantity, value: result }; l.revision++;
  };
  switch (command.type) {
    case "recipe.save": {
      const r = recipe(p.recipe, true), existing = s.recipes.findIndex(v => v.id === r.id);
      if (existing >= 0) {
        const prior = s.recipes[existing];
        if (prior.importEvidence) r.importEvidence = { ...prior.importEvidence, corrections: [...(prior.importEvidence.corrections || []), { at: Date.parse(now), note: text(p.note, 2000, true) || "本人が保存内容を修正" }] };
        s.recipes[existing] = r;
      } else s.recipes.push(r);
      break;
    }
    case "meal.add": {
      s.meals ||= []; s.meals.push({ id: id("meal"), locationId, name: text(p.name), eatAt: instant(p.eatAt) }); break;
    }
    case "meal.edit": {
      const meal = s.meals?.find(m => m.id === p.mealId && m.locationId === locationId);
      if (!meal) throw new KitchenError("食事が見つかりません", 404);
      meal.name = text(p.name); meal.eatAt = instant(p.eatAt); break;
    }
    case "eating.plan": {
      const l = lot(p.lotId), q = quantity(p.amount);
      if (l.kind !== "prepared" || !l.quantity || !convert(q, l.quantity.unit) || compare(convert(q, l.quantity.unit)!.value, l.quantity.value) > 0) throw new KitchenError("作り置きの残量と単位を確認してください");
      const reserved = (s.eatingPlans || []).filter(v => v.lotId === l.id && v.status === "planned").reduce((sum, v) => add(sum, convert(v.quantity, l.quantity!.unit)!.value), zero());
      if (compare(add(reserved, convert(q, l.quantity.unit)!.value), l.quantity.value) > 0) throw new KitchenError("ほかの食事に取り分ける予定を含めると残量を超えます", 409);
      s.eatingPlans ||= []; s.eatingPlans.push({ id: id("eating"), locationId, lotId: l.id, quantity: q, eatAt: instant(p.eatAt), status: "planned" }); break;
    }
    case "eating.cancel":
    case "eating.complete": {
      const eating = s.eatingPlans?.find(v => v.id === p.eatingId && v.locationId === locationId);
      if (!eating || eating.status !== "planned") throw new KitchenError("食べる予定が更新されました", 409);
      if (command.type === "eating.cancel") { eating.status = "cancelled"; break; }
      const l = lot(eating.lotId), q = quantity(p.amount);
      if (l.presence !== "ある") throw new KitchenError("作り置きの状態を確認してください");
      change(l, { ...q, value: neg(q.value) }); eating.status = "eaten"; eating.transactionId = tx.id;
      tx.original = { eatingId: eating.id }; tx.note = "食べる予定から実食を確認"; break;
    }
    case "location.add": s.locations.push({ id: id("location"), name: text(p.name, 80), createdAt: now, timeZone: timeZone(p.timeZone) }); break;
    case "location.rename": { const place = s.locations.find(l => l.id === locationId)!; place.name = text(p.name, 80); if (p.timeZone) place.timeZone = timeZone(p.timeZone); break; }
    case "location.remove": {
      // Only an empty place can go: stock, plans, shopping and cooking that still live there must be moved or closed first.
      if (s.locations.length <= 1) throw new KitchenError("最後の場所は削除できません", 409);
      const blockers = [
        s.lots.some(l => l.locationId === locationId && l.presence === "ある" && !!l.quantity && positive(l.quantity.value)) ? "在庫" : "",
        s.plans.some(a => a.locationId === locationId && ["planned", "partial"].includes(a.status)) ? "献立" : "",
        s.shopping.some(r => r.locationId === locationId && !r.purchasedBy && !r.archived && !r.removedBy) ? "買い物" : "",
        s.cooking.some(c => c.locationId === locationId && !c.completedBy) ? "調理中の料理" : "",
      ].filter(Boolean);
      if (blockers.length) throw new KitchenError(`この場所にはまだ${blockers.join("・")}があります。別の場所へ移すか、削除してから場所を消してください`, 409);
      const place = s.locations.find(l => l.id === locationId)!;
      s.locations = s.locations.filter(l => l.id !== locationId); s.equipment = s.equipment.filter(e => e.locationId !== locationId);
      tx.note = `場所「${place.name}」を削除`; break;
    }
    case "lot.add": {
      const name = text(p.name), amount = text(p.amount, 100, true), q = amount ? quantity(amount, true) : null;
      const l: Lot = { id: id("lot"), locationId, name, ingredient: ingredientId(name), kind: p.kind === "prepared" ? "prepared" : "raw", quantity: q, originalQuantity: amount, presence: "ある", compartment: compartment(p.compartment), condition: text(p.condition, 100, true) || "未確認", revision: 0, createdAt: now, availableAt: p.availableAt ? instant(p.availableAt) : now, expiresOn: expiry(p.expiresOn), expiryBasis: text(p.expiryBasis, 1000, true) || undefined };
      if (l.kind === "prepared") { l.cookedAt = p.cookedAt ? instant(p.cookedAt) : undefined; l.storedAt = now; l.storageMethod = text(p.storageMethod, 1000, true); }
      l.weightEvidence = weightEvidence(p, q);
      s.lots.push(l); tx.createdLots.push(l.id); break;
    }
    case "lot.update": {
      const l = lot(p.lotId); if (p.lotRevision !== l.revision) throw new KitchenError("在庫が更新されました", 409);
      tx.metadataBefore = [structuredClone(l)];
      if (p.amount !== undefined) {
        const q = quantity(p.amount, true);
        if (l.quantity) { const converted = convert(q, l.quantity.unit); if (!converted) throw new KitchenError("元の単位に合わせて数量を確認してください"); change(l, { ...converted, value: sub(converted.value, l.quantity.value) }); }
        else l.quantity = q;
      }
      if (p.weightGrams !== undefined) l.weightEvidence = weightEvidence(p, l.quantity);
      if (p.presence !== undefined) { if (!["ある", "ない", "見当たらない", "未確認"].includes(String(p.presence))) throw new KitchenError("確認状態を選んでください"); l.presence = p.presence as Lot["presence"]; }
      if (p.compartment !== undefined) l.compartment = compartment(p.compartment);
      if (p.condition !== undefined) l.condition = text(p.condition, 100);
      if (p.storageMethod !== undefined) { l.storageMethod = text(p.storageMethod, 1000, true); l.storedAt = now; }
      if (p.expiresOn !== undefined) { l.expiresOn = expiry(p.expiresOn); l.expiryBasis = text(p.expiryBasis, 1000, true) || undefined; }
      if (p.targetLocationId !== undefined) { const target = text(p.targetLocationId); if (!s.locations.some(a => a.id === target)) throw new KitchenError("保存先が利用できません", 403); l.locationId = target; }
      l.revision++; break;
    }
    case "lot.remove": {
      // "Used up / not here": the row leaves the usable stock in one tap. Reversible from the history.
      const l = lot(p.lotId); tx.metadataBefore = [structuredClone(l)];
      if (l.quantity && positive(l.quantity.value)) change(l, { ...l.quantity, value: neg(l.quantity.value) });
      l.presence = "ない"; l.revision++; tx.note = text(p.reason, 1000, true) || "削除（使い切った・無い）"; break;
    }
    case "lot.eat":
    case "lot.discard": { const l = lot(p.lotId), q = quantity(p.amount); if (command.type === "lot.eat" && (l.kind !== "prepared" || l.presence !== "ある")) throw new KitchenError("確認済みの作り置きを選んでください"); change(l, { ...q, value: neg(q.value) }); tx.note = text(p.reason, 1000, true) || (command.type === "lot.eat" ? "食べた" : "廃棄"); break; }
    case "shopping.add": {
      const name = text(p.name), amount = text(p.amount, 100, true);
      s.shopping.push({ id: id("shopping"), locationId, name, ingredient: ingredientId(name), quantity: amount ? quantity(amount) : null, originalQuantity: amount, source: "manual", planIds: [], product: "", store: "" }); break;
    }
    case "shopping.recalculate": {
      // Only our own generated rows are replaceable. Manual and migrated rows always survive.
      s.shopping = s.shopping.filter(r => r.locationId !== locationId || r.source !== "plan" || !!r.purchasedBy);
      const rows = requirements(s, locationId, undefined, now);
      for (const [index, r] of rows.entries()) if (r.kind === "raw" && (!r.toAdd || positive(r.toAdd.value))) {
        s.shopping.push({ id: id(`shopping-${index}`), locationId, name: r.name, ingredient: r.ingredient, quantity: r.toAdd, originalQuantity: showQuantity(r.toAdd), source: "plan", planIds: s.plans.filter(a => a.locationId === locationId && ["planned", "partial"].includes(a.status)).map(a => a.id), product: "", store: "" });
      }
      break;
    }
    case "shopping.remove": {
      const row = s.shopping.find(r => r.id === text(p.shoppingId) && r.locationId === locationId);
      if (!row) throw new KitchenError("買い物項目が見つかりません", 404);
      if (row.purchasedBy) throw new KitchenError("この項目は購入済みです。履歴から取り消してください", 409);
      row.removedBy = tx.id; tx.shoppingId = row.id; tx.note = `「${row.name}」を買い物から外した`; break;
    }
    case "shopping.edit":
    case "shopping.purchase": {
      const row = s.shopping.find(r => r.id === text(p.shoppingId) && r.locationId === locationId);
      if (!row) throw new KitchenError("買い物項目が見つかりません", 404);
      if (row.removedBy) throw new KitchenError("この項目は買い物から外しています。もう一度追加してください", 409);
      if (row.archived) throw new KitchenError("旧データで完了した買い物です。再購入は新しい項目で登録してください", 409);
      if (row.purchasedBy) throw new KitchenError("この項目は購入済みです。履歴から訂正してください", 409);
      const q = quantity(p.amount); row.quantity = q; row.originalQuantity = text(p.amount, 100);
      row.product = text(p.product, 200, true); row.store = text(p.store, 200, true);
      row.packageContents = p.contents ? quantity(p.contents) : undefined; row.packageUnit = p.packageUnit ? text(p.packageUnit, 30) : undefined;
      row.availableAt = p.availableAt ? instant(p.availableAt) : undefined;
      if (command.type === "shopping.edit") break;
      const l: Lot = { id: id("purchase"), locationId, name: row.name, ingredient: row.ingredient, kind: "raw", quantity: q, originalQuantity: row.originalQuantity, presence: "ある", compartment: compartment(p.compartment), condition: "新品", revision: 0, createdAt: now, availableAt: now, expiresOn: expiry(p.expiresOn), expiryBasis: text(p.expiryBasis, 1000, true) || undefined };
      s.lots.push(l); tx.createdLots.push(l.id); row.purchasedBy = tx.id; tx.shoppingId = row.id;
      if (p.remember === true && row.packageContents) {
        if (!convert(row.packageContents, q.unit)) throw new KitchenError("包装の入数と購入量の単位を確認してください");
        const profile = s.packages.find(a => a.ingredient === row.ingredient && a.product === row.product && a.store === row.store);
        const next = { id: profile?.id || id("package"), ingredient: row.ingredient, product: row.product, store: row.store, contents: row.packageContents, unit: row.packageUnit || "袋", updatedAt: now, active: true };
        if (profile) Object.assign(profile, next); else s.packages.push(next);
      }
      break;
    }
    case "purchase.correct": {
      const original = s.transactions.find(t => t.id === text(p.transactionId) && t.locationId === locationId && t.type === "shopping.purchase");
      if (!original || original.reversedBy) throw new KitchenError("購入履歴を確認してください", 409);
      const l = lot(original.createdLots[0]), row = s.shopping.find(r => r.id === original.shoppingId)!;
      const q = quantity(p.amount, true), previous = row.quantity && convert(row.quantity, q.unit);
      if (!previous) throw new KitchenError("購入時と同じ単位で訂正してください");
      change(l, { ...q, value: sub(q.value, previous.value) }); row.quantity = q; row.originalQuantity = showQuantity(q);
      tx.shoppingId = row.id; tx.note = "実購入量の訂正"; break;
    }
    case "package.forget": { const a = s.packages.find(a => a.id === text(p.profileId)); if (!a) throw new KitchenError("包装情報が見つかりません", 404); a.active = false; break; }
    case "plan.add": {
      const r = recipe(p.recipe), ds = p.demands ? demands(p.demands) : demands(r.ingredients.map(i => ({ name: i.name, amount: parseQuantity(i.amount) ? i.amount : "", kind: i.inventoryKind || "raw" })));
      if (p.saveRecipe === true && !s.recipes.some(v => v.id === r.id)) s.recipes.push(structuredClone(r));
      const mealId = text(p.mealId, 200, true) || undefined;
      if (mealId && !s.meals?.some(m => m.id === mealId && m.locationId === locationId)) throw new KitchenError("この食事は利用できません", 403);
      s.plans.push({ id: id("plan"), locationId, mealId, name: r.name, recipe: r, demands: ds, cookAt: instant(p.cookAt), status: "planned", consumed: [], revision: 0 }); break;
    }
    case "plan.edit": { const a = plan(); if (!["planned", "partial"].includes(a.status)) throw new KitchenError("終了した献立は編集できません", 409); if (s.cooking.some(c => c.planId === a.id && !c.completedBy)) throw new KitchenError("調理中です。訂正を明示するか調理を中断してください", 409); a.cookAt = instant(p.cookAt); if (p.mealId !== undefined) { const mealId = text(p.mealId, 200, true) || undefined; if (mealId && !s.meals?.some(m => m.id === mealId && m.locationId === locationId)) throw new KitchenError("この食事は利用できません", 403); a.mealId = mealId; } if (p.demands) a.demands = demands(p.demands); a.eatMinutes = minutes(p.eatMinutes); a.cleanupMinutes = minutes(p.cleanupMinutes); a.reviewNeeded = undefined; if (p.equipmentUsage) { const usages = list(p.equipmentUsage, 50).map(value => { const u = object(value), equipmentId = text(u.equipmentId), count = Number(u.count); if (!s.equipment.some(e => e.id === equipmentId && e.locationId === locationId) || !Number.isSafeInteger(count) || count < 1 || count > 20) throw new KitchenError("道具と使用数を確認してください"); const fromStep = u.fromStep === undefined || u.fromStep === "" ? undefined : Number(u.fromStep), throughStep = u.throughStep === undefined || u.throughStep === "" ? fromStep : Number(u.throughStep); if (fromStep !== undefined && (!Number.isInteger(fromStep) || !Number.isInteger(throughStep) || fromStep < 0 || throughStep! < fromStep || throughStep! >= a.recipe.steps.length + 4)) throw new KitchenError("道具を使う工程を確認してください"); return { equipmentId, count, amount: text(u.amount, 100, true) || undefined, fromStep, throughStep }; }); if (new Set(usages.map(u => u.equipmentId)).size !== usages.length) throw new KitchenError("道具の指定が重複しています"); a.equipmentUsage = usages; } a.revision++; break; }
    case "plan.replace": {
      const a = plan(); if (a.status !== "planned" || a.consumed.length || s.cooking.some(c => c.planId === a.id && !c.completedBy)) throw new KitchenError("調理中・一部調理済みの献立は差し替えられません", 409);
      const r = recipe(p.recipe); tx.original = { previousRecipe: a.recipe, previousDemands: a.demands }; tx.planId = a.id;
      a.recipe = r; a.name = r.name; a.demands = demands(r.ingredients.map(i => ({ ...i, amount: parseQuantity(i.amount) ? i.amount : "", kind: i.inventoryKind || "raw" }))); a.equipmentUsage = []; a.revision++;
      for (const peer of s.plans.filter(v => v.locationId === locationId && (a.mealId ? v.mealId === a.mealId : !v.mealId && v.cookAt === a.cookAt) && ["planned", "partial"].includes(v.status))) { peer.reviewNeeded = "同じ食事の料理が変わりました。副菜・汁物を含めた食べ切れる量と道具を見直してください"; if (peer.id !== a.id) peer.revision++; }
      break;
    }
    case "plan.skip": { const a = plan(); if (!["planned", "partial"].includes(a.status)) throw new KitchenError("終了した献立です", 409); tx.beforePlan = structuredClone(a); tx.planId = a.id; a.status = "skipped"; a.revision++; tx.note = "外食・作らなかった"; for (const c of s.cooking.filter(c => c.planId === a.id && !c.completedBy)) c.completedBy = tx.id; break; }
    case "cook.start": {
      const a = plan(); if (!["planned", "partial"].includes(a.status) || s.cooking.some(c => c.planId === a.id && !c.completedBy)) throw new KitchenError("調理済みか、すでに調理を開始しています", 409);
      if (a.reviewNeeded) throw new KitchenError(a.reviewNeeded, 409);
      const issues = equipmentIssues(s, a); if (issues.length) throw new KitchenError(issues.join("。"), 409);
      const virtual = structuredClone(s); virtual.plans.find(p => p.id === a.id)!.cookAt = now;
      const rows = requirements(virtual, locationId, [a.id], now);
      if (rows.some(r => !r.shortage || positive(r.shortage.value))) throw new KitchenError("不足分・不明量を確認してから調理を始めてください", 409);
      const steps = [{ title: "材料を準備", text: "表示されたロットから、使う材料を取り分けます。" }, { title: "道具を準備", text: s.equipment.filter(e => e.locationId === locationId).map(e => `${e.name} ${e.capacity}`).join("、") || "使う道具と容量を確認します。" }, ...structuredClone(a.recipe.steps), { title: "残りを保存", text: "実際の残量と保存方法・保存先を確認します。" }, { title: "片付け", text: "使った道具と作業台を片付けます。" }];
      s.cooking.push({ id: id("cooking"), locationId, planId: a.id, planRevision: a.revision, startedAt: now, recipe: structuredClone(a.recipe), steps, allocations: rows.flatMap(r => r.allocated).map(a => ({ ...a, basis: s.lots.find(l => l.id === a.lotId)!.quantity! })), checked: [] }); break;
    }
    case "cook.step.start":
    case "cook.step.finish":
    case "cook.check":
    case "cook.correct":
    case "cook.cancel":
    case "cook.complete": {
      const c = s.cooking.find(c => c.id === text(p.cookingId) && c.locationId === locationId);
      if (!c || c.completedBy) throw new KitchenError("調理が終了しているか見つかりません", 409);
      const a = s.plans.find(a => a.id === c.planId)!;
      if (command.type === "cook.step.start") {
        const step = Number(p.step);
        if (!Number.isInteger(step) || step < 0 || step >= c.steps.length) throw new KitchenError("工程が見つかりません");
        if (c.activeStep !== undefined && c.activeStep !== step) throw new KitchenError("今の工程を終了してから次へ進んでください", 409);
        const issues = equipmentIssues(s, a, step); if (issues.length) throw new KitchenError(issues.join("。"), 409);
        const held = new Map((c.heldEquipment || []).map(u => [u.equipmentId, u]));
        for (const use of a.equipmentUsage || []) if (use.fromStep !== undefined && usesAtStep(use, step)) held.set(use.equipmentId, structuredClone(use));
        c.heldEquipment = [...held.values()]; c.activeStep = step; break;
      }
      if (command.type === "cook.step.finish") {
        if (c.activeStep === undefined || c.activeStep !== Number(p.step)) throw new KitchenError("開始した工程を確認してください", 409);
        if (!c.checked.includes(c.activeStep)) c.checked.push(c.activeStep);
        c.heldEquipment = (c.heldEquipment || []).filter(u => (u.throughStep ?? u.fromStep!) > c.activeStep!);
        c.activeStep = undefined; break;
      }
      if (command.type === "cook.cancel") { c.completedBy = tx.id; tx.note = "調理を中断（材料は未減算）"; break; }
      if (command.type === "cook.check") { const step = Number(p.step); if (!Number.isInteger(step) || step < 0 || step >= c.steps.length) throw new KitchenError("工程が見つかりません"); c.checked = c.checked.includes(step) ? c.checked.filter(i => i !== step) : [...c.checked, step]; break; }
      if (command.type === "cook.correct") { c.correction = text(p.note, 2000); break; }
      if (a.revision !== c.planRevision || !verifyAllocations(s, locationId, c.allocations)) throw new KitchenError("調理開始後に対象在庫が変わりました。中断して最新の残量を確認してください", 409);
      const actual = p.actual ? demands(p.actual) : remainingDemand(a.demands, a.consumed);
      // Only the lots/amounts confirmed at start are available to this cooking session.
      // This prevents actual-use edits from silently taking another meal's reservations.
      const confirmed = s.lots.map(l => {
        const used = c.allocations.filter(a => a.lotId === l.id);
        return { ...l, quantity: l.quantity ? { ...l.quantity, value: used.reduce((sum, a) => add(sum, a.quantity.value), zero()) } : null };
      });
      const rows = allocate(confirmed, actual, locationId, now, s.locations.find(l => l.id === locationId)?.timeZone);
      if (rows.some(r => !r.shortage || positive(r.shortage.value))) throw new KitchenError("実使用量が在庫を超えるか不明です", 409);
      tx.beforePlan = structuredClone(a); tx.planId = a.id; tx.cookingId = c.id;
      for (const r of rows) for (const allocation of r.allocated) { const l = lot(allocation.lotId); change(l, { ...allocation.quantity, value: neg(allocation.quantity.value) }); }
      if (p.unknownOutput === true) {
        const name = text(p.outputName, 200, true) || a.name;
        const l: Lot = { id: id("prepared-unknown"), locationId, name, ingredient: ingredientId(name), kind: "prepared", quantity: null, originalQuantity: "量不明", presence: "未確認", compartment: "未確認", condition: "完成量・保存未確認", revision: 0, createdAt: now, cookedAt: now, availableAt: now, recipeId: a.recipe.id };
        s.lots.push(l); tx.createdLots.push(l.id);
      }
      for (const output of list(p.outputs || [], 20)) {
        const o = object(output), made = quantity(o.made), eaten = quantity(o.eaten || `0${made.unit}`, true), saved = quantity(o.saved || `0${made.unit}`, true), discarded = quantity(o.discarded || `0${made.unit}`, true), left = quantity(o.left || `0${made.unit}`, true);
        const e = convert(eaten, made.unit), v = convert(saved, made.unit), d = convert(discarded, made.unit), remaining = convert(left, made.unit);
        if (!e || !v || !d || !remaining || compare(add(add(add(e.value, v.value), d.value), remaining.value), made.value) !== 0) throw new KitchenError("完成量は食べた量・保存量・未保存の残り・捨てた量の合計にしてください");
        if (positive(saved.value)) {
          const name = text(o.name), target = text(o.locationId);
          if (!s.locations.some(l => l.id === target)) throw new KitchenError("保存先が利用できません", 403);
          const l: Lot = { id: id(`prepared-${tx.createdLots.length}`), locationId: target, name, ingredient: ingredientId(name), kind: "prepared", quantity: saved, originalQuantity: showQuantity(saved), presence: "ある", compartment: compartment(o.compartment), condition: "調理済み", revision: 0, createdAt: now, cookedAt: now, storedAt: now, availableAt: now, storageMethod: text(o.method, 2000, true), expiresOn: expiry(o.expiresOn), expiryBasis: text(o.expiryBasis, 1000, true) || undefined, recipeId: a.recipe.id };
          s.lots.push(l); tx.createdLots.push(l.id);
        }
        if (positive(left.value)) {
          const name = text(o.name);
          const planned = o.plannedEat ? quantity(o.plannedEat) : null;
          const plannedConverted = planned && convert(planned, left.unit);
          if (planned && (!plannedConverted || compare(plannedConverted.value, left.value) > 0)) throw new KitchenError("食べる予定量は未保存の残り以下にしてください");
          const l: Lot = { id: id(`prepared-${tx.createdLots.length}`), locationId, name, ingredient: ingredientId(name), kind: "prepared", quantity: left, originalQuantity: showQuantity(left), presence: planned ? "ある" : "未確認", compartment: "未確認", condition: planned ? "食事用に取り分け・未保存" : "残した・保存未確認", revision: 0, createdAt: now, cookedAt: now, availableAt: now, recipeId: a.recipe.id };
          s.lots.push(l); tx.createdLots.push(l.id);
          if (planned) { s.eatingPlans ||= []; s.eatingPlans.push({ id: id(`eating-${l.id}`), locationId, lotId: l.id, quantity: planned, eatAt: o.eatAt ? instant(o.eatAt) : now, status: "planned" }); }
        }
        else if (o.plannedEat && positive(quantity(o.plannedEat, true).value)) throw new KitchenError("食べる予定分は未保存の残りに含めてください");
      }
      tx.original = { outputs: p.outputs || [], unknownOutput: p.unknownOutput === true, actual };
      for (const item of list(p.rawStorage || [])) { const r = object(item), l = lot(r.lotId); if (l.kind !== "raw") throw new KitchenError("残材料を選択してください"); tx.metadataBefore ||= []; tx.metadataBefore.push(structuredClone(l)); l.compartment = compartment(r.compartment); l.condition = text(r.condition, 100); l.storageMethod = text(r.method, 2000, true); l.storedAt = now; l.revision++; }
      a.consumed = aggregate([...a.consumed, ...actual]); a.status = p.partial === true ? "partial" : "cooked"; a.revision++; c.completedBy = tx.id; break;
    }
    case "transaction.undo": {
      const original = s.transactions.find(t => t.id === text(p.transactionId) && t.locationId === locationId);
      if (!original || original.reversedBy || !["shopping.purchase", "cook.complete", "lot.discard", "lot.eat", "lot.remove", "eating.complete", "plan.skip"].includes(original.type)) throw new KitchenError("この操作は取り消せません", 409);
      if (original.type === "lot.remove") { const before = original.metadataBefore?.[0], l = s.lots.find(l => l.id === before?.id); if (!before || !l) throw new KitchenError("対象ロットがありません", 409); l.presence = before.presence; l.revision++; }
      if (original.type === "shopping.purchase" && s.transactions.some(t => t.type === "purchase.correct" && t.shoppingId === original.shoppingId)) throw new KitchenError("数量訂正済みです。購入量を0に訂正してください", 409);
      for (const created of original.createdLots) {
        const l = s.lots.find(l => l.id === created);
        if (!l || l.revision !== 0) throw new KitchenError("購入品・作り置きが使用または変更されています。残量と履歴を確認してください", 409);
        if (l.quantity && positive(l.quantity.value)) change(l, { ...l.quantity, value: neg(l.quantity.value) });
      }
      for (const delta of original.changes) { const l = s.lots.find(l => l.id === delta.lotId); if (!l) throw new KitchenError("対象ロットがありません", 409); change(l, { ...delta.delta, value: neg(delta.delta.value) }); }
      if (original.beforePlan) { const a = s.plans.find(a => a.id === original.planId)!; if (a.revision !== original.beforePlan.revision + 1) throw new KitchenError("献立に後続の変更があります", 409); Object.assign(a, original.beforePlan, { revision: a.revision + 1 }); }
      if (original.shoppingId) { const row = s.shopping.find(r => r.id === original.shoppingId)!; row.purchasedBy = undefined; }
      for (const eating of s.eatingPlans || []) {
        if (original.createdLots.includes(eating.lotId) && eating.status === "planned") eating.status = "cancelled";
        if (eating.transactionId === original.id) { eating.status = "planned"; eating.transactionId = undefined; }
      }
      original.reversedBy = tx.id; tx.reverses = original.id; break;
    }
    case "feedback.save": { const recipeId = text(p.recipeId); const reviewed = s.plans.find(v => v.id === p.planId && v.locationId === locationId && v.recipe.id === recipeId)?.recipe || s.plans.filter(v => v.locationId === locationId && v.recipe.id === recipeId).at(-1)?.recipe || s.recipes.find(v => v.id === recipeId); for (const f of s.feedback) if (f.recipeId === recipeId && f.locationId === locationId) f.active = false; s.feedback.push({ id: id("feedback"), locationId, recipeId, recipeBasis: reviewed ? recipeBasis(reviewed) : undefined, at: now, salt: text(p.salt, 100, true), amount: text(p.amount, 100, true), eaten: text(p.eaten, 100, true), notes: text(p.notes, 2000, true), active: true }); break; }
    case "feedback.retire": { const f = s.feedback.find(f => f.id === text(p.feedbackId) && f.locationId === locationId); if (!f) throw new KitchenError("感想が見つかりません", 404); f.active = false; break; }
    case "equipment.add": s.equipment.push({ id: id("equipment"), locationId, name: text(p.name), capacity: text(p.capacity, 200, true), slots: p.slots ? Number(p.slots) : 1 }); if (!Number.isSafeInteger(s.equipment.at(-1)!.slots) || s.equipment.at(-1)!.slots! < 1 || s.equipment.at(-1)!.slots! > 20) throw new KitchenError("同時使用数は1〜20で確認してください"); break;
    case "equipment.remove": s.equipment = s.equipment.filter(e => !(e.id === text(p.equipmentId) && e.locationId === locationId)); break;
    case "preferences.save": s.preferences = { variety: p.variety === true, servingNote: text(p.servingNote, 2000, true), retiredRules: list(p.retiredRules || []).map(r => text(r, 1000)) }; break;
    default: throw new KitchenError("未対応の操作です");
  }
  s.revision++;
  s.operations[command.id] = { fingerprint, revision: s.revision };
  s.transactions.push(tx);
  return s;
}
export function packageSuggestion(required: Quantity, contents: Quantity): { count: Quantity["value"]; actual: Quantity } | null {
  const q = convert(contents, required.unit); if (!q || !positive(q.value)) return null;
  const count = ceil(div(required.value, q.value)); return { count, actual: { ...required, value: mul(q.value, count) } };
}
