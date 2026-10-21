"use client";
import { usePersistentList } from "@/lib/useStore";
import { fridgeStore, shoppingStore, recipeStore, mealStore } from "@/lib/storage";
import { useSyncState } from "@/lib/syncStore";
import { useKitchen } from "@/lib/kitchen/client";
export default function DeviceImport() {
  const [fridge] = usePersistentList(fridgeStore), [shopping] = usePersistentList(shoppingStore), [recipes] = usePersistentList(recipeStore), [meals] = usePersistentList(mealStore);
  const sync = useSyncState(), { activate, busy } = useKitchen();
  const total = fridge.length + shopping.length + recipes.length + meals.length;
  if (!total) return null;
  return <details className="rounded-xl border border-stone-200 p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">この端末にある以前のデータを確認（{total}件）</summary><div className="space-y-3 text-sm"><p>在庫{fridge.length}件、買い物{shopping.length}件、レシピ{recipes.length}件、献立履歴{meals.length}件をコピーできます。元データは残ります。以前の画面で行った追加変更は、自動では結合しません。</p><ul>{fridge.map(l => <li key={l.id}>{l.name}：{l.quantity || "量不明"}</li>)}</ul>{sync.pending > 0 || !sync.hydrated ? <p>以前のデータの同期完了を待っています。未送信の変更は先に保存してください。</p> : <button disabled={busy} className="min-h-11 rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white disabled:opacity-50" onClick={() => void activate({ [fridgeStore.key]: fridge, [shoppingStore.key]: shopping, [recipeStore.key]: recipes, [mealStore.key]: meals })}>表示内容が自分のデータであることを確認してコピー</button>}</div></details>;
}
