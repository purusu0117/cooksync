import type { KitchenCommand, KitchenState } from "./model";
export function operationSummary(state: KitchenState | null | undefined, command: KitchenCommand): string[] {
  const p = command.payload;
  const labels: Record<string, string> = { "lot.add": "在庫を追加", "lot.update": "残量・保存先の更新", "lot.eat": "食べた量の記録", "lot.discard": "廃棄の記録", "shopping.add": "買い物に追加", "shopping.edit": "購入予定の編集", "shopping.purchase": "実購入の確定", "shopping.recalculate": "不足分の再計算", "purchase.correct": "実購入量の訂正", "plan.add": "献立を追加", "plan.edit": "献立の量・予定を更新", "plan.replace": "料理の差し替え", "plan.skip": "外食・作らなかった", "cook.start": "調理開始", "cook.complete": "調理・保存の確定", "cook.cancel": "調理中断", "eating.complete": "実食の記録", "eating.plan": "食べる予定", "eating.cancel": "食べる予定の取消", "recipe.save": "レシピの保存", "transaction.undo": "履歴の取消" };
  const location = state?.locations.find(l => l.id === command.locationId)?.name || "選択した場所";
  const name = p.name || state?.lots.find(l => l.id === p.lotId)?.name || state?.plans.find(v => v.id === p.planId)?.name || state?.shopping.find(r => r.id === p.shoppingId)?.name;
  const lines = [`${location}：${labels[command.type] || "入力内容の保存"}${name ? `（${name}）` : ""}`];
  for (const [key, label] of Object.entries({ amount: "数量", contents: "包装の入数", product: "商品", store: "店舗", compartment: "保存区画", condition: "状態", cookAt: "調理日時", eatAt: "食べる日時", storageMethod: "保存方法", note: "メモ", reason: "理由" })) if (typeof p[key] === "string" && p[key]) lines.push(`${label}：${p[key]}`);
  const r = p.recipe as { name?: string; ingredients?: { name: string; amount: string }[] } | undefined;
  if (r?.name) lines.push(`料理：${r.name}`, ...(r.ingredients || []).map(i => `${i.name}：${i.amount || "量不明"}`));
  for (const d of (Array.isArray(p.actual) ? p.actual : Array.isArray(p.demands) ? p.demands : []) as { name: string; amount: string }[]) lines.push(`使用量：${d.name} ${d.amount || "量不明"}`);
  for (const o of (Array.isArray(p.outputs) ? p.outputs : []) as Record<string, unknown>[]) lines.push(`${o.name}：完成 ${o.made} / 食べた ${o.eaten || "0"} / 保存 ${o.saved || "0"} / 未保存 ${o.left || "0"} / 廃棄 ${o.discarded || "0"}`);
  return lines;
}
