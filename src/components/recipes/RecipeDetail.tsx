"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShoppingCart } from "lucide-react";
import { ingredientMatches, type RecipeIngredient } from "@/lib/recipe";
import {
  recipeStore,
  shoppingStore,
  mealStore,
  fridgeStore,
  ratingStore,
} from "@/lib/storage";
import { todayISO, type FridgeItem } from "@/lib/food";
import type { ShoppingItem } from "@/lib/shopping";
import type { MealEntry } from "@/lib/mealplan";
import { useAllRecipes, usePersistentList } from "@/lib/useStore";
import {
  startGenerating,
  stopGenerating,
  useIsGenerating,
  useImageGenEnabled,
} from "@/lib/imageGen";
import { useUsage, FREE_LIMITS } from "@/lib/usage";
import CookingTimer from "@/components/CookingTimer";
import StarRating from "@/components/StarRating";
import AppIcon from "@/components/AppIcon";
import RecipeThumb from "@/components/recipes/RecipeThumb";

interface Props {
  id: string;
}

type UseChoice = "use" | "half" | "keep";

/** 数量の先頭の数値を半分にする（できなければ「（半分）」を付す） */
function halveQty(q: string): string {
  const m = q.match(/^(\d+(?:\.\d+)?)/);
  if (m) {
    const half = Number(m[1]) / 2;
    return q.replace(m[1], String(half));
  }
  return q ? `${q}（半分）` : "半分";
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
  const [shopping, setShopping] = usePersistentList(shoppingStore);
  const [meals, setMeals] = usePersistentList(mealStore);
  const [fridge, setFridge] = usePersistentList(fridgeStore);
  const [ratings, setRatings] = usePersistentList(ratingStore);
  const [note, setNote] = useState("");
  const [proofLoading, setProofLoading] = useState(false);
  const [imgLoading, setImgLoading] = useState(false);
  const [showMade, setShowMade] = useState(false);
  const [madeChoices, setMadeChoices] = useState<Record<string, UseChoice>>({});
  const [undoData, setUndoData] = useState<{
    snapshot: FridgeItem[];
    mealId: string;
  } | null>(null);
  const recipe = recipes.find((r) => r.id === id) ?? null;
  const isStored = stored.some((r) => r.id === id);
  // 「作った回数」は🍳作ったボタンで記録した分だけ（献立に入れただけ=made:falseは数えない）
  const madeCount = meals.filter((m) => m.recipeId === id && m.made).length;
  const stars = ratings.find((r) => r.recipeId === id)?.stars ?? 0;
  const generating = useIsGenerating(id);
  const imageGenEnabled = useImageGenEnabled();
  const usage = useUsage();

  function setStars(n: number) {
    setRatings((prev) => {
      const others = prev.filter((r) => r.recipeId !== id);
      return n > 0 ? [...others, { recipeId: id, stars: n }] : others;
    });
  }

  function handleDelete() {
    if (typeof window !== "undefined" && !window.confirm("このレシピを削除しますか？")) return;
    setStored((prev) => prev.filter((r) => r.id !== id));
    router.push("/recipes");
  }

  function addMissingToShopping() {
    if (!recipe) return;
    const toAdd = recipe.ingredients.filter((ing) => {
      if (ing.basicSeasoning) return false;
      const inFridge = fridge.some((f) => ingredientMatches(f.name, ing.name));
      const inShopping = shopping.some((s) => s.name === ing.name);
      return !inFridge && !inShopping;
    });
    if (toAdd.length === 0) {
      setNote("不足はありません（在庫・リストに揃っています）");
      return;
    }
    const items: ShoppingItem[] = toAdd.map((ing) => ({
      id: crypto.randomUUID(),
      name: ing.name,
      amount: ing.amount,
      checked: false,
      addedAt: Date.now(),
      note: `${recipe.name}用`,
      fromRecipeId: recipe.id,
    }));
    setShopping((prev) => [...prev, ...items]);
    setNote(`不足 ${toAdd.length} 件を買い物リストに追加しました`);
  }

  // 保存時の古い toBuy ではなく、今の冷蔵庫と照らし合わせてライブ判定する
  const inStockNow = (ing: RecipeIngredient) =>
    !ing.basicSeasoning &&
    fridge.some((f) => ingredientMatches(f.name, ing.name));
  const needsBuyNow = (ing: RecipeIngredient) =>
    !ing.basicSeasoning &&
    !fridge.some((f) => ingredientMatches(f.name, ing.name));

  async function proofread() {
    if (!recipe || proofLoading) return;
    setProofLoading(true);
    setNote("AIが手順を整えています…（20〜40秒）");
    try {
      const res = await fetch("/api/proofread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: recipe.name, steps: recipe.steps }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.steps) && data.steps.length > 0) {
        setStored((prev) =>
          prev.map((r) => (r.id === id ? { ...r, steps: data.steps } : r)),
        );
        setNote("AIが手順を整えました ✨");
      } else {
        setNote("整形に失敗しました");
      }
    } catch {
      setNote("整形に失敗しました");
    } finally {
      setProofLoading(false);
    }
  }

  // 「作った」の対象＝レシピに使う食材で、冷蔵庫にあるもの（調味料含む）
  function matchedFridge(): FridgeItem[] {
    if (!recipe) return [];
    return fridge.filter((f) =>
      recipe.ingredients.some((ing) => ingredientMatches(f.name, ing.name)),
    );
  }

  // その冷蔵庫アイテムが「調味料系」か（一致する材料が全て basicSeasoning）
  function isSeasoningItem(f: FridgeItem): boolean {
    if (!recipe) return false;
    const matched = recipe.ingredients.filter((ing) =>
      ingredientMatches(f.name, ing.name),
    );
    return matched.length > 0 && matched.every((ing) => ing.basicSeasoning);
  }

  // レシピが使う基本調味料の名前（常備＝在庫は減らさないが、記録として表示）
  function usedSeasonings(): string[] {
    if (!recipe) return [];
    return recipe.ingredients.filter((ing) => ing.basicSeasoning).map((i) => i.name);
  }

  function openMade() {
    if (!recipe) return;
    const init: Record<string, UseChoice> = {};
    // 調味料は既定で「残す」（初期設定の常備を消さない）、それ以外は「使い切った」
    matchedFridge().forEach((f) => (init[f.id] = isSeasoningItem(f) ? "keep" : "use"));
    setMadeChoices(init);
    setShowMade(true);
  }

  function confirmMade() {
    if (!recipe) return;
    const snapshot = fridge;
    const mealId = crypto.randomUUID();
    const next = fridge
      .map((f) => {
        const c = madeChoices[f.id];
        if (c === "use") return null; // 使い切った → 削除
        if (c === "half") return { ...f, quantity: halveQty(f.quantity) };
        return f; // keep / 対象外
      })
      .filter((f): f is FridgeItem => f !== null);
    setFridge(next);
    setMeals((prev) => [
      ...prev,
      {
        id: mealId,
        date: todayISO(),
        slot: "夜",
        recipeId: recipe.id,
        recipeName: recipe.name,
        made: true,
      } satisfies MealEntry,
    ]);
    setUndoData({ snapshot, mealId });
    setShowMade(false);
    setNote("✅ 「作った」を記録し、冷蔵庫を更新しました");
  }

  function undoMade() {
    if (!undoData) return;
    setFridge(undoData.snapshot);
    setMeals((prev) => prev.filter((m) => m.id !== undoData.mealId));
    setUndoData(null);
    setNote("取り消しました");
  }

  async function genImage() {
    if (!recipe || imgLoading) return;
    if (!usage.canUse("image")) {
      setNote(`今月のAI写真生成の無料枠（${FREE_LIMITS.image}枚）を使い切りました。`);
      return;
    }
    usage.recordUse("image");
    setImgLoading(true);
    startGenerating(recipe.id);
    setNote("AIが写真を生成中…（30〜60秒）");
    try {
      const res = await fetch("/api/recipe-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: recipe.id, name: recipe.name }),
      });
      const data = await res.json();
      if (res.ok && data.image) {
        setStored((prev) =>
          prev.map((r) => (r.id === id ? { ...r, image: data.image } : r)),
        );
        setNote("写真を生成しました ✨");
      } else {
        setNote("写真生成に失敗しました");
      }
    } catch {
      setNote("写真生成に失敗しました");
    } finally {
      setImgLoading(false);
      if (recipe) stopGenerating(recipe.id);
    }
  }

  // 作った回数の手動編集（＋／−）。作った回数＝made:true の記録のみ
  function incMade() {
    if (!recipe) return;
    setMeals((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        date: todayISO(),
        slot: "夜",
        recipeId: recipe.id,
        recipeName: recipe.name,
        made: true,
      } satisfies MealEntry,
    ]);
  }
  function decMade() {
    setMeals((prev) => {
      let removed = false;
      const out: MealEntry[] = [];
      // 末尾（最新）から、made:true の1件だけ削除
      for (let i = prev.length - 1; i >= 0; i--) {
        if (!removed && prev[i].recipeId === id && prev[i].made) {
          removed = true;
          continue;
        }
        out.unshift(prev[i]);
      }
      return out;
    });
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

  const timerSuggestions = Array.from(
    new Set(
      recipe.steps.flatMap((s) =>
        Array.from(s.text.matchAll(/(\d+)\s*分/g)).map((m) => Number(m[1])),
      ),
    ),
  ).filter((n) => n > 0 && n <= 120);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <Link href="/recipes" className="text-sm text-ink-soft transition hover:text-brand">
        ← レシピ一覧
      </Link>

      {(recipe.image || generating) && (
        <div className="relative mt-3 h-52 w-full overflow-hidden rounded-2xl bg-gradient-to-br from-brand-soft to-emerald-50">
          <RecipeThumb
            image={recipe.image}
            emoji={recipe.emoji}
            cuisine={recipe.tags?.cuisine}
            alt={recipe.name}
            sizes="(max-width: 768px) 100vw, 672px"
            emojiClass="text-6xl"
          />
          {generating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/40 text-white">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              <span className="text-xs font-medium">AIが写真を生成中…</span>
            </div>
          )}
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
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
          <span className="inline-flex items-center gap-1">
            <AppIcon name="check" size={16} />
            作った回数
          </span>
          <button
            type="button"
            onClick={decMade}
            disabled={madeCount === 0}
            className="grid h-6 w-6 place-items-center rounded-full border border-line text-ink-soft transition hover:bg-paper disabled:opacity-40"
            aria-label="1回減らす"
          >
            −
          </button>
          <span className="min-w-[2ch] text-center text-sm font-bold text-ink">
            {madeCount}
          </span>
          <button
            type="button"
            onClick={incMade}
            className="grid h-6 w-6 place-items-center rounded-full border border-line text-ink-soft transition hover:bg-paper"
            aria-label="1回増やす"
          >
            ＋
          </button>
        </div>
        <p className="mt-2 rounded-2xl bg-brand-soft/60 px-4 py-3 text-sm text-brand-dark">
          {recipe.catch}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-ink">
            <AppIcon name="star" size={20} />
            このレシピを評価
          </span>
          <StarRating value={stars} onChange={setStars} size={30} />
        </div>
      </header>

      <div className="mb-2 flex gap-2">
        <button
          type="button"
          onClick={addMissingToShopping}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-brand/40 bg-brand-soft py-2.5 text-sm font-semibold text-brand-dark transition hover:bg-brand hover:text-white"
        >
          <ShoppingCart className="h-[18px] w-[18px]" strokeWidth={1.75} />
          不足を買い物へ
        </button>
        <button
          type="button"
          onClick={openMade}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-95"
        >
          <AppIcon name="check" size={18} />
          作った
        </button>
      </div>
      {note && (
        <p className="mb-5 text-center text-xs font-medium text-brand-dark">
          {note}
          {undoData && (
            <button
              type="button"
              onClick={undoMade}
              className="ml-2 font-semibold text-accent-dark underline"
            >
              取り消す
            </button>
          )}
        </p>
      )}

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
                    {inStockNow(i) && (
                      <span className="ml-1 text-[11px] font-semibold text-brand">
                        ✓在庫あり
                      </span>
                    )}
                    {needsBuyNow(i) && (
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
        <h2 className="mb-3 inline-flex items-center gap-1.5 text-sm font-bold text-ink">
          <AppIcon name="meal" size={18} />
          行程
        </h2>
        <div className="mb-3">
          <CookingTimer suggestions={timerSuggestions} />
        </div>
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
          <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-ink">
            <AppIcon name="recipe" size={18} />
            合わせる主食・副菜
          </h2>
          <p className="text-sm text-ink-soft">{recipe.sideDishes.join("／")}</p>
        </section>
      )}

      {recipe.leftoverStorage.length > 0 && (
        <section className="mb-6 rounded-2xl border border-line bg-surface p-4">
          <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-ink">
            <AppIcon name="fridge" size={18} />
            余った材料の保存
          </h2>
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
        <div className="mt-2 mb-4 flex flex-col gap-2">
          {imageGenEnabled && (
            <button
              type="button"
              onClick={genImage}
              disabled={imgLoading}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand/30 bg-brand-soft py-2.5 text-sm font-semibold text-brand-dark transition hover:border-brand disabled:opacity-60"
            >
              <AppIcon name="camera" size={18} />
              {imgLoading
                ? "AIが写真を生成中…"
                : recipe.image
                  ? "写真をAIで再生成"
                  : "写真をAIで生成"}
            </button>
          )}
          <button
            type="button"
            onClick={proofread}
            disabled={proofLoading}
            className="w-full rounded-xl border border-brand/30 bg-brand-soft py-2.5 text-sm font-semibold text-brand-dark transition hover:border-brand disabled:opacity-60"
          >
            {proofLoading ? "AIが整えています…" : "✨ AIで手順を読みやすく整える"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="w-full rounded-xl border border-red-200 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
          >
            このレシピを削除
          </button>
        </div>
      )}

      {/* 「作った」確認モーダル（誤タップ防止＋使った食材を更新） */}
      {showMade && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setShowMade(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="inline-flex items-center gap-1.5 text-base font-bold text-ink">
              <AppIcon name="check" size={20} />
              {recipe.name} を作った
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              使った冷蔵庫の食材を更新します（あとで「取り消す」で元に戻せます）。
            </p>

            {matchedFridge().length === 0 ? (
              <p className="mt-4 rounded-xl bg-paper p-3 text-sm text-ink-soft">
                この料理に使う食材は冷蔵庫に見つかりませんでした。記録だけ行います。
              </p>
            ) : (
              <ul className="mt-4 flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
                {matchedFridge().map((f) => (
                  <li key={f.id} className="rounded-xl bg-paper p-3">
                    <div className="mb-1.5 flex items-baseline gap-2">
                      <span className="font-medium text-ink">{f.name}</span>
                      {f.quantity && (
                        <span className="text-xs text-ink-soft">{f.quantity}</span>
                      )}
                      {isSeasoningItem(f) && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          調味料
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          ["use", "使い切った"],
                          ["half", "半分使った"],
                          ["keep", "残す"],
                        ] as [UseChoice, string][]
                      ).map(([v, label]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() =>
                            setMadeChoices((p) => ({ ...p, [f.id]: v }))
                          }
                          className={`rounded-lg py-1.5 text-xs font-medium transition ${
                            madeChoices[f.id] === v
                              ? "bg-brand text-white"
                              : "bg-surface text-ink-soft ring-1 ring-line"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {usedSeasonings().length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                <p className="text-[11px] font-semibold text-amber-800">
                  🧂 使った調味料（常備のため在庫はそのまま）
                </p>
                <p className="mt-0.5 text-xs text-ink">
                  {usedSeasonings().join("・")}
                </p>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setShowMade(false)}
                className="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-soft"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmMade}
                className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white active:scale-95"
              >
                記録する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
