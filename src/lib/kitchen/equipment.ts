import type { EquipmentUse, KitchenState, Plan } from "./model";
import { compare, convert, parseQuantity } from "./quantity";
export function usesAtStep(use: EquipmentUse, step?: number): boolean {
  // Legacy whole-cooking reservations stay occupied until completion.
  return use.fromStep === undefined || (step !== undefined && step >= use.fromStep && step <= (use.throughStep ?? use.fromStep));
}
export function equipmentIssues(state: KitchenState, plan: Plan, step?: number): string[] {
  const issues: string[] = [];
  for (const use of plan.equipmentUsage || []) {
    const tool = state.equipment.find(e => e.id === use.equipmentId && e.locationId === plan.locationId);
    if (!tool) { issues.push("選択した道具がなくなりました"); continue; }
    const occupied = state.cooking.filter(c => !c.completedBy && c.planId !== plan.id && c.locationId === plan.locationId)
      .flatMap(c => {
        const registered = state.plans.find(p => p.id === c.planId)?.equipmentUsage || [];
        return [...registered.filter(u => u.fromStep === undefined), ...(c.heldEquipment ?? registered.filter(u => u.fromStep !== undefined && usesAtStep(u, c.activeStep)))];
      }).filter(u => u.equipmentId === tool.id).reduce((n, u) => n + u.count, 0);
    if (use.count > (tool.slots || 1) || (usesAtStep(use, step) && occupied + use.count > (tool.slots || 1))) issues.push(`${tool.name}は同時使用できる数を超えます。先の工程を完了するか、使う道具を見直してください`);
    if (use.amount) {
      const amount = parseQuantity(use.amount), capacity = parseQuantity(tool.capacity);
      const matching = amount && capacity && convert(amount, capacity.unit);
      if (!matching || !capacity) issues.push(`${tool.name}の容量と使用量を同じ単位で確認してください`);
      else if (compare(matching.value, capacity.value) > 0) issues.push(`${tool.name}の登録容量を超えています。分けて調理するなど手順を見直してください`);
    }
  }
  return issues;
}
