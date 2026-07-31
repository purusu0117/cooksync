"use client";

// レシピ一覧：写真をやめてテキスト主体の縦リストにした版。
// 理由＝AI写真生成が重く、写真の有無でカードの見え方がバラつくため。
// 代わりに「検索・絞り込み・並び替え・在庫で作れるか」を前に出して、
// 38件以上あっても目的のレシピにすぐ辿り着けるようにする。
//
// 絞り込みは “よく使う3つ＋詳細は折りたたみ” の二段構え（UIを散らかさないため）。

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChefHat,
  Clock,
  Flame,
  Refrigerator,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useAllRecipes, usePersistentList } from "@/lib/useStore";
import { fridgeStore, mealStore, ratingStore } from "@/lib/storage";
import { bucketOf } from "@/lib/food";
import {
  ingredientMatches,
  type Cuisine,
  type Heaviness,
  type Recipe,
  type StapleType,
} from "@/lib/recipe";
import { kindsOf, matchesQuery, usesExpiring, type MainKind } from "@/lib/recipeFilter";
import PageHeader from "@/components/PageHeader";
import StarRating from "@/components/StarRating";
import DishIcon from "@/components/DishIcon";
import VideoImport from "@/components/recipes/VideoImport";

const CUISINES: Cuisine[] = ["和", "洋", "中", "アジアン"];
const KINDS: MainKind[] = ["肉", "魚介", "野菜"];
const HEAVINESS: Heaviness[] = ["ガッツリ", "さっぱり", "あっさり"];
const STAPLES: StapleType[] = ["ご飯", "麺", "パン"];
const TIMES: { v: number; label: string }[] = [
  { v: 15, label: "15分以内" },
  { v: 30, label: "30分以内" },
];

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
  const [showFilters, setShowFilters] = useState(false);

  // 絞り込み条件
  const [cuisine, setCuisine] = useState<Cuisine | null>(null);
  const [kind, setKind] = useState<MainKind | null>(null);
  const [heaviness, setHeaviness] = useState<Heaviness | null>(null);
  const [staple, setStaple] = useState<StapleType | null>(null);
  const [maxTime, setMaxTime] = useState<number | null>(null);
  const [stockOnly, setStockOnly] = useState(false); // 買い足しなしで作れる
  const [expiringOnly, setExpiringOnly] = useState(false); // 期限が近い食材を使える
  const [unmadeOnly, setUnmadeOnly] = useState(false); // まだ作ってない
  const [favOnly, setFavOnly] = useState(false); // ★4以上

  const starsOf = (rid: string) =>
    ratings.find((r) => r.recipeId === rid)?.stars ?? 0;
  const madeCountOf = (rid: string) =>
    meals.filter((m) => m.recipeId === rid && m.made).length;

  const fridgeNames = useMemo(() => fridge.map((f) => f.name), [fridge]);
  // 🔴🟡＝早く使い切りたい食材
  const expiringNames = useMemo(
    () =>
      fridge
        .filter((f) => bucketOf(f.expiresOn) !== "fresh")
        .map((f) => f.name),
    [fridge],
  );

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

  const activeCount =
    (cuisine ? 1 : 0) +
    (kind ? 1 : 0) +
    (heaviness ? 1 : 0) +
    (staple ? 1 : 0) +
    (maxTime ? 1 : 0) +
    (stockOnly ? 1 : 0) +
    (expiringOnly ? 1 : 0) +
    (unmadeOnly ? 1 : 0) +
    (favOnly ? 1 : 0);

  function clearFilters() {
    setCuisine(null);
    setKind(null);
    setHeaviness(null);
    setStaple(null);
    setMaxTime(null);
    setStockOnly(false);
    setExpiringOnly(false);
    setUnmadeOnly(false);
    setFavOnly(false);
  }

  const filtered = useMemo(() => {
    return recipes.filter((r) => {
      if (cuisine && r.tags.cuisine !== cuisine) return false;
      if (heaviness && r.tags.heaviness !== heaviness) return false;
      if (staple && r.tags.staple !== staple) return false;
      if (maxTime && (r.tags.cookTime ?? 99) > maxTime) return false;
      if (kind && !kindsOf(r).includes(kind)) return false;
      if (stockOnly && (missingCount.get(r.id) ?? 0) > 0) return false;
      if (expiringOnly && !usesExpiring(r, expiringNames)) return false;
      if (unmadeOnly && madeCountOf(r.id) > 0) return false;
      if (favOnly && starsOf(r.id) < 4) return false;
      return matchesQuery(r, query);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    recipes,
    query,
    cuisine,
    kind,
    heaviness,
    staple,
    maxTime,
    stockOnly,
    expiringOnly,
    unmadeOnly,
    favOnly,
    missingCount,
    expiringNames,
    meals,
    ratings,
  ]);

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

      {/* 動画URL→レシピ化 */}
      <VideoImport />

      {/* 検索：料理名・材料に加えて「肉系」「さっぱり」等のざっくりした言葉でも引ける */}
      <div className="relative mb-2">
        <Search
          size={16}
          strokeWidth={1.8}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="肉系 / 魚 / さっぱり / 鶏むね / パスタ…"
          className="w-full rounded-full border border-line bg-surface py-2.5 pr-9 pl-9 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="検索をクリア"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1.5 text-ink-soft transition hover:bg-paper"
          >
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>
      <p className="mb-3 px-1 text-[11px] text-ink-soft">
        「肉系」「魚」「野菜」「さっぱり」「時短」などのざっくりした言葉でも絞り込めます（スペース区切りで重ねがけ）。
      </p>

      {/* よく使う絞り込み＋詳細トグル */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(kind === k ? null : k)}
            className={chip(kind === k)}
          >
            {k === "野菜" ? "野菜中心" : k}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setStockOnly(!stockOnly)}
          className={`${chip(stockOnly)} inline-flex items-center gap-1`}
        >
          <Refrigerator size={12} strokeWidth={2} />
          在庫で作れる
        </button>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={`${chip(showFilters || activeCount > 0)} inline-flex items-center gap-1`}
        >
          <SlidersHorizontal size={12} strokeWidth={2} />
          絞り込み
          {activeCount > 0 && (
            <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-bold">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {/* 詳細フィルタ（普段は畳んでおく） */}
      {showFilters && (
        <div className="animate-pop-in mb-3 rounded-2xl border border-line bg-surface p-3">
          <FilterRow label="ジャンル">
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
          </FilterRow>
          <FilterRow label="味の重さ">
            {HEAVINESS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHeaviness(heaviness === h ? null : h)}
                className={chip(heaviness === h)}
              >
                {h}
              </button>
            ))}
          </FilterRow>
          <FilterRow label="主食">
            {STAPLES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStaple(staple === s ? null : s)}
                className={chip(staple === s)}
              >
                {s}
              </button>
            ))}
          </FilterRow>
          <FilterRow label="調理時間">
            {TIMES.map((t) => (
              <button
                key={t.v}
                type="button"
                onClick={() => setMaxTime(maxTime === t.v ? null : t.v)}
                className={`${chip(maxTime === t.v)} inline-flex items-center gap-1`}
              >
                <Clock size={12} strokeWidth={2} />
                {t.label}
              </button>
            ))}
          </FilterRow>
          <FilterRow label="そのほか">
            <button
              type="button"
              onClick={() => setExpiringOnly(!expiringOnly)}
              className={`${chip(expiringOnly)} inline-flex items-center gap-1`}
            >
              <Flame size={12} strokeWidth={2} />
              期限が近い食材を使う
            </button>
            <button
              type="button"
              onClick={() => setUnmadeOnly(!unmadeOnly)}
              className={chip(unmadeOnly)}
            >
              まだ作ってない
            </button>
            <button
              type="button"
              onClick={() => setFavOnly(!favOnly)}
              className={chip(favOnly)}
            >
              ★4以上
            </button>
          </FilterRow>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-accent-dark underline"
            >
              <X size={12} strokeWidth={2} />
              絞り込みをクリア（{activeCount}件）
            </button>
          )}
        </div>
      )}

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
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="text-sm text-ink-soft">条件に合うレシピがありませんでした。</p>
          {(activeCount > 0 || query) && (
            <button
              type="button"
              onClick={() => {
                clearFilters();
                setQuery("");
              }}
              className="mt-3 rounded-full border border-brand/40 bg-brand-soft px-4 py-1.5 text-xs font-semibold text-brand-dark"
            >
              条件をリセット
            </button>
          )}
        </div>
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

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 last:mb-1">
      <p className="mb-1.5 text-[11px] font-semibold text-ink-soft">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
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
