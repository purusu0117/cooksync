"use client";

import { useMemo, useState } from "react";
import {
  bucketOf,
  daysUntil,
  FRESHNESS,
  freshnessOf,
  sortByExpiry,
  todayISO,
} from "@/lib/food";
import {
  ingredientMatches,
  type Cuisine,
  type Heaviness,
  type Recipe,
  type RecipeTags,
  type StapleType,
} from "@/lib/recipe";
import { fridgeStore, mealStore, shoppingStore, recipeStore } from "@/lib/storage";
import { usePersistentList, useAllRecipes } from "@/lib/useStore";
import { rankCandidates } from "@/lib/ranking";
import {
  slotsForTiming,
  type MealEntry,
  type MealSlot,
  type MealTiming,
} from "@/lib/mealplan";
import type { ShoppingItem } from "@/lib/shopping";
import PageHeader from "@/components/PageHeader";

type Phase = "timing" | "direction" | "pick" | "missing" | "done";

interface Pick {
  date: string;
  slot: MealSlot;
  recipe: Recipe;
}

interface MissingChoice {
  name: string;
  amount: string;
  note: string;
  selected: boolean;
}

const TIMINGS: { value: MealTiming; label: string; hint: string }[] = [
  { value: "昼", label: "昼ごはん", hint: "1食" },
  { value: "夜", label: "夜ごはん", hint: "1食" },
  { value: "両方", label: "昼夜 両方", hint: "2食" },
  { value: "翌日も", label: "翌日も含む", hint: "4食" },
];

const CUISINES: Cuisine[] = ["和", "洋", "中", "アジアン"];
const HEAVINESS: Heaviness[] = ["ガッツリ", "さっぱり", "あっさり"];
const STAPLES: StapleType[] = ["ご飯", "麺", "パン"];
const TIMES: { v: 15 | 30 | 60; label: string }[] = [
  { v: 15, label: "簡単15分" },
  { v: 30, label: "普通30分" },
  { v: 60, label: "じっくり" },
];

