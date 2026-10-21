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
  return <>{["/", "/fridge", "/shopping", "/meal"].includes(path) && <Link href="/kitchen" className="block mx-4 mt-3 rounded-xl border border-emerald-700/20 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{snapshot?.state ? "場所・残量・調理の確認" : "買い物から残りの保存まで、つなげて管理する"}</Link>}{children}</>;
}
export default function KitchenGate({ children }: { children: React.ReactNode }) { return <KitchenProvider><Gate>{children}</Gate></KitchenProvider>; }
