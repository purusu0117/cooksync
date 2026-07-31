"use client";

import { useState } from "react";
import { Bot, ChevronDown, ChevronUp } from "lucide-react";
import {
  CATEGORIES,
  estimateExpiry,
  type Category,
  type FridgeItem,
  todayISO,
  zoneForCategory,
} from "@/lib/food";
import { guessItem } from "@/lib/guess";
import { estimateExpiryDays } from "@/lib/expiryAI";
import { packOf, quantitySuggestions } from "@/lib/packaging";

interface Props {
  onAdd: (item: FridgeItem) => void;
}

// タップ領域 44px（iPhoneの下限）を全部の欄で確保する
const fieldClass =
  "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft";

/**
 * 食材の追加フォーム。
 *
 * ★ 既定は「食材名だけ」。（2026-08-01）
 *   以前は 食材名／数量／カテゴリ／購入日／期限／開封済み の**6項目**が最初から開いていた。
 *   カテゴリと期限は guess.ts が食材名から推定できるのに、それでも6つ並べていたので、
 *   初見の人には「1品入れるのに6回入力する作業」に見えていた（＝離脱の主因）。
 *   詳しく決めたい人は「数量・カテゴリ・期限も決める」で従来どおりの画面を開ける。
 *
 *   簡易入力ではAI（/api/estimate-expiry）を呼ばない。押した瞬間に入るのが価値なので、
 *   辞書に無い食材の期限精度は ExpiryReviewPanel（「期限を見直す」）に任せる。
 */
