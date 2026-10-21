import { describe, expect, it } from "vitest";
import { execute, initialState } from "../engine";
import { projectQueue, loadQueue, storePending, removePending, type PendingOperation } from "../outbox";
import { parseQuantity, showQuantity } from "../quantity";
import { requirements } from "../planning";
import { usable } from "../planning";
import { validateImportedRecipe } from "../importValidation";
import { storageGuidance } from "../foodSafety";
import type { Recipe } from "../../recipe";
const now = "2026-10-21T10:00:00.000Z";
const recipe: Recipe = { id: "dish", name: "白菜料理", emoji: "", catch: "", servings: 1, ingredients: [{ name: "白菜", amount: "1/8玉" }], steps: [{ title: "切る", text: "白菜を切る" }, { title: "煮る", text: "煮る" }], leftoverStorage: [], sources: [], tags: {}, createdAt: 0 };
function fixture() {
  let state = initialState("owner", {}, 0, now), serial = 0;
  const run = (type: string, payload: Record<string, unknown>, place = "default") => { state = execute(state, "owner", { id: `follow-operation-${++serial}`, type, payload, locationId: place, expectedRevision: state.revision }, now); };
  return { get s() { return state; }, run, stock: () => run("lot.add", { name: "白菜", amount: "1玉", compartment: "冷蔵" }), plan: (extra = {}) => { run("plan.add", { recipe, cookAt: now, ...extra }); return state.plans.at(-1)!.id; } };
}
describe("meal groups, actual eating, equipment steps and drafts", () => {
  it("staggered main/side cooking stays grouped by stable meal ID after rename", () => {
    const f = fixture(); f.stock(); f.run("meal.add", { name: "夕食", eatAt: now }); const mealId = f.s.meals![0].id;
    const main = f.plan({ mealId }), side = f.plan({ mealId, cookAt: "2026-10-21T09:00:00Z" }), other = f.plan();
    f.run("meal.edit", { mealId, name: "早めの夕食", eatAt: now });
    f.run("plan.replace", { planId: main, recipe: { ...recipe, name: "変更後" } });
    expect(f.s.plans.find(p => p.id === side)?.reviewNeeded).toContain("副菜");
    expect(f.s.plans.find(p => p.id === other)?.reviewNeeded).toBeUndefined();
    expect(f.s.plans.find(p => p.id === side)?.mealId).toBe(mealId);
    expect(() => f.plan({ mealId: "other-location-meal" })).toThrow();
  });
  it("planned eating does not consume; actual eating and undo consume once", () => {
    const f = fixture(); f.stock(); const planId = f.plan(); f.run("cook.start", { planId });
    f.run("cook.complete", { cookingId: f.s.cooking[0].id, outputs: [{ name: "白菜料理", made: "3食", saved: "2食", left: "1食", plannedEat: "1食", locationId: "default", compartment: "冷蔵" }] });
    expect(showQuantity(f.s.lots[0].quantity)).toBe("7/8玉");
    const ep = f.s.eatingPlans![0], lot = () => f.s.lots.find(l => l.id === ep.lotId)!;
    expect(showQuantity(lot().quantity)).toBe("1食"); expect(lot().storedAt).toBeUndefined();
    f.run("eating.complete", { eatingId: ep.id, amount: "1/2食" });
    expect(showQuantity(lot().quantity)).toBe("1/2食"); expect(() => f.run("eating.complete", { eatingId: ep.id, amount: "1/2食" })).toThrow();
    f.run("transaction.undo", { transactionId: f.s.transactions.at(-1)!.id }); expect(showQuantity(lot().quantity)).toBe("1食"); expect(f.s.eatingPlans![0].status).toBe("planned");
  });
  it("cancelling planned eating releases reservations without changing stock", () => {
    const f = fixture(); f.run("lot.add", { name: "白菜料理", kind: "prepared", amount: "2食", compartment: "冷蔵" });
    f.run("eating.plan", { lotId: f.s.lots[0].id, amount: "1食", eatAt: now });
    f.plan({ recipe: { ...recipe, ingredients: [{ name: "白菜料理", amount: "2食", inventoryKind: "prepared" }] } });
    expect(showQuantity(requirements(f.s, "default", undefined, now)[0].shortage)).toBe("1食");
    f.run("eating.cancel", { eatingId: f.s.eatingPlans![0].id });
    expect(showQuantity(f.s.lots[0].quantity)).toBe("2食"); expect(showQuantity(requirements(f.s, "default", undefined, now)[0].shortage)).toBe("0食");
  });
  it("one burner can serve two cooking sessions in separate explicit steps", () => {
    const f = fixture(); f.stock(); f.run("equipment.add", { name: "コンロ", slots: 1 });
    const a = f.plan(), b = f.plan(), tool = f.s.equipment[0].id;
    for (const planId of [a, b]) f.run("plan.edit", { planId, cookAt: now, equipmentUsage: [{ equipmentId: tool, count: 1, fromStep: 3, throughStep: 3 }] });
    f.run("cook.start", { planId: a }); f.run("cook.start", { planId: b });
    const [ca, cb] = f.s.cooking;
    f.run("cook.step.start", { cookingId: ca.id, step: 3 });
    expect(() => f.run("cook.step.start", { cookingId: cb.id, step: 3 })).toThrow("同時使用");
    f.run("cook.check", { cookingId: ca.id, step: 3 });
    expect(() => f.run("cook.step.start", { cookingId: cb.id, step: 3 })).toThrow("同時使用");
    f.run("cook.step.finish", { cookingId: ca.id, step: 3 }); f.run("cook.step.start", { cookingId: cb.id, step: 3 });
    expect(f.s.cooking[1].activeStep).toBe(3);
  });
  it("incomplete nonempty imports become drafts but empty/malformed results still fail", () => {
    const out = validateImportedRecipe({ name: "白菜料理", ingredients: [{ name: "白菜" }] }, true);
    expect(out.recipe.draft).toBe(true); expect(out.missing).toContain("手順一覧");
    expect(() => validateImportedRecipe({ name: "空", ingredients: [], steps: [] }, true)).toThrow();
    expect(() => validateImportedRecipe({ name: "不正", ingredients: "白菜" }, true)).toThrow();
    const f = fixture(); f.run("recipe.save", { recipe: { ...recipe, draft: true, steps: [] } });
    expect(() => f.plan({ recipe: f.s.recipes[0] })).toThrow("下書き");
    f.run("recipe.save", { recipe: { ...f.s.recipes[0], draft: false, steps: recipe.steps } }); f.plan({ recipe: f.s.recipes[0] }); expect(f.s.plans).toHaveLength(1);
  });
  it("equipment held across several steps stays reserved between those steps", () => {
    const f = fixture(); f.stock(); f.run("equipment.add", { name: "鍋", slots: 1 });
    const a = f.plan(), b = f.plan(), equipmentId = f.s.equipment[0].id;
    for (const planId of [a, b]) f.run("plan.edit", { planId, cookAt: now, equipmentUsage: [{ equipmentId, count: 1, fromStep: 2, throughStep: 3 }] });
    f.run("cook.start", { planId: a }); f.run("cook.start", { planId: b }); const [ca, cb] = f.s.cooking;
    f.run("cook.step.start", { cookingId: ca.id, step: 2 }); f.run("cook.step.finish", { cookingId: ca.id, step: 2 });
    expect(() => f.run("cook.step.start", { cookingId: cb.id, step: 2 })).toThrow("同時使用");
    f.run("cook.step.start", { cookingId: ca.id, step: 3 }); f.run("cook.step.finish", { cookingId: ca.id, step: 3 });
    f.run("cook.step.start", { cookingId: cb.id, step: 2 }); expect(f.s.cooking[1].heldEquipment).toHaveLength(1);
  });
  it("food safety guidance retains sources and conditions without inventing expiry or heating time", () => {
    const result = storageGuidance({ kind: "prepared", category: "stew" });
    expect(result.expiry).toBeNull(); expect(result.unknown).toContain("作成日時"); expect(result.items).toHaveLength(2);
    expect(result.items.every(i => i.source.url.startsWith("https://www."))).toBe(true);
    expect(storageGuidance({ kind: "raw" }).items).toHaveLength(0);
  });
  it("unpreserved portions are not automatically proposed as stored leftovers", () => {
    const f = fixture(); f.stock(); const planId = f.plan(); f.run("cook.start", { planId });
    f.run("cook.complete", { cookingId: f.s.cooking[0].id, outputs: [{ name: "白菜料理", made: "1食", left: "1食", plannedEat: "1食" }] });
    const portion = f.s.lots.at(-1)!; expect(usable(portion, "default", now)).toBe(false);
    f.run("eating.complete", { eatingId: f.s.eatingPlans![0].id, amount: "1/2食" });
    expect(showQuantity(f.s.lots.at(-1)!.quantity)).toBe("1/2食");
  });
  it("legacy checked purchases are retained as archived and never become unpurchased demand", () => {
    const state = initialState("owner", { "fridge-app:shopping:v1": [{ id: "old-checked", name: "白菜", amount: "1玉", checked: true }] }, 4, now);
    expect(state.shopping[0].id).toBe("old-checked"); expect(state.shopping[0].archived).toBe(true); expect(state.lots).toHaveLength(0);
    const planned = execute(state, "owner", { id: "plan-from-legacy", type: "plan.add", locationId: "default", expectedRevision: 0, payload: { recipe, cookAt: now } }, now);
    expect(showQuantity(requirements(planned, "default", undefined, now)[0].ordered)).toBe("0玉");
  });
});
describe("durable multi-operation queue", () => {
  const command = (id: string, rev: number, amount = "1本"): PendingOperation => ({ owner: "owner", at: now, command: { id, type: "lot.add", locationId: "default", expectedRevision: rev, payload: { name: "にんじん", amount, compartment: "冷蔵" } } });
  it("multiple queued operations project correctly, survive reload and replay exactly once", () => {
    const data = new Map<string, string>();
    const storage: Storage = { get length() { return data.size; }, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, key: n => [...data.keys()][n] ?? null, removeItem: k => { data.delete(k); }, clear: () => data.clear() };
    const a = command("queued-operation-1", 0), b = command("queued-operation-2", 1, "2本");
    storePending(storage, a); storePending(storage, b); const reloaded = loadQueue(storage, "owner");
    const start = initialState("owner", {}, 0, now), projected = projectQueue(start, reloaded);
    expect(projected.state.lots).toHaveLength(2); expect(start.lots).toHaveLength(0);
    const accepted = execute(start, "owner", a.command, now);
    expect(projectQueue(accepted, reloaded).state.lots).toHaveLength(2);
    removePending(storage, a); expect(loadQueue(storage, "owner")).toEqual([b]);
  });
  it("conflicting revisions need explicit rebase; owner mismatch is never rebased", () => {
    const start = initialState("owner", {}, 0, now), server = execute(start, "owner", command("other-device-1", 0).command, now), pending = [command("queued-operation-1", 0)];
    expect(() => projectQueue(server, pending)).toThrow("更新");
    const preview = projectQueue(server, pending, true); expect(preview.queue[0].command.expectedRevision).toBe(1); expect(preview.state.lots).toHaveLength(2);
    expect(() => projectQueue({ ...server, owner: "someone-else" }, pending, true)).toThrow("別の利用者");
  });
  it("a rebase still rejects stale lot revisions and shortages", () => {
    const f = fixture(); f.stock(); const l = f.s.lots[0];
    const item: PendingOperation = { owner: "owner", at: now, command: { id: "queued-edit-1", type: "lot.update", locationId: "default", expectedRevision: f.s.revision, payload: { lotId: l.id, lotRevision: l.revision, amount: "1/2玉" } } };
    f.run("lot.update", { lotId: l.id, lotRevision: l.revision, amount: "3/4玉" });
    expect(() => projectQueue(f.s, [item], true)).toThrow("更新"); expect(f.s.lots[0].quantity).toEqual(parseQuantity("3/4玉"));
  });
});
