"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { KitchenProvider, useKitchen } from "@/lib/kitchen/client";
import KitchenScreen from "./KitchenScreen";
function Gate({ children }: { children: React.ReactNode }) {
  const path = usePathname(), { snapshot } = useKitchen();
  const modes: Record<string, "inventory" | "shopping" | "plans"> = { "/": "plans", "/recipes": "plans", "/fridge": "inventory", "/shopping": "shopping", "/meal": "plans" };
  if (snapshot?.state && modes[path]) return <KitchenScreen initialTab={modes[path]} />;
  const recipe = path.match(/^\/recipes\/([^/]+)$/);
  if (snapshot?.state && recipe && !["new", "import"].includes(recipe[1])) return <KitchenScreen recipeId={decodeURIComponent(recipe[1])} />;
  return <>{["/", "/fridge", "/shopping", "/meal"].includes(path) && <section className="mx-4 mt-3 rounded-xl border border-emerald-700/20 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><p className="font-bold">自宅・実家など、使う冷蔵庫を切り替える</p><p className="mt-1 text-xs">初回は在庫の引継ぎ内容を確認すると、保管場所の追加・選択が使えます。</p><Link href="/kitchen" className="mt-2 inline-block min-h-11 rounded-lg bg-emerald-800 px-4 py-3 font-bold text-white">冷蔵庫・保管場所を設定する</Link></section>}{children}</>;
}
export default function KitchenGate({ children }: { children: React.ReactNode }) { return <KitchenProvider><Gate>{children}</Gate></KitchenProvider>; }