export default function AddItemForm({ onAdd }: Props) {
  // 詳細欄（数量・カテゴリ・購入日・期限・開封済み）を開いているか
  const [detail, setDetail] = useState(false);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [category, setCategory] = useState<Category>("野菜");
  const [purchasedOn, setPurchasedOn] = useState(todayISO());
  const [expiresOn, setExpiresOn] = useState("");
  const [opened, setOpened] = useState(false); // 開封済み＝期限は開封後の目安で計算
  // 自動推定を手入力で上書きしたかどうか
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [autofilled, setAutofilled] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNote, setAiNote] = useState(""); // AIが推定したときの根拠メモ

  const trimmed = name.trim();
  const pack = trimmed ? packOf(trimmed) : null;
  const qtyChips = trimmed ? quantitySuggestions(trimmed) : [];

  // 食材名が確定したら、カテゴリと期限を推定して未編集の欄に流し込む
  function autofillFromName(nextOpened = opened) {
    const n = name.trim();
    if (!n) return;
    const g = guessItem(n, purchasedOn, nextOpened);
    let did = false;
    if (!categoryTouched) {
      setCategory(g.category);
      did = true;
    }
    if (!expiryTouched) {
      setExpiresOn(g.expiresOn);
      did = true;
    }
    setAutofilled(did);
    setAiNote("");
    // 辞書に無い食材は AI に日持ちを聞いて精度を上げる（失敗しても上の推定のまま動く）
    if (g.needsAI) void refineWithAI(n, nextOpened);
  }

  async function refineWithAI(n: string, nextOpened: boolean) {
    setAiLoading(true);
    try {
      const res = await estimateExpiryDays([{ name: n, opened: nextOpened }]);
      const est = res[n];
      if (est && !expiryTouched && name.trim() === n) {
        setExpiresOn(estimateExpiry(purchasedOn, est.days));
        setAiNote(
          `AI推定：${est.days}日${est.storage ? `・${est.storage}` : ""}${est.note ? `（${est.note}）` : ""}`,
        );
      }
    } finally {
      setAiLoading(false);
    }
  }

  function toggleOpened(next: boolean) {
    setOpened(next);
    if (!expiryTouched && name.trim()) {
      const g = guessItem(name.trim(), purchasedOn, next);
      setExpiresOn(g.expiresOn);
      if (g.needsAI) void refineWithAI(name.trim(), next);
    }
  }

  function add() {
    const finalName = name.trim();
    if (!finalName) return;
    // 期限が空なら推定で補完
    const finalExpiry =
      expiresOn || guessItem(finalName, purchasedOn, opened).expiresOn;

    onAdd({
      id: crypto.randomUUID(),
      name: finalName,
      // 簡易入力（数量欄を出していない）ときは、店で売っている単位を既定にする。
      // 「1パック」と入っていれば後から量を直しやすい（空欄だと何を買ったか思い出せない）。
      quantity: quantity.trim() || (!detail && pack ? `1${pack.unit}` : ""),
      category,
      zone: zoneForCategory(category),
      purchasedOn,
      expiresOn: finalExpiry,
      openedOn: opened ? purchasedOn : undefined,
      createdAt: Date.now(),
    });

    setName("");
    setQuantity("");
    setExpiresOn("");
    setOpened(false);
    setCategoryTouched(false);
    setExpiryTouched(false);
    setAutofilled(false);
    setAiNote("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      className="rounded-3xl border border-line bg-surface p-4 shadow-sm"
    >
      <p className="mb-3 text-xs text-ink-soft">
        <Bot size={13} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
        {detail
          ? "食材名を入れると、カテゴリと賞味期限を自動推定します（知らない食材はAIが日持ちを調べます。下の欄でいつでも直せます）。"
          : "食材名だけでOK。カテゴリと賞味期限は自動で入ります（あとから直せます）。"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink-soft">食材名</span>
          <input
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            // 詳細欄を開いているときだけ推定を流し込む（簡易入力では add() が同じ推定で埋める）
            onBlur={() => {
              if (detail) autofillFromName();
            }}
            placeholder="例：鶏もも肉"
            required
          />
        </label>

        {detail && (
        <>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink-soft">数量</span>
          <input
            className={fieldClass}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="例：1パック / 2本 / 約150g"
          />
          {/* 箱・パック売りで「中身が何個か分からない」食材は、売っている単位で入れられるようにする */}
          {qtyChips.length > 0 && (
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              {qtyChips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setQuantity(c)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    quantity === c
                      ? "border-brand bg-brand text-white"
                      : "border-line bg-paper text-ink-soft hover:border-brand hover:text-brand-dark"
                  }`}
                >
                  {c}
                </button>
              ))}
            </span>
          )}
          {pack?.hint && (
            <span className="mt-1 block text-xs text-ink-soft">
              目安：{pack.hint}（個数が分からなければ「1{pack.unit}」でOK）
            </span>
          )}
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-ink-soft">
            カテゴリ{!categoryTouched && autofilled && <span className="ml-1 text-brand">（自動）</span>}
          </span>
          <select
            className={fieldClass}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as Category);
              setCategoryTouched(true);
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium text-ink-soft">購入日</span>
          <input
            type="date"
            className={`${fieldClass} min-w-0 appearance-none`}
            value={purchasedOn}
            onChange={(e) => setPurchasedOn(e.target.value)}
          />
        </label>

        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink-soft">
            賞味・消費期限
            {!expiryTouched && autofilled && <span className="ml-1 text-brand">（自動）</span>}
            {aiLoading && <span className="ml-1 text-brand-dark">AIが確認中…</span>}
          </span>
          <input
            type="date"
            className={`${fieldClass} min-w-0 appearance-none`}
            value={expiresOn}
            onChange={(e) => {
              setExpiresOn(e.target.value);
              setExpiryTouched(true);
            }}
          />
          {aiNote && !expiryTouched && (
            <span className="mt-1 block text-xs text-brand-dark">
              <Bot size={12} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
              {aiNote}
            </span>
          )}
        </label>
        </>
        )}
      </div>

      {/* 開封済みかどうかで期限は大きく変わる（未開封のしょうゆ=1年半 / 開封後=1ヶ月） */}
      {/* ラベルごと44px以上にしてタップ領域を確保する。
          チェックボックス自体は16pxしかなく、料理中の指では押しにくかった
          （2026-08-01 の巡回監査で最小のタップ領域として検出）。 */}
      {detail && (
        <label className="mt-3 -mx-1 flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl px-1 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={opened}
            onChange={(e) => toggleOpened(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-brand)]"
          />
          開封済み（開封後の日持ちで期限を計算）
        </label>
      )}

      <button
        type="button"
        onClick={add}
        className="mt-4 min-h-[44px] w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft"
        disabled={!name.trim()}
      >
        ＋ 冷蔵庫に追加
      </button>

      {/* 詳しく決めたい人のための入口。畳んでおくことが目的なので、押せば従来の画面に戻る */}
      <button
        type="button"
        onClick={() => {
          // 開くときは、入力済みの食材名から推定を流し込んでおく（空欄のまま開かせない）
          if (!detail) autofillFromName();
          setDetail((v) => !v);
        }}
        className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-1 rounded-xl text-xs font-medium text-ink-soft transition hover:text-brand-dark"
      >
        {detail ? (
          <>
            <ChevronUp size={14} strokeWidth={2} />
            食材名だけに戻す
          </>
        ) : (
          <>
            <ChevronDown size={14} strokeWidth={2} />
            数量・カテゴリ・期限も決める
          </>
        )}
      </button>
    </form>
  );
}
