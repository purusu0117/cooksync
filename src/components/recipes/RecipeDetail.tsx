"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  CirclePlus,
  Lightbulb,
  Link2,
  RotateCcw,
  Refrigerator,
  ShoppingCart,
  Soup,
  Sparkles,
} from "lucide-react";
import { ingredientMatches, type RecipeIngredient } from "@/lib/recipe";
import { scaleMeasures } from "@/lib/recipeScale";
import { subtractAmount, parseAmount } from "@/lib/portion";
import { toBuyableFor, convertAmount } from "@/lib/packaging";
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
import { useSyncState } from "@/lib/syncStore";
import SyncNotice, { LoadingOrOffline } from "@/components/SyncNotice";
import CookingTimer from "@/components/CookingTimer";
import StarRating from "@/components/StarRating";
import AppIcon from "@/components/AppIcon";
import DishIcon from "@/components/DishIcon";
import ShoppablePanel from "@/components/shopping/ShoppablePanel";
import { shoppingListText } from "@/lib/affiliate";
import { storageList } from "@/lib/storageTips";
import { currentTaskKey, toCookTasks } from "@/lib/cookSteps";
import { saveCookProgress, useCookProgress } from "@/lib/cookProgress";

interface Props {
  id: string;
}

type UseChoice = "portion" | "use" | "half" | "keep";

/** 数量の先頭の数値を半分にする（できなければ「（半分）」を付す） */
function halveQty(q: string): string {
  const m = q.match(/^(\d+(?:\.\d+)?)/);
  if (m) {
    const half = Number(m[1]) / 2;
    return q.replace(m[1], String(half));
  }
  return q ? `${q}（半分）` : "半分";
}

