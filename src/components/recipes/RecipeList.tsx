"use client";

import Link from "next/link";
import Image from "next/image";
import { useAllRecipes, usePersistentList } from "@/lib/useStore";
import { recipeStore } from "@/lib/storage";
import { IMPORTED_RECIPES } from "@/lib/seedRecipesImported";
import PageHeader from "@/components/PageHeader";

const CUISINE_GRADIENT: Record<string, string> = {
  和: "from-emerald-100 to-lime-50",
  洋: "from-amber-100 to-orange-50",
  中: "from-rose-100 to-orange-50",
  アジアン: "from-orange-100 to-yellow-50",
};

export default function RecipeList() {
  const recipes = useAllRecipes();
  const [stored, setStored] = usePersistentList(recipeStore);

  const importRemaining = IMPORTED_RECIPES.filter(
    (r) => !stored.some((s) => s.id === r.id),
  );

  function importNotion() {
    if (importRemaining.length) setStored((prev) => [...importRemaining, ...prev]);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6">
      <PageHeader
        title="レシピ"
        tagline="作って良かった実在レシピ。献立提案の母集団になります。"
      />

      {importRemaining.length > 0 && (
        <button
          type="button"
          onClick={importNotion}
          className="mb-4 w-full rounded-2xl border border-brand/40 bg-brand-soft px-4 py-3 text-sm font-semibold text-brand-dark transition hover:bg-brand hover:text-white"
        >
          📥 Notionのレシピを取り込む（{importRemaining.length}件）
        </button>
      )}

      <ul className="grid grid-cols-2 gap-3">
        {recipes.map((r) => (
          <li key={r.id}>
            <Link
              href={`/recipes/${r.id}`}
              className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              {r.image ? (
                <div className="relative h-28 w-full">
                  <Image
                    src={r.image}
                    alt={r.name}
                    fill
                    sizes="(max-width: 640px) 50vw, 320px"
                    className="object-cover"
                  />
                </div>
              ) : (
                <div
                  className={`grid h-28 place-items-center bg-gradient-to-br text-5xl ${
                    CUISINE_GRADIENT[r.tags.cuisine ?? ""] ?? "from-brand-soft to-emerald-50"
                  }`}
                >
                  <span aria-hidden>{r.emoji}</span>
                </div>
              )}
              <div className="flex flex-1 flex-col p-3">
                <p className="line-clamp-2 text-sm font-semibold text-ink">
                  {r.name}
                </p>
                <p className="mt-1.5 text-xs font-medium text-brand-dark">
                  {r.tags.cookTime ? `⏱ ${r.tags.cookTime}分` : ""}
                  {r.kcal ? ` / ${r.kcal}kcal` : ""}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
