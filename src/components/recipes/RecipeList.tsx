"use client";

// レシピ一覧：写真をやめてテキスト主体の縦リストにした版。
// 理由＝AI写真生成が重く、写真の有無でカードの見え方がバラつくため。
// 代わりに「検索・絞り込み・並び替え・在庫で作れるか」を前に出して、
// 28件以上あっても目的のレシピにすぐ辿り着けるようにする。

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ChefHat, Clock, Refrigerator, Search } from "lucide-react";
import { useAllRecipes, usePersistentList } from "@/lib/useStore";
import { fridgeStore, mealStore, ratingStore } from "@/lib/storage";
import { ingredientMatches, type Cuisine, type Recipe } from "@/lib/recipe";
import PageHeader from "@/components/PageHeader";
import StarRating from "@/components/StarRating";
import DishIcon from "@/components/DishIcon";

const CUISINES: Cuisine[] = ["和", "洋", "中", "アジアン"];
type Sort = "default" | "rating" | "made" | "new";
const SORTS: [Sort, string][] = [
  ["default", "おすすめ順"],
  ["rating", "評価が高い順"],
  ["made", "よく作る順"],
  ["new", "新しい順"],
];

export default function RecipeList() {
  const recipes = useAllRecipes();
  const [ratings] = usePersistentList(ratingStore);
  const [fridge] = usePersistentList(fridgeStore);
  const [meals] = usePersistentList(mealStore);
  const [sort, setSort] = useState<Sort>("default");
  const [query, setQuery] = useState("");
  const [cuisine, setCuisine] = useState<Cuisine | null>(null);
  const [quickOnly, setQuickOnly] = useState(false); // 15分以内
  const [stockOnly, setStockOnly] = useState(false); // 買い足しなしで作れる

  const starsOf = (rid: string) =>
    ratings.find((r) => r.recipeId === rid)?.stars ?? 0;
  const madeCountOf = (rid: string) =>
    meals.filter((m) => m.recipeId === rid && m.made).length;

  const fridgeNames = useMemo(() => fridge.map((f) => f.name), [fridge]);

  // 買い足しが必要な材料の数（基本調味料は常備とみなして数えない）
  const missingCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of recipes) {
      const n = r.ingredients.filter(
        (i) =>
          !i.basicSeasoning &&
          !fridgeNames.some((f) => ingredientMatches(f, i.name)),
      ).length;
      map.set(r.id, n);
    }
    return map;
  }, [recipes, fridgeNames]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (cuisine && r.tags.cuisine !== cuisine) return false;
      if (quickOnly && (r.tags.cookTime ?? 99) > 15) return false;
      if (stockOnly && (missingCount.get(r.id) ?? 0) > 0) return false;
      if (!q) return true;
      // 料理名・キャッチ・材料名のどれかに当たれば表示
      return (
        r.name.toLowerCase().includes(q) ||
        r.catch.toLowerCase().includes(q) ||
        r.ingredients.some((i) => i.name.toLowerCase().includes(q))
      );
    });
  }, [recipes, query, cuisine, quickOnly, stockOnly, missingCount]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sort === "rating") list.sort((a, b) => starsOf(b.id) - starsOf(a.id));
    if (sort === "made") list.sort((a, b) => madeCountOf(b.id) - madeCountOf(a.id));
    if (sort === "new") list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, ratings, meals]);

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${
      active
        ? "border-brand bg-brand text-white"
        : "border-line bg-surface text-ink-soft hover:border-brand hover:text-brand-dark"
    }`;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6">
      <PageHeader title="レシピ" Icon={BookOpen} iconClass="text-accent" />

      {/* 検索：料理名でも材料でも引ける */}
      <div className="relative mb-3">
        <Search
          size={16}
          strokeWidth={1.8}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="料理名・材料で検索（例：鶏、さっぱり）"
          className="w-full rounded-full border border-line bg-surface py-2.5 pr-4 pl-9 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft"
        />
      </div>

      {/* 絞り込み */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {CUISINES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCuisine(cuisine === c ? null : c)}
            className={chip(cuisine === c)}
          >
            {c}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setQuickOnly(!quickOnly)}
          className={`${chip(quickOnly)} inline-flex items-center gap-1`}
        >
          <Clock size={12} strokeWidth={2} />
          15分以内
        </button>
        <button
          type="button"
          onClick={() => setStockOnly(!stockOnly)}
          className={`${chip(stockOnly)} inline-flex items-center gap-1`}
        >
          <Refrigerator size={12} strokeWidth={2} />
          在庫で作れる
        </button>
      </div>

      {/* 並び替え */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="inline-flex flex-wrap rounded-full border border-line bg-surface p-0.5 text-xs">
          {SORTS.map(([v, label]) => (
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
        <span className="shrink-0 text-[11px] text-ink-soft">{sorted.length}件</span>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-ink-soft">
          条件に合うレシピがありませんでした。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((r) => (
            <li key={r.id}>
              <RecipeRow
                recipe={r}
                stars={starsOf(r.id)}
                made={madeCountOf(r.id)}
                missing={missingCount.get(r.id) ?? 0}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecipeRow({
  recipe: r,
  stars,
  made,
  missing,
}: {
  recipe: Recipe;
  stars: number;
  made: number;
  missing: number;
}) {
  return (
    <Link
      href={`/recipes/${r.id}`}
      className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
    >
      <DishIcon
        name={r.name}
        staple={r.tags.staple}
        cuisine={r.tags.cuisine}
        size={32}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          {r.name}
        </span>
        {r.catch && (
          <span className="mt-0.5 block truncate text-[11px] text-ink-soft">
            {r.catch}
          </span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-brand-dark">
          {r.tags.cookTime ? (
            <span className="inline-flex items-center gap-0.5">
              <Clock size={11} strokeWidth={2} />
              {r.tags.cookTime}分
            </span>
          ) : null}
          {r.kcal ? <span>{r.kcal}kcal</span> : null}
          {made > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <ChefHat size={11} strokeWidth={2} />
              {made}回
            </span>
          )}
          {stars > 0 && <StarRating value={stars} size={11} />}
          {missing === 0 ? (
            <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-brand-dark">
              在庫で作れる
            </span>
          ) : (
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700">
              買い足し{missing}品
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}
