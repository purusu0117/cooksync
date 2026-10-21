import { normalizeName } from "../recipe";
import { add, compare, convert, min, positive, sub, zero, type Quantity } from "./quantity";
import type { Allocation, Demand, KitchenState, Lot } from "./model";
export const ingredientId = (name: string) => normalizeName(name.trim());
export function canonical(q: Quantity): Quantity { return convert(q, "g") || convert(q, "ml") || q; }
export function demandKey(d: Demand): string { return JSON.stringify([d.ingredient, d.kind, d.lotId || "", d.quantity ? canonical(d.quantity).unit : "unknown"]); }
export function aggregate(demands: Demand[]): Demand[] {
  const result = new Map<string, Demand>();
  for (const source of demands) {
    const d = { ...source, quantity: source.quantity ? canonical(source.quantity) : null };
    const key = demandKey(d), old = result.get(key);
    if (old?.quantity && d.quantity) old.quantity = { ...old.quantity, value: add(old.quantity.value, d.quantity.value) };
    else if (!old) result.set(key, d);
  }
  return [...result.values()];
}
export function remainingDemand(demands: Demand[], consumed: Demand[]): Demand[] {
  const used = new Map(aggregate(consumed).map(d => [demandKey(d), d]));
  return aggregate(demands).map(d => {
    const c = used.get(demandKey(d));
    if (!d.quantity || !c?.quantity) return d;
    const value = sub(d.quantity.value, c.quantity.value);
    return { ...d, quantity: { ...d.quantity, value: positive(value) ? value : zero() } };
  });
}
export function usable(lot: Lot, locationId: string, at: string, timeZone = "UTC"): boolean {
  // A date alone is not a safety guarantee. It only excludes expired stock from automatic allocation.
  return lot.locationId === locationId && lot.presence === "ある" && !!lot.quantity && positive(lot.quantity.value)
    && (lot.kind !== "prepared" || (!!lot.storedAt && lot.compartment !== "未確認"))
    && lot.availableAt <= at && (!lot.expiresOn || lot.expiresOn >= new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at)));
}
export interface Requirement extends Demand { allocated: Allocation[]; shortage: Quantity | null; ordered: Quantity | null; toAdd: Quantity | null; warnings: string[] }
export function allocate(lots: Lot[], demands: Demand[], locationId: string, at: string, timeZone = "UTC"): Requirement[] {
  const balance = new Map(lots.map(l => [l.id, l.quantity ? { ...l.quantity } : null]));
  const sorted = [...lots].sort((a, b) => (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999") || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return aggregate(demands).map(d => {
    const allocations: Allocation[] = [], warnings: string[] = [];
    if (!d.quantity) return { ...d, allocated: [], shortage: null, ordered: null, toAdd: null, warnings: ["必要量を確認してください"] };
    let left = d.quantity.value;
    for (const l of sorted) {
      if (l.locationId !== locationId || l.ingredient !== d.ingredient || l.kind !== d.kind || (d.lotId && l.id !== d.lotId)) continue;
      if (!l.quantity || l.presence !== "ある") { warnings.push(`${l.name}の在庫・量が未確認`); continue; }
      if (!usable(l, locationId, at, timeZone)) continue;
      const remaining = balance.get(l.id)!;
      const available = remaining && convert(remaining, d.quantity.unit);
      if (!available) { warnings.push(`${l.name}の単位が一致しません`); continue; }
      if (!positive(left)) break;
      const take = min(available.value, left);
      if (!positive(take)) continue;
      const quantity = convert({ value: take, unit: d.quantity.unit }, l.quantity.unit)!;
      allocations.push({ lotId: l.id, revision: l.revision, basis: l.quantity, quantity, demand: d });
      balance.set(l.id, { ...l.quantity, value: sub(remaining!.value, quantity.value) });
      left = sub(left, take);
    }
    const shortage = { ...d.quantity, value: left };
    return { ...d, allocated: allocations, shortage, ordered: { ...shortage, value: zero() }, toAdd: shortage, warnings: [...new Set(warnings)] };
  });
}
export function requirements(state: KitchenState, locationId: string, planIds?: string[], asOf = new Date().toISOString()): Requirement[] {
  const active = state.plans.filter(p => p.locationId === locationId && ["planned", "partial"].includes(p.status)).sort((a, b) => a.cookAt.localeCompare(b.cookAt) || a.id.localeCompare(b.id));
  const balance = structuredClone(state.lots);
  // Planned eating reserves the finished portion; it never records consumption.
  for (const eating of state.eatingPlans || []) {
    if (eating.locationId !== locationId || eating.status !== "planned") continue;
    const lot = balance.find(l => l.id === eating.lotId && l.locationId === locationId);
    const reserved = lot?.quantity && convert(eating.quantity, lot.quantity.unit);
    if (lot?.quantity && reserved) { const left = sub(lot.quantity.value, reserved.value); lot.quantity = { ...lot.quantity, value: positive(left) ? left : zero() }; }
  }
  const selected: Requirement[] = [];
  // Earlier plans reserve first, each at its own cooking time. Future purchases are never inventory.
  for (const p of active) {
    const at = p.cookAt < asOf ? asOf : p.cookAt;
    const rows = allocate(balance, remainingDemand(p.demands, p.consumed), locationId, at, state.locations.find(l => l.id === locationId)?.timeZone);
    for (const row of rows) for (const a of row.allocated) {
      const lot = balance.find(l => l.id === a.lotId)!;
      lot.quantity = { ...lot.quantity!, value: sub(lot.quantity!.value, a.quantity.value) };
    }
    if (!planIds || planIds.includes(p.id)) selected.push(...rows);
  }
  const combined: Requirement[] = [];
  for (const demand of aggregate(selected)) {
    const rows = selected.filter(d => demandKey(d) === demandKey(demand));
    const shortage = demand.quantity ? { ...demand.quantity, value: rows.reduce((sum, d) => add(sum, d.shortage?.value || zero()), zero()) } : null;
    let ordered: Quantity | null = shortage ? { ...shortage, value: zero() } : null;
    for (const row of state.shopping) {
      if (row.locationId !== locationId || row.purchasedBy || row.archived || row.ingredient !== demand.ingredient || !row.quantity || !ordered || demand.kind === "prepared") continue;
      const earliest = active.filter(p => !planIds || planIds.includes(p.id)).map(p => p.cookAt < asOf ? asOf : p.cookAt).sort()[0];
      if (row.availableAt && earliest && row.availableAt > earliest) continue;
      const q = convert(row.quantity, ordered.unit);
      if (q) ordered = { ...ordered, value: add(ordered.value, q.value) };
    }
    const extra = shortage && ordered ? sub(shortage.value, ordered.value) : zero();
    combined.push({ ...demand, allocated: rows.flatMap(r => r.allocated), shortage, ordered, toAdd: shortage ? { ...shortage, value: positive(extra) ? extra : zero() } : null, warnings: [...new Set(rows.flatMap(r => r.warnings))] });
  }
  return combined;
}
export function verifyAllocations(state: KitchenState, locationId: string, allocations: Allocation[]): boolean {
  return allocations.every(a => {
    const lot = state.lots.find(l => l.id === a.lotId && l.locationId === locationId);
    return lot && lot.revision === a.revision && lot.quantity?.unit === a.basis.unit && compare(lot.quantity.value, a.basis.value) === 0;
  });
}
