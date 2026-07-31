"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarPlus,
  ChefHat,
  CircleCheck,
  Clock,
  Flame,
  Lightbulb,
  Palette,
  Refrigerator,
  RefreshCw,
  Search,
  ShoppingCart,
  X,
  Sparkles,
  UtensilsCrossed,
  Users,
} from "lucide-react";
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
  isSameDish,
  type Cuisine,
  type Heaviness,
  type Recipe,
  type RecipeTags,
  type StapleType,
} from "@/lib/recipe";
import {
  fridgeStore,
  mealStore,
  shoppingStore,
  recipeStore,
  ratingStore,
} from "@/lib/storage";
import { usePersistentList, useAllRecipes } from "@/lib/useStore";
import { rankCandidates, starsMapOf } from "@/lib/ranking";
import { toBuyableFor } from "@/lib/packaging";
import { matchesQuery } from "@/lib/recipeFilter";
import {
  recentMeals,
  slotsForTiming,
  type MealEntry,
  type MealSlot,
  type MealTiming,
} from "@/lib/mealplan";
import type { ShoppingItem } from "@/lib/shopping";
import { enablePush, ensurePushIfGranted } from "@/lib/pushClient";
import { getUid, useSyncState } from "@/lib/syncStore";
import { useGuide, setGuide } from "@/lib/guide";
import { readApiError, useUsage } from "@/lib/usage";
import EmptyState, { EMPTY_STATES } from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import StarRating from "@/components/StarRating";
import DishIcon from "@/components/DishIcon";

type Phase = "timing" | "direction" | "pick" | "missing" | "done";

