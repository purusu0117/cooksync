import { describe, expect, it } from "vitest";
import { execute, initialState, packageSuggestion } from "../engine";
import { evidencedWeight, parseQuantity, remainingLabel, showQuantity, convert } from "../quantity";
import { requirements } from "../planning";
import { feedbackMatches } from "../quality";
import type { KitchenCommand, KitchenState } from "../model";
import type { Recipe } from "../../recipe";
const now = "2026-10-21T10:00:00.000Z";
function fixture() {
  let s = initialState("owner", {}, 0, now), serial = 0;
  const run = (type: string, payload: Record<string, unknown>, locationId = "default") => { const c: KitchenCommand = { id: `operation-${++serial}`, type, payload, locationId, expectedRevision: s.revision }; s = execute(s, "owner", c, now); return c; };
  const stock = (name: string, amount: string, extra = {}) => { run("lot.add", { name, amount, compartment: "冷蔵", ...extra }); return s.lots.at(-1)!; };
  const plan = (name: string, amount: string, extra: Record<string, unknown> = {}) => { const r: Recipe = { id: `recipe-${serial}`, name: "テスト料理", emoji: "", catch: "", servings: 1, ingredients: [{ name, amount }], steps: [{ title: "準備", text: "準備する" }], leftoverStorage: [], sources: [], tags: {}, createdAt: 0 }; run("plan.add", { recipe: r, cookAt: now, ...extra }); return s.plans.at(-1)!; };
  const cook = (planId: string, extra = {}) => { run("cook.start", { planId }); const c = s.cooking.at(-1)!; run("cook.complete", { cookingId: c.id, ...extra }); return s.transactions.at(-1)!; };
  return { get s() { return s; }, run, stock, plan, cook };
}
describe("one-tap removal commands", () => {
  it("lot.remove takes stock out of use in one step and is reversible from the history", () => {
    const f = fixture(); const l = f.stock("白菜", "1/4玉");
    f.run("lot.remove", { lotId: l.id });
    expect(f.s.lots[0].presence).toBe("ない"); expect(showQuantity(f.s.lots[0].quantity)).toBe("0玉");
    expect(requirements(f.s, "default", undefined, now)).toHaveLength(0);
    const tx = f.s.transactions.at(-1)!; expect(tx.type).toBe("lot.remove"); expect(tx.note).toContain("削除");
    f.run("transaction.undo", { transactionId: tx.id });
    expect(f.s.lots[0].presence).toBe("ある"); expect(showQuantity(f.s.lots[0].quantity)).toBe("1/4玉");
    // Unknown quantities can be removed too; nothing is invented.
    const u = f.stock("豆腐", ""); f.run("lot.remove", { lotId: u.id }); expect(f.s.lots[1].presence).toBe("ない"); expect(f.s.lots[1].quantity).toBeNull();
  });
  it("shopping.remove hides an unpurchased row without touching purchases", () => {
    const f = fixture(); f.run("shopping.add", { name: "にんじん", amount: "2本" }); const row = f.s.shopping[0];
    f.run("shopping.remove", { shoppingId: row.id });
    expect(f.s.shopping[0].removedBy).toBeTruthy(); expect(f.s.lots).toHaveLength(0);
    expect(() => f.run("shopping.purchase", { shoppingId: row.id, amount: "2本" })).toThrow("外して");
    f.run("shopping.add", { name: "卵", amount: "3個" }); f.run("shopping.purchase", { shoppingId: f.s.shopping[1].id, amount: "3個", compartment: "冷蔵" });
    expect(() => f.run("shopping.remove", { shoppingId: f.s.shopping[1].id })).toThrow("購入済み");
  });
  it("location.remove deletes only an empty place and never the last one", () => {
    const f = fixture(); expect(() => f.run("location.remove", {})).toThrow("最後の場所");
    f.run("location.add", { name: "実家" }); const home = f.s.locations[1].id;
    f.stock("白菜", "1/4玉", {}); f.run("lot.update", { lotId: f.s.lots[0].id, lotRevision: f.s.lots[0].revision, targetLocationId: home });
    expect(() => f.run("location.remove", {}, home)).toThrow("在庫");
    f.run("lot.remove", { lotId: f.s.lots[0].id }, home);
    f.run("location.remove", {}, home);
    expect(f.s.locations.map(l => l.name)).toEqual(["いつもの場所"]);
    expect(() => f.run("lot.add", { name: "卵", amount: "1個" }, home)).toThrow("利用できません");
  });
});
describe("quantity and allocation acceptance", () => {
  it("uses an exact prepared serving with a storage note without consuming its raw ingredients", () => {
    const f = fixture(); f.stock("ミートソース", "2食", { kind: "prepared" }); f.stock("肉", "100g");
    const amount = "1食分（冷蔵の作り置きを使用）";
    const r: Recipe = { id: "prepared-reuse", name: "グラタン", emoji: "", catch: "", servings: 1, ingredients: [{ name: "ミートソース", amount, inventoryKind: "prepared" }], steps: [{ title: "準備", text: "確認する" }], leftoverStorage: [], sources: [], tags: {}, createdAt: 0 };
    f.run("plan.add", { recipe: r, cookAt: now });
    expect(showQuantity(requirements(f.s, "default", undefined, now)[0].shortage)).toBe("0食");
    expect(f.s.plans[0].recipe.ingredients[0].amount).toBe(amount);
    f.cook(f.s.plans[0].id);
    expect(f.s.lots.slice(0, 2).map(l => showQuantity(l.quantity))).toEqual(["1食", "100g"]);
  });
  it("keeps approximate, conditional or quantity-changing serving notes unknown", () => {
    expect(showQuantity(parseQuantity("1/2食分（冷凍）"))).toBe("1/2食");
    for (const amount of ["約1食分", "1〜2食分", "1食分（半分だけ使用）", "1食分（量不明）", "1食分（約200g）", "1食分（あれば使用）"]) expect(parseQuantity(amount)).toBeNull();
  });
  it("a location's expiry date uses that location's timezone", () => {
    const f = fixture(); f.run("location.rename", { name: "日本の台所", timeZone: "Asia/Tokyo" });
    f.stock("白菜", "1玉", { expiresOn: "2026-10-21" }); f.plan("白菜", "1/4玉", { cookAt: "2026-10-21T16:00:00.000Z" });
    expect(showQuantity(requirements(f.s, "default", undefined, now)[0].shortage)).toBe("1/4玉");
  });
  it("unmeasured finished food remains unknown until the owner confirms it", () => {
    const f = fixture(); f.stock("白菜", "1/4玉"); const p = f.plan("白菜", "1/8玉");
    f.cook(p.id, { unknownOutput: true });
    expect(f.s.lots[1].quantity).toBeNull(); expect(f.s.lots[1].presence).toBe("未確認"); expect(f.s.lots[1].storedAt).toBeUndefined();
  });
  it("feedback for an old recipe version is not automatically applied to the revised version", () => {
    const f = fixture(), p = f.plan("白菜", "1/8玉"); f.run("feedback.save", { recipeId: p.recipe.id, notes: "塩辛い" });
    const feedback = f.s.feedback[0]; expect(feedbackMatches(feedback, p.recipe)).toBe(true);
    expect(feedbackMatches(feedback, { ...p.recipe, servings: 3 })).toBe(false);
  });
  it("A26 two burners cannot be allocated to three simultaneous dishes; capacity is checked", () => {
    const f = fixture(); f.run("equipment.add", { name: "コンロ", slots: 2 }); f.run("equipment.add", { name: "鍋", capacity: "2L" });
    f.stock("白菜", "1玉"); const plans = Array.from({ length: 3 }, () => f.plan("白菜", "1/8玉"));
    for (const p of plans) f.run("plan.edit", { planId: p.id, cookAt: now, equipmentUsage: [{ equipmentId: f.s.equipment[0].id, count: 1 }] });
    f.run("cook.start", { planId: plans[0].id }); f.run("cook.start", { planId: plans[1].id });
    expect(() => f.run("cook.start", { planId: plans[2].id })).toThrow("同時使用");
    f.run("plan.edit", { planId: plans[2].id, cookAt: now, equipmentUsage: [{ equipmentId: f.s.equipment[1].id, count: 1, amount: "3L" }] });
    expect(() => f.run("cook.start", { planId: plans[2].id })).toThrow("登録容量");
    f.run("plan.edit", { planId: plans[2].id, cookAt: now, equipmentUsage: [{ equipmentId: f.s.equipment[1].id, count: 1, amount: "1L" }] });
    f.run("cook.start", { planId: plans[2].id }); expect(f.s.cooking).toHaveLength(3);
  });
  it("A26 changing a dish recalculates demand and requires side-dish review", () => {
    const f = fixture(); f.stock("白菜", "1玉"); const main = f.plan("白菜", "1/8玉"), side = f.plan("白菜", "1/8玉");
    f.run("plan.replace", { planId: main.id, recipe: { ...main.recipe, ingredients: [{ name: "白菜", amount: "1/4玉" }] } });
    expect(showQuantity(requirements(f.s, "default")[0].quantity)).toBe("3/8玉");
    expect(() => f.run("cook.start", { planId: side.id })).toThrow("副菜");
    f.run("plan.edit", { planId: side.id, cookAt: now, demands: [{ name: "白菜", amount: "1/16玉" }] });
    expect(showQuantity(requirements(f.s, "default")[0].quantity)).toBe("5/16玉");
    f.run("cook.start", { planId: side.id });
  });
  it("weight annotations use only this lot's explicit evidence", () => {
    const f = fixture(), q = parseQuantity("1/8玉")!;
    const l = f.stock("白菜", "1/4玉", { weightGrams: "300g", weightBasis: "はかりで計量" });
    expect(evidencedWeight(q, l.weightEvidence)).toBe("150g（はかりで計量）");
    expect(evidencedWeight(q)).toBeNull(); expect(evidencedWeight(parseQuantity("1本")!, l.weightEvidence)).toBeNull();
    f.run("lot.update", { lotId: l.id, lotRevision: 0, weightGrams: "300g", weightEstimated: "on", weightBasis: "包装の目安" });
    expect(evidencedWeight(q, f.s.lots[0].weightEvidence)).toContain("約150g");
    expect(() => f.stock("白菜", "1/4玉", { weightGrams: "300g" })).toThrow();
  });
  it("eating a prepared lot is distinct from reuse or disposal and can be undone", () => {
    const f = fixture(), l = f.stock("ミートソース", "2食", { kind: "prepared" });
    const command = f.run("lot.eat", { lotId: l.id, amount: "1食" });
    expect(showQuantity(f.s.lots[0].quantity)).toBe("1食"); expect(execute(f.s, "owner", command, now)).toBe(f.s);
    f.run("transaction.undo", { transactionId: f.s.transactions.at(-1)!.id }); expect(showQuantity(f.s.lots[0].quantity)).toBe("2食");
  });
  it("A01/A02 exact cabbage fractions and a new remaining basis", () => {
    const f = fixture(); f.stock("白菜", "1/4玉"); const p = f.plan("白菜", "1/8玉");
    f.run("cook.start", { planId: p.id }); const c = f.s.cooking.at(-1)!;
    expect(remainingLabel("白菜", c.allocations[0].basis, c.allocations[0].quantity).primary).toBe("残っている白菜の半分を使う");
    f.run("cook.complete", { cookingId: c.id }); expect(showQuantity(f.s.lots[0].quantity)).toBe("1/8玉");
    const p2 = f.plan("白菜", "1/16玉"); f.run("cook.start", { planId: p2.id }); const a = f.s.cooking.at(-1)!.allocations[0];
    expect(remainingLabel("白菜", a.basis, a.quantity).primary).toContain("半分");
    f.run("cook.complete", { cookingId: f.s.cooking.at(-1)!.id }); expect(showQuantity(f.s.lots[0].quantity)).toBe("1/16玉");
  });
  it("A03 unknown, zero, ranges and incompatible units never invent fractions or grams", () => {
    expect(parseQuantity("約200g")).toBeNull(); expect(parseQuantity("2〜3本")).toBeNull(); expect(parseQuantity("1/0玉")).toBeNull();
    expect(remainingLabel("白菜", null, parseQuantity("1/8玉")).primary).toContain("確認");
    expect(remainingLabel("白菜", parseQuantity("0玉"), parseQuantity("1/8玉")).primary).toContain("なし");
    expect(remainingLabel("白菜", parseQuantity("200g"), parseQuantity("1/8玉")).primary).toContain("単位");
    expect(showQuantity(convert(parseQuantity("0.125kg")!, "g"))).toBe("125g");
  });
  it("A04 subtracts total once across two lots", () => {
    const f = fixture(); f.stock("にんじん", "1本"); f.stock("にんじん", "1本"); const p = f.plan("にんじん", "1本"); f.cook(p.id);
    expect(f.s.lots.map(l => showQuantity(l.quantity))).toEqual(["0本", "1本"]);
  });
  it("A05/A06/A07 aggregate 1+2, stock1, shortage2 for every projection", () => {
    const f = fixture(); f.stock("にんじん", "1本"); f.plan("にんじん", "1本"); f.plan("人参", "2本"); const rows = requirements(f.s, "default");
    expect(rows).toHaveLength(1); expect(showQuantity(rows[0].quantity)).toBe("3本"); expect(showQuantity(rows[0].shortage)).toBe("2本");
    f.run("shopping.recalculate", {}); expect(showQuantity(f.s.shopping[0].quantity)).toBe("2本");
  });
  it("A08 retains manual quantities, regenerates only unmet demand", () => {
    const f = fixture(); f.plan("にんじん", "3本"); f.run("shopping.add", { name: "にんじん", amount: "1本" }); f.run("shopping.recalculate", {});
    expect(f.s.shopping.map(r => showQuantity(r.quantity))).toEqual(["1本", "2本"]); const manualId = f.s.shopping[0].id;
    f.run("shopping.recalculate", {}); expect(f.s.shopping).toHaveLength(2); expect(f.s.shopping[0].id).toBe(manualId);
  });
  it("A09 package counts depend on shortage, not previous bag count", () => {
    expect(packageSuggestion(parseQuantity("2本")!, parseQuantity("3本")!)?.count.n).toBe("1");
    expect(packageSuggestion(parseQuantity("5本")!, parseQuantity("3本")!)?.count.n).toBe("2");
  });
  it("A10/A11 package profiles are scoped and only purchase adds inventory", () => {
    const f = fixture();
    for (const store of ["A店", "B店"]) {
      f.run("shopping.add", { name: "にんじん", amount: "2本" }); const row = f.s.shopping.at(-1)!;
      const body = { shoppingId: row.id, amount: "3本", product: "にんじん袋", store, contents: store === "A店" ? "3本" : "5本", remember: true, compartment: "冷蔵" };
      const count = f.s.lots.length; f.run("shopping.edit", body); expect(f.s.lots).toHaveLength(count); f.run("shopping.purchase", body);
    }
    expect(f.s.packages).toHaveLength(2); expect(f.s.lots.map(l => showQuantity(l.quantity))).toEqual(["3本", "3本"]);
  });
  it("A12 same operation replays, another operation cannot buy twice, compensating undo is single-use", () => {
    const f = fixture(); f.run("shopping.add", { name: "にんじん", amount: "3本" }); const body = { shoppingId: f.s.shopping[0].id, amount: "3本", compartment: "冷蔵" };
    const c = f.run("shopping.purchase", body); const same = execute(f.s, "owner", c, now); expect(same).toBe(f.s);
    expect(() => f.run("shopping.purchase", body)).toThrow("購入済み");
    const tx = f.s.transactions.at(-1)!; f.run("transaction.undo", { transactionId: tx.id }); expect(showQuantity(f.s.lots[0].quantity)).toBe("0本");
    expect(() => f.run("transaction.undo", { transactionId: tx.id })).toThrow();
  });
  it("purchase correction preserves consumption rather than restoring a snapshot", () => {
    const f = fixture(); f.run("shopping.add", { name: "にんじん", amount: "6本" }); f.run("shopping.purchase", { shoppingId: f.s.shopping[0].id, amount: "6本", compartment: "冷蔵" }); const purchase = f.s.transactions.at(-1)!;
    const p = f.plan("にんじん", "1本"); f.cook(p.id); f.run("purchase.correct", { transactionId: purchase.id, amount: "4本" });
    expect(showQuantity(f.s.lots[0].quantity)).toBe("3本"); expect(() => f.run("purchase.correct", { transactionId: purchase.id, amount: "0本" })).toThrow();
  });
  it("A13/A14 locations remain stable across switching and renaming", () => {
    const f = fixture(); f.stock("白菜", "1/4玉"); f.run("location.add", { name: "旅行先" }); const b = f.s.locations[1].id;
    f.run("location.rename", { name: "キッチンB" }, b); expect(f.s.lots[0].locationId).toBe("default");
    expect(() => f.run("lot.discard", { lotId: f.s.lots[0].id, amount: "1/8玉" }, b)).toThrow("見つかりません");
    const state = initialState("owner", { "fridge-app:items:v2": [{ id: "old", name: "白菜", quantity: "1/4玉", zone: "野菜", expiresOn: "2026-10-30" }] }, 7, now);
    expect(state.lots[0].id).toBe("old"); expect(state.lots[0].compartment).toBe("未確認"); expect(state.migration.legacyRevision).toBe(7);
  });
  it("A15/A16/A17 prepared food consumes finished inventory only", () => {
    const f = fixture(); f.stock("にんじん", "3本"); const p = f.plan("にんじん", "1本");
    f.cook(p.id, { outputs: [{ name: "ミートソース", made: "3食", eaten: "1食", saved: "2食", locationId: "default", compartment: "冷凍", method: "容器で小分け" }] });
    expect(f.s.lots).toHaveLength(2); expect(showQuantity(f.s.lots[0].quantity)).toBe("2本"); const prepared = f.s.lots[1];
    const reuse = f.plan("ミートソース", "1食", { demands: [{ name: "ミートソース", amount: "1食", kind: "prepared", lotId: prepared.id }] }); f.cook(reuse.id);
    expect(showQuantity(f.s.lots[0].quantity)).toBe("2本"); expect(showQuantity(f.s.lots[1].quantity)).toBe("1食");
  });
  it("A18 partial cook, outside meal, transfer and waste are separate", () => {
    const f = fixture(); f.stock("にんじん", "3本"); const p = f.plan("にんじん", "2本"); f.cook(p.id, { actual: [{ name: "にんじん", amount: "1本" }], partial: true });
    expect(f.s.plans[0].status).toBe("partial"); expect(showQuantity(requirements(f.s, "default")[0].quantity)).toBe("1本");
    f.run("plan.skip", { planId: p.id }); expect(showQuantity(f.s.lots[0].quantity)).toBe("2本");
    f.run("lot.discard", { lotId: f.s.lots[0].id, amount: "1本" }); expect(showQuantity(f.s.lots[0].quantity)).toBe("1本");
  });
  it("A19 stale cooking basis blocks deduction; source recipe edits do not rewrite steps", () => {
    const f = fixture(); const lot = f.stock("白菜", "1/4玉"); const p = f.plan("白菜", "1/8玉"); f.run("cook.start", { planId: p.id });
    const c = f.s.cooking[0]; f.run("lot.update", { lotId: lot.id, lotRevision: lot.revision, amount: "1/8玉" });
    expect(() => f.run("cook.complete", { cookingId: c.id })).toThrow("在庫が変わり"); expect(c.recipe.steps[0].text).toBe("準備する");
  });
  it("future stock, expired stock, missing or unverified lots are not usable now", () => {
    const f = fixture(); f.stock("にんじん", "3本", { availableAt: "2026-10-22T10:00:00Z" }); f.stock("にんじん", "5本", { expiresOn: "2026-10-20" }); f.plan("にんじん", "2本");
    expect(showQuantity(requirements(f.s, "default")[0].shortage)).toBe("2本");
  });
  it("A22 authorization, stale revisions and operation payload conflicts fail closed", () => {
    const f = fixture(); const c = f.run("location.rename", { name: "A" });
    expect(() => execute(f.s, "other", c, now)).toThrow();
    expect(() => execute(f.s, "owner", { ...c, payload: { name: "B" } }, now)).toThrow("内容が変わって");
    expect(() => execute(f.s, "owner", { ...c, id: "new-operation", expectedRevision: 0 }, now)).toThrow("更新");
  });
  it("actual-use edits cannot consume another plan's reservation", () => {
    const f = fixture(); f.stock("にんじん", "3本"); const a = f.plan("にんじん", "1本"); f.plan("にんじん", "2本"); f.run("cook.start", { planId: a.id });
    expect(() => f.run("cook.complete", { cookingId: f.s.cooking[0].id, actual: [{ name: "にんじん", amount: "2本" }] })).toThrow();
  });
  it("failed commands leave original state unchanged", () => {
    const f = fixture(); f.stock("にんじん", "1本"); const before: KitchenState = structuredClone(f.s);
    expect(() => f.run("lot.discard", { lotId: f.s.lots[0].id, amount: "2本" })).toThrow(); expect(f.s).toEqual(before);
  });
  it("two lots share a larger requirement without over-subtraction", () => {
    const f = fixture(); f.stock("にんじん", "1本"); f.stock("にんじん", "3本"); const p = f.plan("にんじん", "3本"); f.cook(p.id);
    expect(f.s.lots.map(l => showQuantity(l.quantity))).toEqual(["0本", "1本"]);
  });
  it("late cooking uses current purchased stock, not the truncated minute of the old plan", () => {
    const f = fixture(); f.stock("白菜", "1/4玉"); f.plan("白菜", "1/8玉", { cookAt: "2026-10-21T09:59:00Z" });
    expect(showQuantity(requirements(f.s, "default", undefined, now)[0].shortage)).toBe("0玉");
  });
  it("planned purchases after cooking do not reduce the add-to-shopping requirement", () => {
    const f = fixture(); f.plan("にんじん", "2本"); f.run("shopping.add", { name: "にんじん", amount: "2本" });
    f.run("shopping.edit", { shoppingId: f.s.shopping[0].id, amount: "2本", availableAt: "2026-10-22T10:00:00Z" });
    expect(showQuantity(requirements(f.s, "default", undefined, now)[0].toAdd)).toBe("2本");
  });
  it("left-but-unsaved food is distinct from confirmed stored food", () => {
    const f = fixture(); f.stock("にんじん", "1本"); const p = f.plan("にんじん", "1本");
    f.cook(p.id, { outputs: [{ name: "完成料理", made: "3食", eaten: "1食", saved: "1食", left: "1食", locationId: "default", compartment: "冷蔵" }] });
    const prepared = f.s.lots.filter(l => l.kind === "prepared"); expect(prepared).toHaveLength(2);
    expect(prepared[0].storedAt).toBe(now); expect(prepared[1].storedAt).toBeUndefined(); expect(prepared[1].presence).toBe("未確認");
  });
  it("different operation IDs cannot complete the same cooking twice", () => {
    const f = fixture(); f.stock("白菜", "1/4玉"); const p = f.plan("白菜", "1/8玉"); const tx = f.cook(p.id);
    expect(() => f.run("cook.complete", { cookingId: tx.cookingId })).toThrow("終了"); expect(showQuantity(f.s.lots[0].quantity)).toBe("1/8玉");
  });
  it("cooking steps including equipment stay frozen; retired feedback does not resurrect", () => {
    const f = fixture(); f.run("equipment.add", { name: "鍋", capacity: "2L" }); f.stock("白菜", "1/4玉"); const p = f.plan("白菜", "1/8玉"); f.run("cook.start", { planId: p.id });
    const frozen = structuredClone(f.s.cooking[0].steps); f.run("equipment.add", { name: "フライパン", capacity: "26cm" }); expect(f.s.cooking[0].steps).toEqual(frozen);
    f.run("feedback.save", { recipeId: p.recipe.id, notes: "古い感想" }); f.run("feedback.save", { recipeId: p.recipe.id, notes: "訂正済み" });
    expect(f.s.feedback.filter(v => v.active)).toHaveLength(1); f.run("feedback.retire", { feedbackId: f.s.feedback.at(-1)!.id }); expect(f.s.feedback.filter(v => v.active)).toHaveLength(0);
  });
  it("legacy checked/made flags never replay inventory changes", () => {
    const old = { "fridge-app:items:v2": [{ id: "old", name: "白菜", quantity: "1/4玉" }], "fridge-app:shopping:v1": [{ id: "checked", name: "にんじん", amount: "3本", checked: true }], "fridge-app:meals:v1": [{ id: "made", made: true }] };
    const s = initialState("owner", old, 0, now);
    expect(s.lots).toHaveLength(1); expect(showQuantity(s.lots[0].quantity)).toBe("1/4玉"); expect(s.shopping[0].purchasedBy).toBeUndefined(); expect(s.migration.original).toEqual(old);
  });
});
