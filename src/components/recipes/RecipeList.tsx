"use client";

import Link from "next/link";
import { useAllRecipes } from "@/lib/useStore";
import PageHeader from "@/components/PageHeader";

const CUISINE_GRADIENT: Record<string, string> = {
  和: "from-emerald-100 to-lime-50",
  洋: "from-amber-100 to-orange-50",
  中: "from-rose-100 to-orange-50",
  アジアン: "from-orange-100 to-yellow-50",
};

export default function RecipeList() {
  const recipes = useAllRecipes();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6">
      <PageHeader
        title="レシピ"
        tagline="作って良かった実在レシピ。献立提案の母集団になります。"
      />

      <ul className="grid grid-cols-2 gap-3">
        {recipes.map((r) => (
          <li key={r.id}>
            <Link
              href={`/recipes/${r.id}`}
              className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div
                className={`grid h-28 place-items-center bg-gradient-to-br text-5xl ${
                  CUISINE_GRADIENT[r.tags.cuisine ?? ""] ?? "from-brand-soft to-emerald-50"
                }`}
              >
                <span aria-hidden>{r.emoji}</span>
              </div>
              <div className="flex flex-1 flex-col p-3">
                <p className="line-clamp-2 text-sm font-semibold text-ink">
                  {r.name}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.tags.cookTime && (
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-dark">
                      ⏱ {r.tags.cookTime}分
                    </span>
                  )}
                  {r.tags.cuisine && (
                    <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                      {r.tags.cuisine}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
