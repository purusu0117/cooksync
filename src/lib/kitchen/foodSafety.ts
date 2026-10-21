/** Curated source-backed guidance. These rules never calculate an expiry or certify food as safe. */
export interface SafetyConditions { kind: "raw" | "prepared"; category?: "stew" | "other"; compartment?: string; cookedAt?: string; storedAt?: string; storageMethod?: string }
export const safetySources = {
  household: { id: "mhlw-household-20261021", title: "厚生労働省：家庭での食中毒予防", url: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/shokuhin/syokuchu/01_00008.html", verifiedOn: "2026-10-21" },
  stew: { id: "maff-fridge-20261021", title: "農林水産省：冷蔵庫のかしこい使い方", url: "https://www.maff.go.jp/j/syouan/seisaku/foodpoisoning/frige.html", verifiedOn: "2026-10-21" },
} as const;
export function storageGuidance(conditions: SafetyConditions) {
  const unknown: string[] = [];
  if (!conditions.compartment || conditions.compartment === "未確認") unknown.push("保存区画");
  if (conditions.kind === "prepared" && !conditions.cookedAt) unknown.push("作成日時");
  if (!conditions.storedAt) unknown.push("保存日時");
  if (!conditions.storageMethod) unknown.push("実際の保存方法");
  const items: { text: string; source: { id: string; title: string; url: string; verifiedOn: string } }[] = conditions.kind === "prepared" ? [{ text: "清潔な器具と容器を使い、早く冷えるよう浅い容器に分けて保存します。室温に長く置かないようにします。", source: safetySources.household }] : [];
  if (conditions.kind === "prepared" && conditions.category === "stew") items.push({ text: "煮込み料理は鍋のまま放置せず、小分けして短時間で冷やします。温め直す際は十分に加熱します。", source: safetySources.stew });
  return { status: "conditions_required" as const, expiry: null, unknown, items, limitation: "保存温度・冷却までの時間・食品の条件を確認できないため、保存できる日数や食べられる安全性は確定しません。加熱条件は対象食品の出典・包装表示を確認してください。" };
}