function chip(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-sm font-medium transition ${
    active
      ? "border-brand bg-brand text-white"
      : "border-line bg-surface text-ink-soft hover:border-brand hover:text-brand-dark"
  }`;
}

export default function MealWizard() {
  const [phase, setPhase] = useState<Phase>("timing");
  const [fridge] = usePersistentList(fridgeStore);
  const recipes = useAllRecipes();
  const [recent, setRecent] = usePersistentList(mealStore);
  const [, setShopping] = usePersistentList(shoppingStore);
  const [, setStoredRecipes] = usePersistentList(recipeStore);

  const [timing, setTiming] = useState<MealTiming>("夜");
  const [filters, setFilters] = useState<RecipeTags>({});
  const [slots, setSlots] = useState<{ date: string; slot: MealSlot }[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [slotIndex, setSlotIndex] = useState(0);
  const [missing, setMissing] = useState<MissingChoice[]>([]);

  const [servings, setServings] = useState(2);
  const [wish, setWish] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResults, setAiResults] = useState<Recipe[]>([]);

  const priority = useMemo(
    () => sortByExpiry(fridge).filter((f) => bucketOf(f.expiresOn) === "priority"),
    [fridge],
  );

  // 現在のスロットのランキング（既に選んだレシピは除外）
  const ranked = useMemo(() => {
    const pseudoRecent: MealEntry[] = [
      ...recent,
      ...picks.map((p) => ({
        id: p.recipe.id,
        date: p.date,
        slot: p.slot,
        recipeId: p.recipe.id,
        recipeName: p.recipe.name,
      })),
    ];
    return rankCandidates(recipes, fridge, pseudoRecent, filters).filter(
      (r) => r.score > -500,
    );
  }, [recipes, fridge, recent, picks, filters]);

  function toggleFilter<K extends keyof RecipeTags>(key: K, val: RecipeTags[K]) {
    setFilters((f) => ({ ...f, [key]: f[key] === val ? undefined : val }));
  }

  function startPicking() {
    const s = slotsForTiming(timing);
    setSlots(s);
    setPicks([]);
    setSlotIndex(0);
    setPhase("pick");
  }

  function pickRecipe(recipe: Recipe) {
    const slot = slots[slotIndex];
    const nextPicks = [...picks, { ...slot, recipe }];
    setPicks(nextPicks);
    if (slotIndex + 1 < slots.length) {
      setSlotIndex(slotIndex + 1);
    } else {
      buildMissing(nextPicks);
      setPhase("missing");
    }
  }

  function buildMissing(allPicks: Pick[]) {
    const fridgeNames = fridge.map((f) => f.name);
    const seen = new Set<string>();
    const choices: MissingChoice[] = [];
    for (const p of allPicks) {
      for (const ing of p.recipe.ingredients) {
        const inFridge = fridgeNames.some((n) => ingredientMatches(n, ing.name));
        if (inFridge) continue;
        const key = ing.name;
        if (seen.has(key)) continue;
        seen.add(key);
        choices.push({
          name: ing.name,
          amount: ing.amount,
          note: `${p.slot}の${p.recipe.name}用`,
          // 買い足し品は既定でチェック。基本調味料は「無ければ」ユーザー判断
          selected: !!ing.toBuy,
        });
      }
    }
    setMissing(choices);
  }

  async function aiSearch() {
    if (aiLoading) return;
    setAiError("");
    setAiResults([]);
    setAiLoading(true);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wish: wish.trim(),
          servings,
          fridge: fridge.map((f) => f.name),
          expiring: priority.map((p) => p.name),
          filters,
          avoid: [
            ...recent.map((r) => r.recipeName),
            ...picks.map((p) => p.recipe.name),
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.recipes) || data.recipes.length === 0) {
        throw new Error(data.error || "レシピが取得できませんでした");
      }
      const mapped: Recipe[] = data.recipes.map((r: Record<string, unknown>) => {
        const name = typeof r.name === "string" ? r.name : "AIレシピ";
        const cookTime = typeof r.cookTime === "number" ? r.cookTime : 30;
        const ct: 15 | 30 | 60 = cookTime <= 15 ? 15 : cookTime <= 30 ? 30 : 60;
        return {
          id: `ai-${crypto.randomUUID().slice(0, 8)}`,
          name,
          emoji: typeof r.emoji === "string" ? r.emoji : "🍽",
          kcal: typeof r.kcal === "number" ? r.kcal : undefined,
          catch: typeof r.catch === "string" ? r.catch : "",
          servings: typeof r.servings === "number" ? r.servings : servings,
          ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
          steps: Array.isArray(r.steps) ? r.steps : [],
          leftoverStorage: Array.isArray(r.leftoverStorage)
            ? r.leftoverStorage
            : [],
          sources: Array.isArray(r.sources) ? r.sources : [],
          tags: { cuisine: r.cuisine as Cuisine | undefined, cookTime: ct },
          createdAt: Date.now(),
        };
      });
      setAiResults(mapped);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI検索に失敗しました");
    } finally {
      setAiLoading(false);
    }
  }

  function pickAiRecipe(recipe: Recipe) {
    setStoredRecipes((prev) => [recipe, ...prev]);
    setAiResults([]);
    setWish("");
    pickRecipe(recipe);
  }

  function finalize() {
    // 1) 不足食材を買い物リストへ（既にリストにある名前は除く）
    setShopping((existing) => {
      const existingNames = existing.map((e) => e.name);
      const toAdd: ShoppingItem[] = missing
        .filter((m) => m.selected)
        .filter((m) => !existingNames.some((n) => ingredientMatches(n, m.name)))
        .map((m) => ({
          id: crypto.randomUUID(),
          name: m.name,
          amount: m.amount,
          note: m.note,
          checked: false,
          addedAt: Date.now(),
        }));
      return [...existing, ...toAdd];
    });

    // 2) 食事計画を記録（連日回避の根拠に）
    const newMeals: MealEntry[] = picks.map((p) => ({
      id: crypto.randomUUID(),
      date: p.date,
      slot: p.slot,
      recipeId: p.recipe.id,
      recipeName: p.recipe.name,
    }));
    setRecent((meals) => [...meals, ...newMeals]);

    setPhase("done");
  }

  function downloadIcs() {
    // 当日の買い物リマインダー（30分）。昼は11:00 / 夜は17:00 を目安に。
    const hasLunch = picks.some((p) => p.slot === "昼");
    const hour = hasLunch ? 11 : 17;
    const d = todayISO().replace(/-/g, "");
    const dtStart = `${d}T${String(hour).padStart(2, "0")}0000`;
    const dtEnd = `${d}T${String(hour).padStart(2, "0")}3000`;
    const buyList = missing.filter((m) => m.selected).map((m) => `- ${m.name} ${m.amount}`).join("\\n");
    const menu = picks.map((p) => `- ${p.slot}: ${p.recipe.name}`).join("\\n");
    const desc = `買うもの:\\n${buyList || "（なし）"}\\n\\nメニュー:\\n${menu}`;
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//pantry//meal//JP",
      "BEGIN:VEVENT",
      `UID:${crypto.randomUUID()}@pantry`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      "SUMMARY:🛒 スーパーで買い物",
      `DESCRIPTION:${desc}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      "DESCRIPTION:買い物リマインダー",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "buy-reminder.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <PageHeader
        kicker="Meal"
        title="献立を決める"
        tagline="冷蔵庫の期限を踏まえて、人気レシピから提案します。"
      />

      {/* 優先消費バナー */}
      {priority.length > 0 && phase !== "done" && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50/70 p-3">
          <p className="mb-1 text-xs font-bold text-red-700">🔴 今日の優先消費食材</p>
          <p className="text-sm text-red-900">
            {priority
              .map((p) => `${p.name}（${FRESHNESS[freshnessOf(p.expiresOn)].label(daysUntil(p.expiresOn))}）`)
              .join("　/　")}
          </p>
        </div>
      )}

      {/* Step 1: タイミング */}
      {phase === "timing" && (
        <section className="animate-pop-in">
          <h2 className="mb-3 text-sm font-bold text-ink">どの食事を決める？</h2>
          <div className="grid grid-cols-2 gap-3">
            {TIMINGS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTiming(t.value)}
                className={`rounded-2xl border p-4 text-left transition ${
                  timing === t.value
                    ? "border-brand bg-brand-soft"
                    : "border-line bg-surface hover:border-brand"
                }`}
              >
                <p className="font-semibold text-ink">{t.label}</p>
                <p className="text-xs text-ink-soft">{t.hint}</p>
              </button>
            ))}
          </div>
          <button
            onClick={() => setPhase("direction")}
            className="mt-5 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99]"
          >
            次へ
          </button>
        </section>
      )}

      {/* Step 3: 方向性 */}
      {phase === "direction" && (
        <section className="animate-pop-in">
          <h2 className="mb-3 text-sm font-bold text-ink">
            気分は？（任意・選ばなければ「おまかせ」）
          </h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {CUISINES.map((c) => (
                <button key={c} className={chip(filters.cuisine === c)} onClick={() => toggleFilter("cuisine", c)}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {HEAVINESS.map((h) => (
                <button key={h} className={chip(filters.heaviness === h)} onClick={() => toggleFilter("heaviness", h)}>
                  {h}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {STAPLES.map((s) => (
                <button key={s} className={chip(filters.staple === s)} onClick={() => toggleFilter("staple", s)}>
                  {s}系
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {TIMES.map((t) => (
                <button key={t.v} className={chip(filters.cookTime === t.v)} onClick={() => toggleFilter("cookTime", t.v)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-ink-soft">何人分？</p>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setServings(n)}
                    className={chip(servings === n)}
                  >
                    {n}人分
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <button onClick={() => setPhase("timing")} className="flex-1 rounded-xl border border-line px-4 py-3 text-sm font-medium text-ink-soft transition hover:bg-paper">
              戻る
            </button>
            <button onClick={startPicking} className="flex-1 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99]">
              提案を見る
            </button>
          </div>
        </section>
      )}

      {/* Step 4-6: 候補から選ぶ */}
      {phase === "pick" && (
        <section className="animate-pop-in">
          <p className="mb-3 text-sm text-ink-soft">
            {slots.length > 1 && (
              <span className="mr-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-dark">
                {slotIndex + 1} / {slots.length}
              </span>
            )}
            <span className="font-semibold text-ink">
              {slots[slotIndex]?.date === todayISO() ? "今日" : "翌日"}の
              {slots[slotIndex]?.slot}ごはん
            </span>{" "}
            を選ぶ
          </p>
          {/* AIで探す */}
          <div className="mb-4 rounded-2xl border border-brand/30 bg-brand-soft/50 p-3">
            <p className="mb-2 text-xs text-ink-soft">
              🔎 食べたい物を入力すると、AIがWebから人気レシピを探して不足食材も計算します。
            </p>
            <div className="flex gap-2">
              <input
                value={wish}
                onChange={(e) => setWish(e.target.value)}
                disabled={aiLoading}
                placeholder="例：油淋鶏 / さっぱり和食 / パスタ"
                className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft disabled:opacity-60"
              />
              <button
                onClick={aiSearch}
                disabled={aiLoading}
                className="shrink-0 rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-95 disabled:bg-line disabled:text-ink-soft"
              >
                {aiLoading ? "探索中…" : "AIで探す"}
              </button>
            </div>
            {aiLoading && (
              <p className="mt-2 animate-pulse text-xs text-brand-dark">
                AIがレシピをWeb検索中…（最大1〜2分）。そのままお待ちください。
              </p>
            )}
            {aiError && <p className="mt-2 text-xs text-red-600">{aiError}</p>}
          </div>

          {aiResults.length > 0 && (
            <div className="mb-5">
              <p className="mb-2 text-xs font-semibold text-brand-dark">
                ✨ AIの提案（タップで決定・{servings}人分）
              </p>
              <ul className="flex flex-col gap-3">
                {aiResults.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => pickAiRecipe(r)}
                      className="flex w-full items-start gap-3 rounded-2xl border border-brand/40 bg-surface p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <span className="text-2xl" aria-hidden>{r.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">{r.name}</p>
                        <p className="mt-0.5 text-xs text-ink-soft">{r.catch}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {r.sources[0] && (
                            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-dark">
                              {r.sources[0].label}
                              {r.sources[0].popularity ? `・${r.sources[0].popularity}` : ""}
                            </span>
                          )}
                          {r.tags.cookTime && (
                            <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink-soft">
                              ⏱{r.tags.cookTime}分
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mb-2 text-xs font-semibold text-ink-soft">
            または、おすすめから選ぶ
          </p>
          <ul className="flex flex-col gap-3">
            {ranked.slice(0, 4).map((r) => (
              <li key={r.recipe.id}>
                <button
                  onClick={() => pickRecipe(r.recipe)}
                  className="flex w-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md"
                >
                  <span className="text-2xl" aria-hidden>{r.recipe.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{r.recipe.name}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">{r.recipe.catch}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.recipe.sources[0] && (
                        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-dark">
                          {r.recipe.sources[0].label}
                          {r.recipe.sources[0].popularity ? `・${r.recipe.sources[0].popularity}` : ""}
                        </span>
                      )}
                      {r.usesExpiring.length > 0 && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                          期限間近を{r.usesExpiring.length}品消費
                        </span>
                      )}
                      {r.missingNames.length <= 1 && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          買い足しほぼ無し
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Step 5.5: 在庫の網羅確認 */}
      {phase === "missing" && (
        <section className="animate-pop-in">
          <h2 className="mb-1 text-sm font-bold text-ink">在庫の確認</h2>
          <p className="mb-3 text-xs text-ink-soft">
            冷蔵庫に無い材料です。<b>家に無いものだけチェック</b>すると買い物リストに追加します（調味料も念のため確認）。
          </p>
          {missing.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-ink-soft">
              冷蔵庫の在庫で足りそうです。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {missing.map((m, idx) => (
                <li key={m.name}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={m.selected}
                      onChange={() =>
                        setMissing((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, selected: !x.selected } : x)),
                        )
                      }
                      className="h-4 w-4 accent-[var(--color-brand)]"
                    />
                    <span className="flex-1 text-sm text-ink">
                      {m.name} <span className="text-ink-soft">{m.amount}</span>
                    </span>
                    <span className="text-[11px] text-ink-soft/70">{m.note}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={finalize}
            className="mt-5 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99]"
          >
            この内容で確定する
          </button>
        </section>
      )}

      {/* 完了 */}
      {phase === "done" && (
        <section className="animate-pop-in">
          <div className="rounded-2xl border border-brand/30 bg-brand-soft/60 p-4">
            <h2 className="mb-2 text-base font-bold text-brand-dark">✅ 献立が決まりました</h2>
            <ul className="flex flex-col gap-1 text-sm text-ink">
              {picks.map((p, i) => (
                <li key={i}>
                  <span className="font-semibold">
                    {p.date === todayISO() ? "今日" : "翌日"}の{p.slot}
                  </span>
                  ：{p.recipe.emoji} {p.recipe.name}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <a
              href="/shopping"
              className="rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm font-semibold text-ink transition hover:border-brand"
            >
              🛒 買い物リストを見る
            </a>
            <button
              onClick={downloadIcs}
              className="rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink transition hover:border-brand"
            >
              📅 買い物リマインダー(.ics)
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {picks.map((p, i) => (
              <a
                key={i}
                href={`/recipes/${p.recipe.id}`}
                className="rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-brand-dark ring-1 ring-line transition hover:ring-brand"
              >
                {p.recipe.emoji} {p.recipe.name} の作り方 →
              </a>
            ))}
          </div>

          <button
            onClick={() => {
              setPhase("timing");
              setPicks([]);
              setSlots([]);
              setSlotIndex(0);
              setMissing([]);
              setFilters({});
            }}
            className="mt-5 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            もう一度献立を決める
          </button>
        </section>
      )}
    </div>
  );
}
