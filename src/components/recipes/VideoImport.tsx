"use client";

// YouTube / TikTok のURLを貼るとレシピにして取り込む。
// 取り込みは時間がかかる（yt-dlp＋AIで30〜120秒）のでジョブ方式。
// ⚠️ 保存する前に必ずプレビューを見せる。AIの書き起こしなので、確認せず在庫や買い物に
//    影響させない（分量が読み取れなかった材料はその場で赤く出す）。

import { useRef, useState } from "react";
import { Link2, Loader2, Video } from "lucide-react";
import { recipeStore } from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import { isSameDish, type Cuisine, type Recipe } from "@/lib/recipe";
import { useAllRecipes } from "@/lib/useStore";
import DishIcon from "@/components/DishIcon";

interface RawRecipe {
  name?: string;
  emoji?: string;
  catch?: string;
  servings?: number;
  kcal?: number;
  cookTime?: number;
  cuisine?: string;
  ingredients?: { name: string; amount: string; group?: string; toBuy?: boolean; basicSeasoning?: boolean }[];
  steps?: { title: string; text: string; tip?: string }[];
  leftoverStorage?: { ingredient: string; method: string }[];
  sources?: { label: string; url: string; popularity?: string }[];
}

interface JobResult {
  status: string;
  step?: string;
  recipe?: RawRecipe;
  source?: { title: string; channel: string; url: string };
  missing?: string[];
  confidence?: string;
  error?: string;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "概要欄に材料と分量が揃っていました",
  medium: "一部は動画から推定しています",
  low: "字幕頼りのため、分量は要確認です",
};

export default function VideoImport() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<JobResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [, setStored] = usePersistentList(recipeStore);
  const recipes = useAllRecipes();
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const duplicate =
    result?.recipe?.name && recipes.some((r) => isSameDish(r.name, result.recipe!.name!));

  async function poll(jobId: string) {
    try {
      const res = await fetch(`/api/import-video?jobId=${jobId}`);
      const data = (await res.json()) as JobResult;
      if (data.status === "done") {
        setLoading(false);
        setResult(data);
        return;
      }
      if (data.status === "error" || data.status === "missing") {
        setLoading(false);
        setError(data.error || "取り込みに失敗しました");
        return;
      }
      if (data.step) setStep(data.step);
      pollRef.current = setTimeout(() => poll(jobId), 3000);
    } catch {
      pollRef.current = setTimeout(() => poll(jobId), 4000);
    }
  }

  async function start() {
    if (loading || !url.trim()) return;
    setError("");
    setResult(null);
    setSaved(false);
    setLoading(true);
    setStep("動画の情報を取得中…");
    try {
      const res = await fetch("/api/import-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.jobId) throw new Error(data.error || "開始できませんでした");
      poll(data.jobId);
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : "取り込みに失敗しました");
    }
  }

  function save() {
    const r = result?.recipe;
    if (!r) return;
    const ct = typeof r.cookTime === "number" ? r.cookTime : 30;
    const recipe: Recipe = {
      id: `video-${crypto.randomUUID().slice(0, 8)}`,
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
    setSaved(true);
    setUrl("");
  }

  function reset() {
    if (pollRef.current) clearTimeout(pollRef.current);
    setResult(null);
    setError("");
    setSaved(false);
    setUrl("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-brand/40 bg-brand-soft/50 py-3 text-sm font-semibold text-brand-dark transition hover:border-brand"
      >
        <Video size={18} strokeWidth={2} />
        動画のURLからレシピを作る
      </button>
    );
  }

  return (
    <section className="animate-pop-in mb-3 rounded-2xl border border-brand/30 bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-ink">
          <Video size={16} strokeWidth={2} className="text-accent-dark" />
          動画からレシピを作る
        </h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-xs text-ink-soft transition hover:text-brand"
        >
          閉じる
        </button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2
            size={15}
            strokeWidth={1.8}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="YouTube / TikTok のURLを貼り付け"
            inputMode="url"
            className="w-full rounded-xl border border-line bg-paper py-2.5 pr-3 pl-9 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft"
          />
        </div>
        <button
          type="button"
          onClick={start}
          disabled={loading || !url.trim()}
          className="shrink-0 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft"
        >
          取り込む
        </button>
      </div>

      {loading && (
        <p className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-brand-dark">
          <Loader2 size={14} className="animate-spin" />
          {step}（30〜120秒かかります）
        </p>
      )}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {result?.recipe && !saved && (
        <div className="mt-4 rounded-2xl border border-line bg-paper p-3">
          <div className="flex items-start gap-2.5">
            <DishIcon name={result.recipe.name || ""} size={26} />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink">{result.recipe.name}</p>
              {result.recipe.catch && (
                <p className="mt-0.5 text-[11px] text-ink-soft">{result.recipe.catch}</p>
              )}
              {result.source && (
                <p className="mt-1 truncate text-[11px] text-ink-soft">
                  出典：{result.source.channel}「{result.source.title}」
                </p>
              )}
            </div>
          </div>

          {result.confidence && (
            <p
              className={`mt-2 rounded-lg px-2.5 py-1.5 text-[11px] ${
                result.confidence === "high"
                  ? "bg-brand-soft text-brand-dark"
                  : "bg-amber-50 text-amber-800"
              }`}
            >
              {CONFIDENCE_LABEL[result.confidence] ?? result.confidence}
            </p>
          )}

          {/* 動画から分量が読み取れなかったものは、保存前にはっきり出す（推測で埋めない方針） */}
          {result.missing && result.missing.length > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800">
              ⚠ 動画で分量が確認できなかった材料：{result.missing.join("、")}
              <br />
              保存後にレシピを開いて、実際の動画を見ながら直してください。
            </p>
          )}

          {duplicate && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              同じ名前のレシピが既にあります。重複して保存されます。
            </p>
          )}

          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] font-semibold text-brand-dark">
              材料 {result.recipe.ingredients?.length ?? 0}点・手順{" "}
              {result.recipe.steps?.length ?? 0}工程を確認
            </summary>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {(result.recipe.ingredients ?? []).map((i, idx) => (
                <li key={idx} className="flex justify-between text-[11px]">
                  <span className="text-ink">{i.name}</span>
                  <span
                    className={
                      i.amount?.includes("明示なし") ? "text-accent-dark" : "text-ink-soft"
                    }
                  >
                    {i.amount}
                  </span>
                </li>
              ))}
            </ul>
            <ol className="mt-2 flex flex-col gap-1">
              {(result.recipe.steps ?? []).map((s, idx) => (
                <li key={idx} className="text-[11px] text-ink">
                  <span className="font-semibold">{s.title}</span>：{s.text}
                </li>
              ))}
            </ol>
          </details>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={reset}
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
      )}

      {saved && (
        <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2 text-xs font-medium text-brand-dark">
          レシピに保存しました。一覧から開いて内容を確認できます。
        </p>
      )}
    </section>
  );
}
