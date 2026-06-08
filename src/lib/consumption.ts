// Step 0b：直近の食事計画から「使い切ったはずの食材」を推定し、ゾーン別に削除提案を組む。
// 生鮮=全量消費とみなし自動削除提案 / 野菜=量を確認 / 冷凍=残量確認 / 乾物・調味料=自動削除しない。

import type { FridgeItem } from "./food";
import { ingredientMatches } from "./recipe";

export interface ConsumptionPlan {
  autoRemove: FridgeItem[]; // 生鮮：全量消費とみなして削除提案
  askAmount: FridgeItem[]; // 野菜：全部使った？一部残ってる？
  askFrozen: FridgeItem[]; // 冷凍：残量確認
  keep: FridgeItem[]; // 乾物・調味料：削除しない
}

/**
 * 直近の料理で使ったはずの食材名(consumedNames)を冷蔵庫(fridge)と突き合わせ、
 * マッチした食材をゾーン別ルールで分類する。マッチしない食材は対象外。
 */
export function inferConsumed(
  consumedNames: string[],
  fridge: FridgeItem[],
  matches: (a: string, b: string) => boolean = ingredientMatches,
): ConsumptionPlan {
  const plan: ConsumptionPlan = {
    autoRemove: [],
    askAmount: [],
    askFrozen: [],
    keep: [],
  };

  for (const item of fridge) {
    const used = consumedNames.some((n) => matches(item.name, n));
    if (!used) continue;

    switch (item.zone) {
      case "生鮮":
        plan.autoRemove.push(item);
        break;
      case "野菜":
        plan.askAmount.push(item);
        break;
      case "冷凍":
        plan.askFrozen.push(item);
        break;
      // 乾物・調味料 / その他 は残量管理しない
      default:
        plan.keep.push(item);
        break;
    }
  }
  return plan;
}
