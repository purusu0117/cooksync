"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAllRecipes, usePersistentList } from "@/lib/useStore";
import { ratingStore } from "@/lib/storage";
import PageHeader from "@/components/PageHeader";
import StarRating from "@/components/StarRating";

const CUISINE_GRADIENT: Record<string, string> = {
  和: "from-emerald-100 to-lime-50",
  洋: "from-amber-100 to-orange-50",
  中: "from-rose-100 to-orange-50",
  アジアン: "from-orange-100 to-yellow-50",
};

export default function RecipeList() {
  const recipes = useAllRecipes();
  const [ratings] = usePersistentList(ratingStore);
  const [sort, setSort] = useState<"default" | "rating">("default");
  const starsOf = (rid: string) =>
    ratings.find((r) => r.recipeId === rid)?.stars ?? 0;

  const sorted =
    sort === "rating"
      ? [...recipes].sort((a, b) => starsOf(b.id) - starsOf(a.id))
      : recipes;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6">
      <PageHeader
        title="レシピ"
        tagline="作って良かった実在レシピ。献立提案の母集団になります。"
      />

      <div className="mb-3 inline-flex rounded-full border border-line bg-surface p-0.5 text-xs">
        {(
          [
            ["default", "おすすめ順"],
            ["rating", "評価が高い順"],
          ] as ["default" | "rating", string][]
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setSort(v)}
            className={`rounded-full px-3 py-1 font-medium transition ${
              sort === v ? "bg-brand text-white" : "text-ink-soft"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="grid grid-cols-2 gap-3">
        {sorted.map((r) => (
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
                {starsOf(r.id) > 0 && (
                  <div className="mt-1">
                    <StarRating value={starsOf(r.id)} size={13} />
                  </div>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
