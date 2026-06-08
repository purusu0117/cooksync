"use client";

import Link from "next/link";
import { useAllRecipes } from "@/lib/useStore";

const CUISINE_TAG: Record<string, string> = {
  和: "bg-amber-100 text-amber-700",
  洋: "bg-emerald-100 text-emerald-700",
  中: "bg-red-100 text-red-700",
  アジアン: "bg-orange-100 text-orange-700",
};

export default function RecipeList() {
  const recipes = useAllRecipes();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">🍴 レシピ</h1>
        <p className="mt-1 text-sm text-ink-soft">
          作って良かった実在レシピ。献立提案の母集団になります。
        </p>
      </header>

      {(
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {recipes.map((r) => (
            <li key={r.id}>
              <Link
                href={`/recipes/${r.id}`}
                className="animate-pop-in flex h-full flex-col rounded-2xl border border-line bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-2xl" aria-hidden>
                    {r.emoji}
                  </span>
                  <h2 className="font-semibold text-ink">{r.name}</h2>
                </div>
                <p className="mb-3 flex-1 text-xs leading-relaxed text-ink-soft">
                  {r.catch}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {r.tags.cuisine && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CUISINE_TAG[r.tags.cuisine] ?? "bg-line text-ink-soft"}`}
                    >
                      {r.tags.cuisine}
                    </span>
                  )}
                  {r.tags.cookTime && (
                    <span className="rounded-full bg-line px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                      〜{r.tags.cookTime}分
                    </span>
                  )}
                  {r.tags.staple && (
                    <span className="rounded-full bg-line px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                      {r.tags.staple}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
