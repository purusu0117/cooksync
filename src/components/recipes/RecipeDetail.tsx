"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { RecipeIngredient } from "@/lib/recipe";
import { recipeStore } from "@/lib/storage";
import { useAllRecipes, usePersistentList } from "@/lib/useStore";

interface Props {
  id: string;
}

function groupIngredients(ings: RecipeIngredient[]): [string, RecipeIngredient[]][] {
  const map = new Map<string, RecipeIngredient[]>();
  for (const i of ings) {
    const g = i.group ?? "材料";
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(i);
  }
  return [...map.entries()];
}

export default function RecipeDetail({ id }: Props) {
  const router = useRouter();
  const recipes = useAllRecipes();
  const [stored, setStored] = usePersistentList(recipeStore);
  const recipe = recipes.find((r) => r.id === id) ?? null;
  const isStored = stored.some((r) => r.id === id);

  function handleDelete() {
    if (typeof window !== "undefined" && !window.confirm("このレシピを削除しますか？")) return;
    setStored((prev) => prev.filter((r) => r.id !== id));
    router.push("/recipes");
  }

  if (recipe === null) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12 text-center">
        <p className="text-ink-soft">レシピが見つかりませんでした。</p>
        <Link href="/recipes" className="mt-3 inline-block text-sm text-brand underline">
          ← レシピ一覧へ
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <Link href="/recipes" className="text-sm text-ink-soft transition hover:text-brand">
        ← レシピ一覧
      </Link>

      {recipe.image && (
        <div className="relative mt-3 h-52 w-full overflow-hidden rounded-2xl">
          <Image
            src={recipe.image}
            alt={recipe.name}
            fill
            sizes="(max-width: 768px) 100vw, 672px"
            className="object-cover"
          />
        </div>
      )}

      <header className="mt-4 mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink">
          <span aria-hidden>{recipe.emoji}</span>
          {recipe.name}
        </h1>
        <p className="mt-1.5 text-xs font-medium text-brand-dark">
          {recipe.tags.cookTime ? `⏱ ${recipe.tags.cookTime}分` : ""}
          {recipe.kcal ? ` / ${recipe.kcal}kcal` : ""}
          {recipe.servings ? `　${recipe.servings}人分` : ""}
        </p>
        <p className="mt-2 rounded-2xl bg-brand-soft/60 px-4 py-3 text-sm text-brand-dark">
          {recipe.catch}
        </p>
      </header>

      {/* 材料 */}
      <section className="mb-6 rounded-2xl border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-bold text-ink">
          材料（{recipe.servings}人分）
        </h2>
        {groupIngredients(recipe.ingredients).map(([group, list]) => (
          <div key={group} className="mb-3 last:mb-0">
            <p className="mb-1 text-xs font-semibold text-ink-soft">{group}</p>
            <ul className="flex flex-col gap-1">
              {list.map((i, idx) => (
                <li key={idx} className="flex justify-between text-sm">
                  <span className="text-ink">
                    {i.name}
                    {i.toBuy && (
                      <span className="ml-1 text-[11px] font-semibold text-accent">
                        ★買い足し
                      </span>
                    )}
                  </span>
                  <span className="text-ink-soft">{i.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* 行程 */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-bold text-ink">🍳 行程</h2>
        <ol className="flex flex-col gap-3">
          {recipe.steps.map((s, idx) => (
            <li key={idx} className="rounded-2xl border border-line bg-surface p-4">
              <p className="font-semibold text-ink">{s.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink">{s.text}</p>
              {s.tip && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs italic text-amber-800">
                  💡 {s.tip}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      {recipe.sideDishes && recipe.sideDishes.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-ink">🍽 合わせる主食・副菜</h2>
          <p className="text-sm text-ink-soft">{recipe.sideDishes.join("／")}</p>
        </section>
      )}

      {recipe.leftoverStorage.length > 0 && (
        <section className="mb-6 rounded-2xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-bold text-ink">🧊 余った材料の保存</h2>
          <ul className="flex flex-col gap-1.5">
            {recipe.leftoverStorage.map((l, idx) => (
              <li key={idx} className="text-sm">
                <span className="font-medium text-ink">{l.ingredient}</span>
                <span className="text-ink-soft">：{l.method}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recipe.sources.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-ink">🔗 参考</h2>
          <ul className="flex flex-col gap-1">
            {recipe.sources.map((src, idx) => (
              <li key={idx} className="text-sm">
                {src.url ? (
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand underline"
                  >
                    {src.label}
                  </a>
                ) : (
                  <span className="text-ink">{src.label}</span>
                )}
                {src.popularity && (
                  <span className="ml-1 text-xs text-ink-soft">（{src.popularity}）</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isStored && (
        <div className="mt-2 mb-4">
          <button
            type="button"
            onClick={handleDelete}
            className="w-full rounded-xl border border-red-200 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
          >
            このレシピを削除
          </button>
        </div>
      )}
    </div>
  );
}