// Date.now をモジュール関数に隔離（react purity lintの誤検知回避）
const nowMs = (): number => Date.now();

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
  const sync = useSyncState();
  const [stored, setStored] = usePersistentList(recipeStore);
  const [shopping, setShopping] = usePersistentList(shoppingStore);
  const [meals, setMeals] = usePersistentList(mealStore);
  const [fridge, setFridge] = usePersistentList(fridgeStore);
  const [ratings, setRatings] = usePersistentList(ratingStore);
  const [note, setNote] = useState("");
  const [servings, setServings] = useState<number | null>(null); // null＝レシピ基準のまま
  const [proofLoading, setProofLoading] = useState(false);
  const [showMade, setShowMade] = useState(false);
  const [madeChoices, setMadeChoices] = useState<Record<string, UseChoice>>({});
  const [undoData, setUndoData] = useState<{
    snapshot: FridgeItem[];
    mealId: string;
  } | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const recipe = recipes.find((r) => r.id === id) ?? null;
  const isStored = stored.some((r) => r.id === id);
  // 「作った回数」は🍳作ったボタンで記録した分だけ（献立に入れただけ=made:falseは数えない）
  const madeCount = meals.filter((m) => m.recipeId === id && m.made).length;
  const stars = ratings.find((r) => r.recipeId === id)?.stars ?? 0;

  // 調理の進捗（1作業ごとのチェック）。端末ローカルに保存し、開き直しても残る。
  const checkedTasks = useCookProgress(id);

  function toggleTask(key: string) {
    const next = { ...checkedTasks };
    if (next[key]) delete next[key];
    else next[key] = true;
    saveCookProgress(id, next);
  }

  function clearTasks() {
    saveCookProgress(id, {});
  }

  function scrollToId(elementId: string) {
    if (typeof document === "undefined") return;
    document
      .getElementById(elementId)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

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

  // 在庫を「種類＋数量」で判定。必要量(scaled)と冷蔵庫の同単位合計を比べる。
  //  enough=足りる / short=あるが足りない / none=在庫なし。
  //  単位が違う・読めない時は安全側で enough(あるものとみなす)。
  function stockOf(name: string, scaledAmount: string): {
    status: "enough" | "short" | "none";
    need?: number;
    have?: number;
    unit?: string;
  } {
    const matches = fridge.filter((f) => ingredientMatches(f.name, name));
    if (matches.length === 0) return { status: "none" };
    const need = parseAmount(scaledAmount);
    if (!need.ok) return { status: "enough" };
    const nu = need.unit.trim();
    let have = 0;
    let comparable = false;
    for (const f of matches) {
      // 「1パック」の在庫とレシピの「5個」も、販売単位の辞書で換算して比べる
      const converted = convertAmount(f.name, f.quantity, nu);
      if (converted != null) {
        have += converted;
        comparable = true;
        continue;
      }
      const h = parseAmount(f.quantity);
      if (h.ok && h.unit.trim() === nu) {
        have += h.num;
        comparable = true;
      }
    }
    if (!comparable) return { status: "enough" };
    return {
      status: have >= need.num ? "enough" : "short",
      need: need.num,
      have,
      unit: nu,
    };
  }

  function addMissingToShopping() {
    if (!recipe) return;
    const f = (servings ?? recipe.servings) / (recipe.servings || 1);
    const items: ShoppingItem[] = [];
    for (const ing of recipe.ingredients) {
      if (ing.basicSeasoning) continue;
      if (shopping.some((s) => s.name === ing.name)) continue;
      const scaled = scaleMeasures(ing.amount, f);
      const st = stockOf(ing.name, scaled);
      if (st.status === "enough") continue;
      // 不足分だけ（短い時は need-have、無い時は全量）を「店で買える単位」で
      let buy = toBuyableFor(ing.name, scaled);
      if (
        st.status === "short" &&
        st.need != null &&
        st.have != null &&
        st.unit != null
      ) {
        const shortNum = Math.round((st.need - st.have) * 100) / 100;
        if (shortNum > 0) buy = toBuyableFor(ing.name, `${shortNum}${st.unit}`);
      }
      items.push({
        id: crypto.randomUUID(),
        name: ing.name,
        amount: buy.amount,
        checked: false,
        addedAt: nowMs(),
        note: buy.hint ? `${recipe.name}用／${buy.hint}` : `${recipe.name}用`,
        fromRecipeId: recipe.id,
      });
    }
    if (items.length === 0) {
      setNote("不足はありません（在庫・リストに揃っています）");
      return;
    }
    setShopping((prev) => [...prev, ...items]);
    setNote(`不足 ${items.length} 件を買い物リストに追加しました`);
  }

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
        setNote("AIが手順を整えました");
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

  // この冷蔵庫アイテムに対してレシピが使う量（選択人数に換算）
  function recipeAmountFor(f: FridgeItem): string {
    if (!recipe) return "";
    const ing = recipe.ingredients.find((i) => ingredientMatches(f.name, i.name));
    if (!ing) return "";
    return scaleMeasures(ing.amount, (servings ?? recipe.servings) / (recipe.servings || 1));
  }

  function openMade() {
    if (!recipe) return;
    const init: Record<string, UseChoice> = {};
    // 調味料は既定で「残す」（常備を消さない）。それ以外は、レシピ使用分を引いて残量が出せるなら
    // 既定「レシピ分」（使った分だけ引いて残りを在庫に）、出せなければ「使い切った」。
    matchedFridge().forEach((f) => {
      if (isSeasoningItem(f)) {
        init[f.id] = "keep";
        return;
      }
      const rem = subtractAmount(f.quantity, recipeAmountFor(f));
      init[f.id] = rem === f.quantity ? "use" : "portion";
    });
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
        if (c === "portion") {
          // レシピ分だけ引いて残りを在庫に（例：1個から1/4使用→3/4残す）。使い切りなら削除。
          const rem = subtractAmount(f.quantity, recipeAmountFor(f));
          return rem === "" ? null : { ...f, quantity: rem };
        }
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
    setNote("「作った」を記録し、冷蔵庫を更新しました");
  }

  function undoMade() {
    if (!undoData) return;
    setFridge(undoData.snapshot);
    setMeals((prev) => prev.filter((m) => m.id !== undoData.mealId));
    setUndoData(null);
    setNote("取り消しました");
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

  // ★「保存レシピをまだ読めていない」と「本当に存在しない」を必ず区別する。
  //   以前は区別が無かったので、**調理中に電波の弱い場所でリロードすると
  //   「レシピが見つかりませんでした」になって手順が丸ごと消えた**。
  //   （hydrate 前はサンプル6件しか見えないため、保存レシピは全部この分岐に落ちる）
  //   いまは端末キャッシュから即復元されるので、通常はここに来ること自体が無い。
  if (recipe === null && !sync.hydrated) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <LoadingOrOffline label="レシピ" />
      </div>
    );
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

  // 人数スケール（servings=null のときはレシピ基準のまま）
  const baseServings = recipe.servings || 1;
  const viewServings = servings ?? baseServings;
  const factor = viewServings / baseServings;
  const viewIngredients =
    factor === 1
      ? recipe.ingredients
      : recipe.ingredients.map((i) => ({ ...i, amount: scaleMeasures(i.amount, factor) }));
  const viewSteps =
    factor === 1
      ? recipe.steps
      : recipe.steps.map((s) => ({ ...s, text: scaleMeasures(s.text, factor) }));
  const viewKcal = recipe.kcal ? Math.round(recipe.kcal * factor) : recipe.kcal;

  // 手順を「1作業＝1チェック」に割る（人数換算後のテキストから作るので分量も追従する）
  const tasks = toCookTasks(viewSteps);
  const doneCount = tasks.filter((t) => checkedTasks[t.key]).length;
  const storage = storageList(recipe);
  const hasStorage = storage.length > 0;

  // 「保存方法」から、いま作業中（未チェックの先頭）の場所へ戻る
  function backToCurrentTask() {
    const key = currentTaskKey(tasks, checkedTasks);
    if (!key) {
      scrollToId("cook-steps");
      return;
    }
    scrollToId(`task-${key}`);
    setFlashKey(key);
    window.setTimeout(() => setFlashKey(null), 1600);
  }

  // 足りない材料（在庫なし＋量が足りない）。「不足を買い物へ」が拾うのと同じ条件で数え、
  // 基本調味料は除く。数量は「店で買える単位」に直しておく（そのまま注文先に貼れるように）。
  const missingIngredients = viewIngredients
    .filter((i) => !i.basicSeasoning)
    .filter((i) => stockOf(i.name, i.amount).status !== "enough")
    .map((i) => ({ name: i.name, amount: toBuyableFor(i.name, i.amount).amount }));

  const timerSuggestions = Array.from(
    new Set(
      viewSteps.flatMap((s) =>
        Array.from(s.text.matchAll(/(\d+)\s*分/g)).map((m) => Number(m[1])),
      ),
    ),
  ).filter((n) => n > 0 && n <= 120);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-0 pb-8">
      {/* 調理中に圏外へ入ることが多い画面なので、状態を隠さず出す（手順は端末に残っている） */}
      <div className="mt-3">
        <SyncNotice />
      </div>
      <header className="mt-2 mb-5">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-ink">
          <DishIcon
            name={recipe.name}
            staple={recipe.tags.staple}
            cuisine={recipe.tags.cuisine}
            size={34}
          />
          {recipe.name}
        </h1>
        <p className="mt-1.5 text-xs font-medium text-brand-dark">
          {recipe.tags.cookTime ? `⏱ ${recipe.tags.cookTime}分` : ""}
          {viewKcal ? ` / ${viewKcal}kcal` : ""}
          {`　${viewServings}人分`}
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
            className="grid h-11 w-11 place-items-center rounded-full border border-line text-base text-ink-soft transition hover:bg-paper disabled:opacity-40"
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
            className="grid h-11 w-11 place-items-center rounded-full border border-line text-base text-ink-soft transition hover:bg-paper"
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

      {/* 何人前で作るか（完成レシピの人数セレクタ） */}
      <section className="mb-4 rounded-2xl border border-brand/30 bg-brand-soft/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-ink">
              <AppIcon name="meal" size={18} />
              何人前で作る？
            </h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              選んだ人数に材料・手順の分量・kcalを自動換算します
            </p>
          </div>
          <div className="inline-flex overflow-hidden rounded-xl ring-1 ring-line">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setServings(n)}
                aria-pressed={viewServings === n}
                className={`px-4 py-2 text-sm font-semibold transition ${
                  viewServings === n
                    ? "bg-brand text-white"
                    : "bg-surface text-ink-soft hover:bg-paper"
                }`}
              >
                {n}人
              </button>
            ))}
          </div>
        </div>
      </section>

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
        <h2 className="mb-3 text-sm font-bold text-ink">材料（{viewServings}人分）</h2>
        {factor !== 1 && (
          <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            ※{baseServings}人分を{viewServings}人分に自動換算（端数は目安）。
            {factor > 1 &&
              "塩・しょうゆ・スパイス・にんにく・わさび等の調味料は倍にすると濃くなりがち。表示量より控えめ（7〜8割）から入れて、味を見て足すのがおすすめ。"}
          </p>
        )}
        {groupIngredients(viewIngredients).map(([group, list]) => (
          <div key={group} className="mb-3 last:mb-0">
            <p className="mb-1 text-xs font-semibold text-ink-soft">{group}</p>
            <ul className="flex flex-col gap-1">
              {list.map((i, idx) => {
                const st = i.basicSeasoning ? null : stockOf(i.name, i.amount);
                const shortText =
                  st?.status === "short" &&
                  st.need != null &&
                  st.have != null
                    ? `あと${Math.round((st.need - st.have) * 100) / 100}${st.unit ?? ""}`
                    : "";
                return (
                <li key={idx} className="flex justify-between text-sm">
                  <span className="text-ink">
                    {i.name}
                    {st?.status === "enough" && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-semibold text-brand">
                        <Check size={11} strokeWidth={3} />
                        在庫あり
                      </span>
                    )}
                    {st?.status === "short" && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-semibold text-accent-dark">
                        <CirclePlus size={11} strokeWidth={2.5} />
                        不足（{shortText}）
                      </span>
                    )}
                    {st?.status === "none" && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-semibold text-accent-dark">
                        <CirclePlus size={11} strokeWidth={2.5} />
                        買い足し
                      </span>
                    )}
                  </span>
                  <span className="text-ink-soft">
                    {i.amount}
                    {factor > 1 && i.basicSeasoning && (
                      <span className="ml-1 text-[12px] font-medium text-amber-700">
                        味見て調整
                      </span>
                    )}
                  </span>
                </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      {/*
        材料表のすぐ下＝「在庫あり／不足」を見た直後に置く。
        上の「不足を買い物へ」とは役割が違うので、そこを説明文で言い切って競合させない。
          上のボタン … 自分で買いに行く。不足をアプリの買い物リストに入れる
          こちら     … 買いに行けない。不足をネットで注文して届けてもらう
        提携先が未設定のあいだは ShoppablePanel 側で何も描かれないので、既存の見た目は変わらない。
      */}
      <ShoppablePanel
        placement="recipe"
        count={missingIngredients.length}
        title={`足りない材料${missingIngredients.length}件を、ネットで注文して届けてもらう`}
        description="買いに行くなら上の「不足を買い物へ」でリストに入ります。今から行けないときは、こちらから届けてもらえます。"
        copyText={shoppingListText(missingIngredients)}
      />

      {/* 行程：1タブ＝1作業。チェックしながら進められる */}
      <section id="cook-steps" className="mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-ink">
            <AppIcon name="meal" size={18} />
            行程
            <span className="ml-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-dark">
              {doneCount}/{tasks.length}
            </span>
          </h2>
          {/*
            「すべて外す」は目的語がなく、何が起きるか初見で分からなかった。
            チェックを消す＝もう一度作るときの操作なので、そう書く。
            「保存方法へ」はここから外した。保存方法は作り終わったあとに見るものなので、
            手順の見出し横ではなく手順リストの最後に置く。
          */}
          <button
            type="button"
            onClick={clearTasks}
            disabled={doneCount === 0}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-line px-3.5 text-xs font-semibold text-ink-soft transition hover:border-brand hover:text-brand-dark disabled:opacity-40"
          >
            <RotateCcw size={15} strokeWidth={2} />
            チェックを全部消す
          </button>
        </div>

        {/* 進捗バー：どこまで進んだか一目で分かる */}
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-brand transition-all duration-300"
            style={{
              width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%`,
            }}
          />
        </div>

        <div className="mb-3">
          <CookingTimer suggestions={timerSuggestions} />
        </div>

        <ol className="flex flex-col gap-2">
          {tasks.map((t, idx) => {
            const done = !!checkedTasks[t.key];
            const newGroup = idx === 0 || tasks[idx - 1].groupIndex !== t.groupIndex;
            return (
              <li key={t.key} id={`task-${t.key}`}>
                {newGroup && (
                  <p className="mt-3 mb-1.5 text-xs font-bold text-brand-dark first:mt-0">
                    {t.group}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => toggleTask(t.key)}
                  className={`flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition ${
                    done
                      ? "border-line bg-paper"
                      : "border-line bg-surface hover:border-brand/40"
                  } ${flashKey === t.key ? "ring-2 ring-brand" : ""}`}
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 transition ${
                      done
                        ? "border-brand bg-brand text-white"
                        : "border-line bg-surface text-transparent"
                    }`}
                  >
                    <Check size={15} strokeWidth={3} />
                  </span>
                  <span className="flex-1">
                    <span
                      className={`block text-sm leading-relaxed transition ${
                        done ? "text-ink-soft line-through" : "text-ink"
                      }`}
                    >
                      {t.text}
                    </span>
                    {t.tip && (
                      <span className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs italic text-amber-800">
                        <Lightbulb size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
                        {t.tip}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/*
          保存方法への案内は「行き先」ではなく「いつ・何のために押すか」を書く。
          手順を全部終えたときだけ、次にやることとして出す。
        */}
        {hasStorage && (
          <button
            type="button"
            onClick={() => scrollToId("storage-section")}
            className="mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 text-sm font-bold text-brand-dark transition active:bg-brand-soft"
          >
            <Refrigerator size={18} strokeWidth={2} />
            {doneCount === tasks.length
              ? "おつかれさま。余った材料の保存方法を見る"
              : "余った材料の保存方法を見る"}
          </button>
        )}
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

      {hasStorage && (
        <section
          id="storage-section"
          className="mb-6 scroll-mt-20 rounded-2xl border border-line bg-surface p-4"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-ink">
              <AppIcon name="fridge" size={18} />
              余った材料の保存
            </h2>
            {/* 保存方法を見たあと、作業していた場所（未チェックの先頭）へ一発で戻る */}
            <button
              type="button"
              onClick={backToCurrentTask}
              className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:border-brand hover:text-brand-dark"
            >
              <ArrowUp size={13} strokeWidth={1.8} />
              作業中の場所へ戻る
            </button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {storage.map((l, idx) => (
              <li key={idx} className="text-sm">
                <span className="font-medium text-ink">{l.ingredient}</span>
                {l.auto && (
                  <span className="ml-1 text-[12px] font-medium text-ink-soft">
                    （目安）
                  </span>
                )}
                <span className="text-ink-soft">：{l.method}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        参考リンクが空のときは、見出しごと消さずに「無い」と書く。
        黙って消すと「機能が無くなった」ように見えてしまう（大翔の指摘・2026-07-31）。
        sources は AI が埋めそこねると空配列になるので、その事実が画面に出るようにする。
      */}
      {(recipe.sources?.length ?? 0) === 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-ink">
            <Link2 size={16} strokeWidth={2} />
            参考にしたページ
          </h2>
          <p className="text-sm text-ink-soft">
            このレシピには参考ページが記録されていません。
          </p>
        </section>
      ) : (
        <section className="mb-6">
          <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-ink">
            <Link2 size={16} strokeWidth={2} />
            参考にしたページ
          </h2>
          <ul className="flex flex-col gap-1">
            {recipe.sources.map((src, idx) => (
              <li key={idx} className="text-sm">
                {src.url ? (
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-dark underline"
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
          <button
            type="button"
            onClick={proofread}
            disabled={proofLoading}
            className="w-full rounded-xl border border-brand/30 bg-brand-soft py-2.5 text-sm font-semibold text-brand-dark transition hover:border-brand disabled:opacity-60"
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <Sparkles size={16} strokeWidth={2} />
              {proofLoading ? "AIが整えています…" : "AIで手順を読みやすく整える"}
            </span>
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
              使った冷蔵庫の食材を更新します（あとで「取り消す」で元に戻せます）。「レシピ分」を選ぶと、使った分だけ引いて残りを在庫に残します。
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
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[12px] font-medium text-amber-700">
                          調味料
                        </span>
                      )}
                      {recipeAmountFor(f) && (
                        <span className="text-[12px] font-medium text-brand-dark">
                          レシピ:{recipeAmountFor(f)}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          [
                            "portion",
                            recipeAmountFor(f)
                              ? `レシピ分(${recipeAmountFor(f)})`
                              : "レシピ分使う",
                          ],
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
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                  <Soup size={13} strokeWidth={2} />
                  使った調味料（常備のため在庫はそのまま）
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

      {/*
        戻る導線は **画面の下** に固定する。
        iPhoneは片手だと上端に指が届かないので、上に置くと「一生戻れない」状態になる
        （大翔の実機報告・2026-07-31）。sticky bottom-0 で、タブバーのすぐ上に常に出す。
        position:fixed を使わないのは、iOSのラバーバンドで document ごと動いてしまうため
        （このアプリはボトムタブも同じ理由で通常フローに置いている）。
      */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-line bg-paper/95 px-4 pt-2 pb-2 backdrop-blur-md">
        <Link
          href="/recipes"
          className="flex min-h-[52px] w-full items-center justify-center gap-1.5 rounded-2xl bg-surface text-[15px] font-bold text-brand-dark shadow-sm transition active:scale-[.98] active:bg-brand-soft"
        >
          <ChevronLeft size={22} strokeWidth={2.6} />
          レシピ一覧へ戻る
        </Link>
      </div>
    </div>
  );
}
