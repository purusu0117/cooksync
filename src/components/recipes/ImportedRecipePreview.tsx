"use client";

// 動画・写真から起こしたレシピの確認画面（保存前）。
// ⚠️ AIの書き起こしなので **確認せずに保存させない**。
//    分量が読み取れなかった材料はここではっきり出す（推測で埋めない方針の受け皿）。

import Link from "next/link";
import { useState } from "react";
import { recipeStore } from "@/lib/storage";
import { usePersistentList, useAllRecipes } from "@/lib/useStore";
import { isSameDish, type Cuisine, type Recipe } from "@/lib/recipe";
import DishIcon from "@/components/DishIcon";

export interface RawRecipe {
  name?: string;
  emoji?: string;
  catch?: string;
  servings?: number;
  kcal?: number;
  cookTime?: number;
  cuisine?: string;
  ingredients?: {
    name: string;
    amount: string;
    group?: string;
    toBuy?: boolean;
    basicSeasoning?: boolean;
  }[];
  steps?: { title: string; text: string; tip?: string }[];
  leftoverStorage?: { ingredient: string; method: string }[];
  sources?: { label: string; url: string; popularity?: string }[];
}

export interface ImportResult {
  /** AIが「料理ではない」と判断すると null になる（＝レシピ無し）。
   *  サーバー側で error にしているが、ここでも受けられるようにしておく。 */
  recipe: RawRecipe | null | undefined;
  missing?: string[];
  confidence?: string;
  /** 出典の表示用（動画のときだけ） */
  source?: { title: string; channel: string; url: string };
  /** 複数写真のとき、AIが判断した調理順（渡した画像の1始まりの番号） */
  photoOrder?: number[];
  /** 渡した写真の枚数 */
  photoCount?: number;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "材料と分量がはっきり読み取れました",
  medium: "一部は読み取れなかったので確認してください",
  low: "推定が多めです。分量は必ず元の動画・写真で確認してください",
};

/** 読み取れなかった分量の目印（AI側の出力と合わせる） */
function isUnknownAmount(amount?: string): boolean {
  return !!amount && (amount.includes("明示なし") || amount.includes("確認できず"));
}

export default function ImportedRecipePreview({
  result,
  onDiscard,
}: {
  result: ImportResult;
  onDiscard: () => void;
}) {
  const [savedId, setSavedId] = useState<string | null>(null);
  const [, setStored] = usePersistentList(recipeStore);
  const recipes = useAllRecipes();
  const r = result.recipe;

  // 保険：レシピが無いのに渡されたら**何も描かない**。
  // ここで r.name を読んで落ちると、この画面だけでなく
  // ホーム画面ごと真っ白になる（2026-08-01の監査で判明）。
  // フックは全部この上で呼んでいるので、早期returnしても順序は崩れない。
  if (!r) return null;

  const duplicate = !!r.name && recipes.some((x) => isSameDish(x.name, r.name!));

  // ⚠️ アロー関数にしてある。`function save()` は巻き上げられる関係で、
  //    上の `if (!r) return null` による絞り込みが中まで効かない（TS18049）。
  const save = () => {
    const ct = typeof r.cookTime === "number" ? r.cookTime : 30;
    const id = `import-${crypto.randomUUID().slice(0, 8)}`;
    const recipe: Recipe = {
      id,
      name: r.name || "取り込んだレシピ",
      emoji: r.emoji || "🍽",
      catch: r.catch || "",
      servings: typeof r.servings === "number" ? r.servings : 2,
      kcal: typeof r.kcal === "number" ? r.kcal : undefined,
      ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
      steps: Array.isArray(r.steps) ? r.steps : [],
      leftoverStorage: Array.isArray(r.leftoverStorage) ? r.leftoverStorage : [],
      sources: Array.isArray(r.sources) ? r.sources : [],
      tags: {
        cuisine: (r.cuisine as Cuisine) || undefined,
        cookTime: ct <= 15 ? 15 : ct <= 30 ? 30 : 60,
      },
      createdAt: Date.now(),
    };
    setStored((prev) => [recipe, ...prev]);
    setSavedId(id);
  };

  if (savedId) {
    return (
      <div className="mt-3 rounded-2xl bg-brand-soft px-4 py-3">
        <p className="text-xs font-semibold text-brand-dark">
          「{r.name}」をレシピに保存しました。
        </p>
        <Link
          href={`/recipes/${savedId}`}
          className="mt-2 inline-block rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white"
        >
          レシピを開く →
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-line bg-paper p-3">
      <div className="flex items-start gap-2.5">
        <DishIcon name={r.name || ""} size={26} />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink">{r.name}</p>
          {r.catch && <p className="mt-0.5 text-xs text-ink-soft">{r.catch}</p>}
          {result.source && (
            <p className="mt-1 truncate text-xs text-ink-soft">
              出典：{result.source.channel}「{result.source.title}」
            </p>
          )}
        </div>
      </div>

      {result.confidence && (
        <p
          className={`mt-2 rounded-lg px-2.5 py-1.5 text-xs ${
            result.confidence === "high"
              ? "bg-brand-soft text-brand-dark"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {CONFIDENCE_LABEL[result.confidence] ?? result.confidence}
        </p>
      )}

      {/* 複数写真：AIがどう並べ替えたかを見せる（順番が違えば大翔が気づける） */}
      {(result.photoCount ?? 0) > 1 && (
        <p className="mt-2 rounded-lg bg-paper px-2.5 py-1.5 text-xs leading-relaxed text-ink-soft">
          写真{result.photoCount}枚をまとめました。
          {result.photoOrder && result.photoOrder.length > 1 ? (
            <>
              調理順は <strong className="text-brand-dark">{result.photoOrder.join(" → ")}</strong>{" "}
              枚目の順と判断しています（選んだ順が1・2・3…）。違っていたら保存後に手順を直してください。
            </>
          ) : (
            "順番は写真の内容から判断しています。"
          )}
        </p>
      )}

      {result.missing && result.missing.length > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-800">
          ⚠ 分量が読み取れなかった材料：{result.missing.join("、")}
          <br />
          保存後にレシピを開いて、元の動画・写真を見ながら直してください。
        </p>
      )}

      {duplicate && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          同じ名前のレシピが既にあります。保存すると2件になります。
        </p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold text-brand-dark">
          材料 {r.ingredients?.length ?? 0}点・手順 {r.steps?.length ?? 0}工程を確認
        </summary>
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {(r.ingredients ?? []).map((i, idx) => (
            <li key={idx} className="flex justify-between gap-2 text-xs">
              <span className="text-ink">{i.name}</span>
              <span
                className={
                  isUnknownAmount(i.amount) ? "shrink-0 text-accent-dark" : "shrink-0 text-ink-soft"
                }
              >
                {i.amount}
              </span>
            </li>
          ))}
        </ul>
        {(r.steps ?? []).length > 0 && (
          <ol className="mt-2 flex flex-col gap-1">
            {(r.steps ?? []).map((s, idx) => (
              <li key={idx} className="text-xs leading-relaxed text-ink">
                <span className="font-semibold">{s.title}</span>：{s.text}
              </li>
            ))}
          </ol>
        )}
      </details>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="flex-1 rounded-xl border border-line py-2 text-xs font-medium text-ink-soft"
        >
          破棄
        </button>
        <button
          type="button"
          onClick={save}
          className="flex-1 rounded-xl bg-brand py-2 text-xs font-semibold text-white"
        >
          レシピに保存
        </button>
      </div>
    </div>
  );
}