// 進行中のAIリサーチjobIdの保存先（アプリ離脱→再訪でも結果を回収するため）
const JOB_KEY = "cooksync:aiJob";
// 献立ウィザードの状態スナップショット（通知から開く/他タブ往復でも3案を保持）
const STATE_KEY = "cooksync:mealState";

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
  inFridge: boolean; // 冷蔵庫にある（既定でチェックしない／在庫ありと表示）
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
  const [ratings] = usePersistentList(ratingStore);
  const usage = useUsage();
  const guide = useGuide();
  const sync = useSyncState();

  const [timing, setTiming] = useState<MealTiming>("夜");
  const [filters, setFilters] = useState<RecipeTags>({});
  /*
   * 買い物方針：stock=冷蔵庫の在庫だけで作る / buy=買い物OK（在庫に縛られない）
   *
   * ★ 在庫ゼロなら "buy" に倒す（2026-08-01）。
   *   既定の "stock" のまま在庫0件で進むと、**在庫縛りなのに在庫が無い**提案になり、
   *   初見の人は手応えのない結果に着地して離脱する。初回の到達点は
   *   「最初の献立が出た」なので、在庫が無いなら買い物前提に倒しておく。
   *
   *   本人が選んだ／スナップショットから復元した場合は、その選択が必ず優先される
   *   （null＝まだ誰も選んでいない、なので導出でしか埋まらない）。
   *   ※ effect で setState すると cascading render になるので、導出で持つ。
   */
  const [shopModeChoice, setShopMode] = useState<"stock" | "buy" | null>(null);
  const shopMode: "stock" | "buy" =
    shopModeChoice ?? (sync.hydrated && fridge.length === 0 ? "buy" : "stock");
  const [slots, setSlots] = useState<{ date: string; slot: MealSlot }[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [slotIndex, setSlotIndex] = useState(0);
  const [missing, setMissing] = useState<MissingChoice[]>([]);

  const [servings, setServings] = useState(2);
  const [wish, setWish] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResults, setAiResults] = useState<Recipe[]>([]);
  const [aiPreview, setAiPreview] = useState<Recipe | null>(null); // 候補の詳細プレビュー（未確定）
  const [aiSeen, setAiSeen] = useState<string[]>([]); // 既に提案済みの料理名（再探索で避ける）
  const [searchRound, setSearchRound] = useState(0); // 探索回数（角度を変える）
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredRef = useRef(false); // 復元が終わるまで保存/削除しない（初期timingでの誤削除防止）
  const [comment, setComment] = useState("");
  const [commentLoading, setCommentLoading] = useState(false);

  const priority = useMemo(
    () => sortByExpiry(fridge).filter((f) => bucketOf(f.expiresOn) === "priority"),
    [fridge],
  );

  // 登録済みの星評価（未評価は0）。
  // ★候補ランキングは全レシピぶんこれを引くので、毎回 find() で全走査させない。
  //   同じ recipeId が複数あったときは、従来の find() と同じく**先勝ち**。
  const starsMap = useMemo(() => starsMapOf(ratings), [ratings]);
  const starsOf = (rid: string) => starsMap.get(rid) ?? 0;

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
    const ratingOf = (rid: string) => starsMap.get(rid) ?? 0;
    return rankCandidates(
      recipes,
      fridge,
      pseudoRecent,
      filters,
      undefined,
      undefined,
      ratingOf,
    )
      .filter((r) => r.score > -500)
      // 「気分」の自由入力でも絞る（肉系/魚/さっぱり等のざっくりした言葉に対応）
      .filter((r) => matchesQuery(r.recipe, wish));
  }, [recipes, fridge, recent, picks, filters, starsMap, wish]);

  function toggleFilter<K extends keyof RecipeTags>(key: K, val: RecipeTags[K]) {
    setFilters((f) => ({ ...f, [key]: f[key] === val ? undefined : val }));
  }

  // 「気分」で何か指定しているか（クリアボタンの出し分け用）
  const hasDirection =
    !!filters.cuisine || !!filters.heaviness || !!filters.staple || !!filters.cookTime;

  function clearDirection() {
    setFilters({});
    setWish("");
  }

  function startPicking() {
    const s = slotsForTiming(timing);
    setSlots(s);
    setPicks([]);
    setSlotIndex(0);
    setAiResults([]);
    setAiPreview(null);
    setAiSeen([]);
    setSearchRound(0);
    setPhase("pick");
  }

  // 明示的に中断＝最初に戻る（これを押すまでAI候補は保持される）
  function cancelWizard() {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    try {
      localStorage.removeItem(JOB_KEY);
    } catch {
      /* noop */
    }
    setAiLoading(false);
    setAiError("");
    setAiResults([]);
    setAiPreview(null);
    setAiSeen([]);
    setSearchRound(0);
    setWish("");
    setPicks([]);
    setSlots([]);
    setSlotIndex(0);
    setPhase("timing"); // ← 保存スナップショットも消える（save effectがtimingで削除）
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

  // 在庫確認から一つ前（レシピ選び）に戻る。直前に選んだレシピは取り消す。
  function backToPick() {
    setPicks((prev) => prev.slice(0, -1));
    setSlotIndex(Math.max(0, slots.length - 1));
    setMissing([]);
    setPhase("pick");
  }

  function buildMissing(allPicks: Pick[]) {
    const fridgeNames = fridge.map((f) => f.name);
    const seen = new Set<string>();
    const choices: MissingChoice[] = [];
    for (const p of allPicks) {
      for (const ing of p.recipe.ingredients) {
        const key = ing.name;
        if (seen.has(key)) continue;
        seen.add(key);
        const inFridge = fridgeNames.some((n) => ingredientMatches(n, ing.name));
        // 全材料を表示（忘れ・在庫切れに気づけるように）。
        // 在庫ありは既定でチェックしない。在庫に無い買い足し品だけ既定チェック。
        choices.push({
          name: ing.name,
          amount: ing.amount,
          note: `${p.slot}の${p.recipe.name}用`,
          inFridge,
          selected: !inFridge && !!ing.toBuy,
        });
      }
    }
    // 在庫に無いもの（買う候補）を上に、在庫ありを下にまとめる
    choices.sort((a, b) => Number(a.inFridge) - Number(b.inFridge));
    setMissing(choices);
  }

  // 生のレシピJSON → Recipe[] に整形
  function mapRaw(raw: Record<string, unknown>[]): Recipe[] {
    return raw.map((r) => {
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
  }

  function clearJob() {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    try {
      localStorage.removeItem(JOB_KEY);
    } catch {
      /* noop */
    }
  }

  // ジョブを定期確認（アプリを離れている間もサーバーは処理を継続）
  //
  // ⚠️ 上限は必須。サーバー側の maxDuration(5分)を超えると after() が殺されて
  //    ジョブが status:"running" のまま残るので、上限が無いと Redis のTTL(30分)
  //    いっぱいまで3秒ごとに叩き続け、30分後にやっと失敗が出ることになる。
  //    3秒×120回＝約6分で打ち切る（再訪時は resume() が0から数え直す）。
  const MAX_POLLS = 120;

  async function pollJob(jobId: string, tries = 0) {
    if (tries >= MAX_POLLS) {
      clearJob();
      setAiLoading(false);
      setAiError("時間がかかりすぎています。もう一度「AIで探す」を押してください。");
      return;
    }
    try {
      const res = await fetch(`/api/research?jobId=${jobId}`);
      const data = await res.json();
      if (data.status === "done") {
        const mapped = mapRaw(Array.isArray(data.recipes) ? data.recipes : []);
        // 既に持っているレシピと同じ料理は捨てる（プロンプトで禁止しても稀に出るため二重の関門）
        const fresh = mapped.filter(
          (r) => !recipes.some((have) => isSameDish(have.name, r.name)),
        );
        clearJob();
        setAiLoading(false);
        // 出た料理名は採否に関わらず記録＝次回探索で必ず別案になる
        setAiSeen((prev) => [...prev, ...mapped.map((r) => r.name)]);
        if (mapped.length === 0) setAiError("レシピが取得できませんでした");
        else if (fresh.length === 0)
          setAiError(
            "見つかったのは既にレシピ一覧にある料理だけでした。もう一度「AIで探す」を押すと別の角度で探します。",
          );
        else setAiResults(fresh);
        return;
      }
      if (data.status === "error" || data.status === "missing") {
        clearJob();
        setAiLoading(false);
        setAiError(data.error || "レシピが取得できませんでした");
        return;
      }
      pollRef.current = setTimeout(() => pollJob(jobId, tries + 1), 3000);
    } catch {
      pollRef.current = setTimeout(() => pollJob(jobId, tries + 1), 4000);
    }
  }

  async function aiSearch() {
    if (aiLoading) return;
    // 事前チェックは「押す前に気づける」ための表示用。文言はサーバーの429と同じものを使う
    // （同じ枠切れなのに説明が変わると、どちらが本当か分からなくなるため）。
    if (!usage.canUse("research")) {
      setAiError(usage.limitMessage("research"));
      return;
    }
    setAiError("");
    setAiResults([]);
    setAiLoading(true);
    setGuide("done"); // 探索を始めたら初回ガイド完了
    usage.recordUse("research");
    const round = searchRound + 1;
    setSearchRound(round);
    // 完了通知の許可を確保（初回はダイアログ。アプリを離れても通知が届く）
    void enablePush();
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          u: getUid(),
          wish: wish.trim(),
          servings,
          round,
          shopMode,
          fridge: fridge.map((f) => f.name),
          expiring: priority.map((p) => p.name),
          filters,
          // 避ける対象＝「直近2日に作った」＋今回選んだ＋この探索で既に出た料理。
          // ※ recent はストア全件（何ヶ月も前を含む）なので、必ず直近2日に絞る。
          //   昔作ったものまで避けると、作れる料理がどんどん減ってしまう。
          avoid: [
            ...recentMeals(recent, 2).map((r) => r.recipeName),
            ...picks.map((p) => p.recipe.name),
            ...aiSeen,
          ],
          // 既に持っているレシピは提案させない（同じ料理の作り直しを防ぐ）
          existing: recipes.map((r) => r.name),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 429（枠切れ）は**サーバーの文言をそのまま**出す。
        // 断られた理由（本人の枠／回線／全体／予算）はサーバーしか知らないので、
        // こちらで文言を作ると「無料枠を使い切りました」等の嘘になることがある。
        const fail = readApiError(data, "開始に失敗しました");
        usage.syncFromServer("research", fail.quota); // 表示カウンタをサーバーの実態に合わせる
        throw new Error(fail.message);
      }
      if (!data.jobId) throw new Error("開始に失敗しました");
      // 共有プールから返ってきた回はAIを呼んでいない＝サーバーは枠を消費していない。
      // 先に数えた1回を戻さないと、メーターだけが減っていく。
      if (data.cached) usage.undoUse("research");
      try {
        localStorage.setItem(JOB_KEY, data.jobId);
      } catch {
        /* noop */
      }
      pollJob(data.jobId);
    } catch (e) {
      setAiLoading(false);
      setAiError(e instanceof Error ? e.message : "AI検索に失敗しました");
    }
  }

  // 復帰時：①保存したウィザード状態を復元（通知から開く/他タブ往復でも3案を保持）
  //         ②未完了ジョブがあればポーリング再開（離脱→再訪でも結果を受け取れる）
  useEffect(() => {
    // ①状態スナップショットの復元（マウント時に一度だけ）
    const restoreSnapshot = () => {
      let raw = "";
      try {
        raw = localStorage.getItem(STATE_KEY) || "";
      } catch {
        /* noop */
      }
      if (!raw) return;
      try {
        const s = JSON.parse(raw);
        if (s.phase) setPhase(s.phase);
        if (s.timing) setTiming(s.timing);
        if (s.filters) setFilters(s.filters);
        if (s.shopMode) setShopMode(s.shopMode);
        if (Array.isArray(s.slots)) setSlots(s.slots);
        if (Array.isArray(s.picks)) setPicks(s.picks);
        if (typeof s.slotIndex === "number") setSlotIndex(s.slotIndex);
        if (typeof s.servings === "number") setServings(s.servings);
        if (typeof s.wish === "string") setWish(s.wish);
        if (Array.isArray(s.aiResults)) setAiResults(s.aiResults);
        if (s.aiPreview) setAiPreview(s.aiPreview);
        if (Array.isArray(s.aiSeen)) setAiSeen(s.aiSeen);
        if (typeof s.searchRound === "number") setSearchRound(s.searchRound);
        if (Array.isArray(s.missing)) setMissing(s.missing);
        // 不足確認フェーズなのにリストが空（古いスナップショット等）→ picksから再構築
        if (
          s.phase === "missing" &&
          (!Array.isArray(s.missing) || s.missing.length === 0) &&
          Array.isArray(s.picks) &&
          s.picks.length > 0
        ) {
          buildMissing(s.picks);
        }
      } catch {
        /* 壊れていたら無視 */
      }
    };

    const resume = () => {
      if (pollRef.current) return;
      let p = "";
      try {
        p = localStorage.getItem(JOB_KEY) || "";
      } catch {
        /* noop */
      }
      if (p) {
        setAiLoading(true);
        pollJob(p);
      }
    };
    // 初回はマウント後（effect本体での同期setStateを避ける）
    const t = setTimeout(() => {
      restoreSnapshot();
      resume();
      restoredRef.current = true; // 以降のみ保存/削除を有効化
    }, 0);
    void ensurePushIfGranted();
    const onVis = () => {
      if (document.visibilityState === "visible") resume();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ウィザード状態を保存（pick等の途中だけ。timing/doneでは消す＝古い候補を残さない）
  useEffect(() => {
    if (!restoredRef.current) return; // 復元前は触らない（マウント直後の誤削除を防ぐ）
    try {
      if (phase === "timing" || phase === "done") {
        localStorage.removeItem(STATE_KEY);
      } else {
        localStorage.setItem(
          STATE_KEY,
          JSON.stringify({
            phase,
            timing,
            filters,
            shopMode,
            slots,
            picks,
            slotIndex,
            servings,
            wish,
            aiResults,
            aiPreview,
            aiSeen,
            searchRound,
            missing,
          }),
        );
      }
    } catch {
      /* noop */
    }
  }, [
    phase,
    timing,
    filters,
    shopMode,
    slots,
    picks,
    slotIndex,
    servings,
    wish,
    aiResults,
    aiPreview,
    aiSeen,
    searchRound,
    missing,
  ]);

  // 「このレシピを作る」確定：レシピリストへ追加して次へ
  // （写真のAI生成は廃止。生成に30〜90秒かかり動作が重くなるうえ、
  //   写真のあるレシピと無いレシピで見た目がバラついていたため）
  function pickAiRecipe(recipe: Recipe) {
    setStoredRecipes((prev) => [recipe, ...prev]);
    setAiResults([]);
    setAiPreview(null);
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
        .map((m) => {
          // レシピの使用量（ミニトマト5個・小ねぎ少々）ではなく、店で買える単位にする
          const b = toBuyableFor(m.name, m.amount);
          return {
            id: crypto.randomUUID(),
            name: m.name,
            amount: b.amount,
            note: b.hint ? `${m.note}／${b.hint}` : m.note,
            checked: false,
            addedAt: Date.now(),
          };
        });
      return [...existing, ...toAdd];
    });

    // 2) 食事計画を記録（連日回避の根拠に）。これは「計画」であって「作った」ではない
    //    （made:false）。作った回数は🍳作ったボタンを押したときだけ増える。
    const newMeals: MealEntry[] = picks.map((p) => ({
      id: crypto.randomUUID(),
      date: p.date,
      slot: p.slot,
      recipeId: p.recipe.id,
      recipeName: p.recipe.name,
      made: false,
    }));
    setRecent((meals) => [...meals, ...newMeals]);

    setPhase("done");
  }

  async function getComment() {
    if (commentLoading) return;
    setCommentLoading(true);
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menu: picks.map((p) => ({ slot: p.slot, name: p.recipe.name })),
          fridge: fridge.map((f) => f.name),
          expiring: priority.map((p) => p.name),
          recent: recent.map((r) => r.recipeName),
        }),
      });
      const data = await res.json();
      setComment(res.ok && data.text ? data.text : "コメント取得に失敗しました");
    } catch {
      setComment("コメント取得に失敗しました");
    } finally {
      setCommentLoading(false);
    }
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
      "PRODID:-//CookSync//meal//JP",
      "BEGIN:VEVENT",
      `UID:${crypto.randomUUID()}@cooksync`,
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
      <PageHeader title="献立を決める" Icon={ChefHat} iconClass="text-accent" />

      {guide === "meal" && (
        <div className="mb-5 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3.5">
          <p className="text-sm font-semibold leading-relaxed text-accent-dark">
            {/* アプリ版もAPNsで通知が届くようになったので、案内はWeb版と同じ文言でよい */}
            最後のステップ！条件はお好みでOK。下の「AIでレシピを探す」を押してみましょう（3〜4分かかります。完了したら通知でお知らせします）。
          </p>
        </div>
      )}

      {/* 優先消費バナー */}
      {priority.length > 0 && phase !== "done" && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50/70 p-3">
          <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-bold text-red-700">
            <Flame size={15} strokeWidth={2.4} />
            今日の優先消費食材
          </p>
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
          {/*
            在庫ゼロで来た人を行き止まりにしない。
            「食材を登録してください」で止めるのではなく、買い物前提でそのまま進めると伝える。
          */}
          {sync.hydrated && fridge.length === 0 && (
            <EmptyState content={EMPTY_STATES.meal} className="mb-5" />
          )}
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
          <h2 className="text-base font-bold text-ink">今日の気分は？</h2>
          <p className="mt-0.5 mb-3 text-xs text-ink-soft">
            どれも任意です。選ばなければ「おまかせ」で提案します。
          </p>

          {/* 自由入力：チップに無い気分もここで指定できる（下の候補がすぐ絞られる） */}
          <div className="relative">
            <Search
              size={16}
              strokeWidth={1.8}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
            />
            <input
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              placeholder="肉系 / 魚 / さっぱり / 鶏むね / パスタ…"
              className="w-full rounded-full border border-line bg-surface py-2.5 pr-9 pl-9 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft"
            />
            {wish && (
              <button
                type="button"
                onClick={() => setWish("")}
                aria-label="入力をクリア"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1.5 text-ink-soft transition hover:bg-paper"
              >
                <X size={14} strokeWidth={2} />
              </button>
            )}
          </div>
          <p className="mt-1.5 mb-4 px-1 text-xs leading-relaxed text-ink-soft">
            「肉系」「魚」「さっぱり」などざっくりした言葉でOK（スペース区切りで重ねがけ）。
            ここに書いた言葉は、AIでレシピを探すときの条件にもそのまま使われます。
          </p>

          {/* 条件はカードにまとめ、1グループ1行＋ラベルで何を選んでいるか分かるようにする */}
          <div className="rounded-2xl border border-line bg-surface p-4">
            <DirectionField label="ジャンル">
              {CUISINES.map((c) => (
                <button key={c} className={chip(filters.cuisine === c)} onClick={() => toggleFilter("cuisine", c)}>
                  {c}
                </button>
              ))}
            </DirectionField>
            <DirectionField label="味の重さ">
              {HEAVINESS.map((h) => (
                <button key={h} className={chip(filters.heaviness === h)} onClick={() => toggleFilter("heaviness", h)}>
                  {h}
                </button>
              ))}
            </DirectionField>
            <DirectionField label="主食">
              {STAPLES.map((s) => (
                <button key={s} className={chip(filters.staple === s)} onClick={() => toggleFilter("staple", s)}>
                  {s}系
                </button>
              ))}
            </DirectionField>
            <DirectionField label="調理時間">
              {TIMES.map((t) => (
                <button key={t.v} className={chip(filters.cookTime === t.v)} onClick={() => toggleFilter("cookTime", t.v)}>
                  {t.label}
                </button>
              ))}
            </DirectionField>
            <DirectionField label="何人分">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} onClick={() => setServings(n)} className={chip(servings === n)}>
                  {n}人分
                </button>
              ))}
            </DirectionField>
            <DirectionField
              label="買い物"
              hint={
                shopMode === "stock"
                  ? "冷蔵庫にある食材だけで作れる献立を提案します（基本調味料は除く）。"
                  : "在庫に縛られず提案。期限が近い食材を1つだけ活かして、残りは買い足す案も出します。"
              }
              last
            >
              <button
                type="button"
                onClick={() => setShopMode("stock")}
                className={chip(shopMode === "stock")}
              >
                <Refrigerator size={13} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
                在庫だけで作る
              </button>
              <button
                type="button"
                onClick={() => setShopMode("buy")}
                className={chip(shopMode === "buy")}
              >
                <ShoppingCart size={13} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
                買い物してもOK
              </button>
            </DirectionField>
          </div>

          {/* いま何件あるか＝条件を絞りすぎていないかがその場で分かる */}
          <p className="mt-3 text-center text-xs text-ink-soft">
            {ranked.length > 0 ? (
              <>条件に合うレシピ <strong className="text-brand-dark">{ranked.length}件</strong></>
            ) : (
              <span className="text-accent-dark">
                条件に合うレシピがありません。条件を減らすか、AIに探してもらいましょう。
              </span>
            )}
            {(hasDirection || wish) && (
              <button
                type="button"
                onClick={clearDirection}
                className="ml-2 font-medium text-accent-dark underline"
              >
                条件をクリア
              </button>
            )}
          </p>

          <div className="mt-3 flex gap-2">
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
          <button
            type="button"
            onClick={cancelWizard}
            className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-soft transition hover:text-brand"
          >
            ← やめる（最初に戻る）
          </button>
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
              <Search size={13} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
              食べたい物を入力すると、AIがWebから人気レシピを探して不足食材も計算します。
            </p>
            <div className="flex gap-2">
              <input
                value={wish}
                onChange={(e) => setWish(e.target.value)}
                disabled={aiLoading}
                placeholder="例：油淋鶏 / さっぱり和食"
                className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft disabled:opacity-60"
              />
              <button
                onClick={aiSearch}
                disabled={aiLoading}
                className="shrink-0 whitespace-nowrap rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-95 disabled:bg-line disabled:text-ink-soft"
              >
                {aiLoading
                  ? "探索中…"
                  : aiResults.length > 0
                    ? "別の角度で再探索"
                    : "AIで探す"}
              </button>
            </div>

            {/* どんな条件で探すかを明記（未選択は「おまかせ」） */}
            <div className="mt-2 rounded-xl border border-line/60 bg-surface/70 px-3 py-2 text-xs leading-relaxed text-ink-soft">
              <p className="mb-0.5 font-semibold text-brand-dark">
                この条件で探します（未選択は「おまかせ」）
              </p>
              <p>
                <UtensilsCrossed size={12} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
                作りたいもの：
                <span className="text-ink">{wish.trim() || "おまかせ"}</span>
              </p>
              <p>
                <Palette size={12} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
                方向性：
                <span className="text-ink">
                  {[
                    filters.cuisine,
                    filters.heaviness,
                    filters.staple,
                    filters.cookTime ? `${filters.cookTime}分以内` : null,
                  ]
                    .filter(Boolean)
                    .join("・") || "おまかせ"}
                </span>
              </p>
              <p>
                <Users size={12} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
                人数：<span className="text-ink">{servings}人分</span>
              </p>
              <p>
                <ShoppingCart size={12} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
                買い物：
                <span className="text-ink">
                  {shopMode === "stock"
                    ? "在庫だけで作る"
                    : "買い物OK（在庫に縛られない）"}
                </span>
              </p>
              <p>
                <Flame size={12} strokeWidth={2} className="mr-1 inline-block align-[-0.15em] text-red-600" />
                使い切りたい食材：
                <span className="text-ink">
                  {priority.length
                    ? priority.map((p) => p.name).join("・")
                    : "なし"}
                </span>
              </p>
              {searchRound > 0 && (
                <p className="text-brand-dark">
                  <RefreshCw size={12} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
                  次は{searchRound + 1}回目：前回と違うジャンル・角度で探します
                </p>
              )}
            </div>

            {aiLoading && (
              <p className="mt-2 animate-pulse text-xs text-brand-dark">
                AIがレシピをWeb検索中…（最大1〜2分）。アプリを閉じても裏で続きます。戻ると結果が出ます。
              </p>
            )}
            {aiError && <p className="mt-2 text-xs text-red-600">{aiError}</p>}
          </div>

          {/* AI候補の詳細プレビュー（タップで表示・まだ確定しない） */}
          {aiPreview && (
            <div className="mb-5 rounded-2xl border border-brand/40 bg-surface p-4 shadow-sm">
              <button
                onClick={() => setAiPreview(null)}
                className="mb-2 text-xs font-medium text-ink-soft transition hover:text-brand"
              >
                ← 候補一覧に戻る
              </button>
              <h3 className="flex items-center gap-2.5 text-lg font-bold text-ink">
                <DishIcon
                  name={aiPreview.name}
                  staple={aiPreview.tags.staple}
                  cuisine={aiPreview.tags.cuisine}
                  size={26}
                />
                {aiPreview.name}
              </h3>
              <p className="mt-1 text-xs font-medium text-brand-dark">
                {aiPreview.tags.cookTime ? `${aiPreview.tags.cookTime}分` : ""}
                {aiPreview.kcal ? ` / ${aiPreview.kcal}kcal` : ""}
                {`　${aiPreview.servings}人分`}
              </p>
              <p className="mt-2 rounded-xl bg-brand-soft/60 px-3 py-2 text-xs text-brand-dark">
                {aiPreview.catch}
              </p>

              <p className="mt-3 mb-1 text-xs font-bold text-ink">材料</p>
              <ul className="flex flex-col gap-0.5">
                {/*
                  key は「行の中身」から作る。index だと、AIが候補を出し直したときに
                  React が「同じ行が中身だけ変わった」とみなして差分更新するので、
                  別のレシピの材料が混ざって見えることがある。
                */}
                {aiPreview.ingredients.map((i, idx) => (
                  <li key={`${i.name}-${i.amount}-${idx}`} className="flex justify-between text-xs">
                    <span className="text-ink">{i.name}</span>
                    <span className="text-ink-soft">{i.amount}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-3 mb-1 text-xs font-bold text-ink">作り方</p>
              <ol className="flex flex-col gap-1.5">
                {aiPreview.steps.map((s, idx) => (
                  <li key={`${s.title}-${idx}`} className="text-xs leading-relaxed text-ink">
                    <span className="font-semibold">{idx + 1}. {s.title}</span>
                    <br />
                    {s.text}
                    {s.tip && (
                      <span className="mt-0.5 block text-xs italic text-amber-700">
                        <Lightbulb size={12} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
                        {s.tip}
                      </span>
                    )}
                  </li>
                ))}
              </ol>

              {aiPreview.sources[0] && (
                <p className="mt-3 text-xs text-ink-soft">
                  参考：
                  {aiPreview.sources[0].url ? (
                    <a
                      href={aiPreview.sources[0].url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand underline"
                    >
                      {aiPreview.sources[0].label}
                    </a>
                  ) : (
                    aiPreview.sources[0].label
                  )}
                  {aiPreview.sources[0].popularity
                    ? `・${aiPreview.sources[0].popularity}`
                    : ""}
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setAiPreview(null)}
                  className="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-soft transition hover:bg-paper"
                >
                  ← 戻る
                </button>
                <button
                  onClick={() => pickAiRecipe(aiPreview)}
                  className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-95"
                >
                  このレシピを作る
                </button>
              </div>
            </div>
          )}

          {aiResults.length > 0 && !aiPreview && (
            <div className="mb-5">
              <p className="mb-2 text-xs font-semibold text-brand-dark">
                <Sparkles size={13} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
                AIの提案（タップで詳細を見る・{servings}人分）
              </p>
              <ul className="flex flex-col gap-3">
                {aiResults.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setAiPreview(r)}
                      className="flex w-full items-start gap-3 rounded-2xl border border-brand/40 bg-surface p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <DishIcon
                        name={r.name}
                        staple={r.tags.staple}
                        cuisine={r.tags.cuisine}
                        size={28}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">{r.name}</p>
                        <p className="mt-0.5 text-xs text-ink-soft">{r.catch}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {r.sources[0] && (
                            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-dark">
                              {r.sources[0].label}
                              {r.sources[0].popularity ? `・${r.sources[0].popularity}` : ""}
                            </span>
                          )}
                          {r.tags.cookTime && (
                            <span className="rounded-full bg-paper px-2 py-0.5 text-xs text-ink-soft">
                              <Clock size={11} strokeWidth={2} className="mr-0.5 inline-block align-[-0.15em]" />
                              {r.tags.cookTime}分
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-brand-dark">
                          タップで詳細 →
                        </p>
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
                  <DishIcon
                    name={r.recipe.name}
                    staple={r.recipe.tags.staple}
                    cuisine={r.recipe.tags.cuisine}
                    size={28}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{r.recipe.name}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">{r.recipe.catch}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.recipe.sources[0] && (
                        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-dark">
                          {r.recipe.sources[0].label}
                          {r.recipe.sources[0].popularity ? `・${r.recipe.sources[0].popularity}` : ""}
                        </span>
                      )}
                      {r.usesExpiring.length > 0 && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          期限間近を{r.usesExpiring.length}品消費
                        </span>
                      )}
                      {r.missingNames.length <= 1 && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          買い足しほぼ無し
                        </span>
                      )}
                    </div>
                    {starsOf(r.recipe.id) > 0 && (
                      <div className="mt-1.5">
                        <StarRating value={starsOf(r.recipe.id)} size={14} />
                      </div>
                    )}
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
            レシピの全材料です。<b>家に無いものだけチェック</b>すると買い物リストに追加します。「在庫あり」は確認用なのでチェック不要（切らしていたらチェック）。
          </p>
          {missing.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-ink-soft">
              材料はありません。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {missing.map((m, idx) => (
                <li key={m.name}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2.5 ${
                      m.inFridge ? "bg-paper" : "bg-surface"
                    }`}
                  >
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
                      {m.inFridge && (
                        <span className="ml-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-medium text-brand-dark">
                          在庫あり
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-ink-soft/70">{m.note}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex gap-2">
            <button
              onClick={backToPick}
              className="flex-1 rounded-xl border border-line px-4 py-3 text-sm font-medium text-ink-soft transition hover:bg-paper"
            >
              ← 戻る（レシピを選び直す）
            </button>
            <button
              onClick={finalize}
              className="flex-1 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99]"
            >
              この内容で確定する
            </button>
          </div>
        </section>
      )}

      {/* 完了 */}
      {phase === "done" && (
        <section className="animate-pop-in">
          <div className="rounded-2xl border border-brand/30 bg-brand-soft/60 p-4">
            <h2 className="mb-2 inline-flex items-center gap-1.5 text-base font-bold text-brand-dark">
              <CircleCheck size={18} strokeWidth={2} />
              献立が決まりました
            </h2>
            <ul className="flex flex-col gap-1 text-sm text-ink">
              {/* 献立は「日付＋昼夜」で1枠に1つ。index より枠そのものを key にする方が正確 */}
              {picks.map((p) => (
                <li key={`${p.date}-${p.slot}`}>
                  <span className="font-semibold">
                    {p.date === todayISO() ? "今日" : "翌日"}の{p.slot}
                  </span>
                  ：
                  <DishIcon
                    name={p.recipe.name}
                    staple={p.recipe.tags.staple}
                    size={16}
                    tile={false}
                    className="mx-0.5 inline-block align-[-0.2em]"
                  />
                  {p.recipe.name}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-3">
            {comment ? (
              <div className="rounded-2xl border border-brand/20 bg-gradient-to-br from-brand-soft to-emerald-50 p-4 text-sm leading-relaxed text-ink">
                <p className="mb-1 inline-flex items-center gap-1 text-xs font-bold text-brand-dark">
                  <Sparkles size={12} strokeWidth={2} />
                  AIから
                </p>
                {comment}
              </div>
            ) : (
              <button
                onClick={getComment}
                disabled={commentLoading}
                className="w-full rounded-xl border border-brand/30 bg-surface py-2.5 text-sm font-semibold text-brand-dark transition hover:border-brand disabled:opacity-60"
              >
                <span className="inline-flex items-center justify-center gap-1.5">
                  <Sparkles size={15} strokeWidth={2} />
                  {commentLoading
                    ? "AIがコメントを書いています…（15〜30秒）"
                    : "AIにひとこともらう"}
                </span>
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <a
              href="/shopping"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-4 py-3 text-center text-sm font-semibold text-ink transition hover:border-brand"
            >
              <ShoppingCart className="h-4 w-4" strokeWidth={1.75} />
              買い物リストを見る
            </a>
            <button
              onClick={downloadIcs}
              className="rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink transition hover:border-brand"
            >
              <CalendarPlus size={14} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
              買い物リマインダー(.ics)
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {picks.map((p) => (
              <a
                key={`${p.date}-${p.slot}`}
                href={`/recipes/${p.recipe.id}`}
                className="rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-brand-dark ring-1 ring-line transition hover:ring-brand"
              >
                <DishIcon
                  name={p.recipe.name}
                  staple={p.recipe.tags.staple}
                  size={15}
                  tile={false}
                  className="mr-1 inline-block align-[-0.2em]"
                />
                {p.recipe.name} の作り方 →
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

/** 「気分」画面の1グループ（ラベル＋チップ列）。何を選んでいるか一目で分かるようにする */
function DirectionField({
  label,
  hint,
  last,
  children,
}: {
  label: string;
  hint?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={last ? "" : "mb-3.5 border-b border-line/70 pb-3.5"}>
      <p className="mb-1.5 text-xs font-semibold text-ink-soft">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
      {hint && (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{hint}</p>
      )}
    </div>
  );
}
