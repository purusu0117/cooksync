"use client";

// 初回の一等地。**「冷蔵庫を全部登録してください」と言わない画面。**
//
// 何を直したか（2026-08-01）:
//   以前この位置には「まだ食材がありません」＋6項目の入力フォーム（食材名／数量／カテゴリ／
//   購入日／期限／開封済み）が出ていた。初見の人はここで「作業だ」と分かって離脱する。
//   競合の★2レビューがそのまま同じことを言っている：
//     「もともと家にある食材も登録しようとするとかなりの時間がかかる」
//     「材料をいちいち入力するのは面倒。レシートから読み取る機能があれば課金してでも使いたい」
//
//   なので初回の到達点を「登録が終わった」ではなく **「最初の献立が出た」** に置き換え、
//   そこまでの距離（あと何個）を常に見せる。入力経路は軽い順に並べる：
//     ① 写真1枚（AIが読む・実装済みの /api/scan-fridge）
//     ② よく買うものをタップ（AIを一切呼ばない＝0円・0秒）
//     ③ 食材名だけ1行入力
//     ④ 数量・期限まで自分で決める（＝従来の6項目フォーム。ここまで降ろす）
//
// 文言（Preferences/copywriting-audience.md）:
//   初見の人が読む場所なので「今日なに作るか決まらない」という**既に持っている悩み**の言葉で書く。
//   否定形・競合比較はここには置かない。

import { useState } from "react";
import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import type { FridgeItem } from "@/lib/food";
import { getGuide, setGuide } from "@/lib/guide";
import {
  SUGGEST_THRESHOLD,
  quickItem,
  remainingToSuggest,
  starterSuggestions,
} from "@/lib/starter";
import PhotoAddForm from "./PhotoAddForm";

interface Props {
  /** いま冷蔵庫に入っている数 */
  count: number;
  /** 既に入っている食材名（同じものを候補に出さないため） */
  existingNames: string[];
  onAdd: (item: FridgeItem) => void;
  onAddMany: (items: FridgeItem[]) => void;
  /** 「数量や期限まで自分で決める」＝従来の6項目フォームを開く */
  onManual: () => void;
}

export default function QuickStart({
  count,
  existingNames,
  onAdd,
  onAddMany,
  onManual,
}: Props) {
  const [name, setName] = useState("");
  const left = remainingToSuggest(count);
  const chips = starterSuggestions(existingNames);

  // 初回ガイドがまだ始まっていなければ、ここでの追加を起点にする
  // （オンボーディングをスキップした人でも「次は献立」まで案内が続く）
  function markStarted() {
    if (!getGuide()) setGuide("fridge");
  }

  function addByName(raw: string) {
    const n = raw.trim();
    if (!n) return;
    markStarted();
    onAdd(quickItem(n));
  }

  return (
    <section id="cooksync-quickstart" className="mb-6">
      {/* ゴール宣言：登録の完了ではなく「今日の献立が出る」ことを到達点にする */}
      <div className="rounded-3xl border border-brand/30 bg-brand-soft px-4 py-4">
        <h2 className="text-base leading-snug font-bold text-brand-dark">
          今日なに作るか、ここで決まります
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          いま家にあるものを<strong className="text-brand-dark">3つ</strong>
          入れるだけ。冷蔵庫を全部そろえる必要はありません。
        </p>

        {/* ゴールまでの距離。●が埋まっていくので、あと何回タップすればいいかが一目で分かる */}
        <div className="mt-3 flex items-center gap-2.5">
          <span className="flex gap-1.5" aria-hidden>
            {Array.from({ length: SUGGEST_THRESHOLD }).map((_, i) => (
              <span
                key={i}
                className={`h-2.5 w-2.5 rounded-full ${
                  i < count ? "bg-brand" : "bg-brand/25"
                }`}
              />
            ))}
          </span>
          <p className="text-xs font-semibold text-brand-dark">
            {left > 0
              ? `あと${left}つで、今日の献立を出せます`
              : "そろいました。今日の献立を出せます"}
          </p>
        </div>

        {left === 0 && (
          <Link
            href="/meal"
            onClick={() => setGuide("meal")}
            className="mt-3 flex min-h-[44px] items-center justify-center rounded-full bg-brand px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
          >
            <Sparkles size={16} strokeWidth={2} className="mr-1.5" />
            今日の献立を出す
          </Link>
        )}
      </div>

      {/* ①写真：いちばん軽い入口を一等地に置く（手入力は下に降ろす） */}
      <div className="mt-3">
        <p className="mb-1.5 px-1 text-xs font-semibold text-ink-soft">
          冷蔵庫を開けて1枚撮るのがいちばん速いです
        </p>
        <PhotoAddForm
          onAddMany={(items) => {
            markStarted();
            onAddMany(items);
          }}
        />
      </div>

      {/* ②よく買うもの：タップで足せる。AIは呼ばないので無料枠を1回も減らさない */}
      {chips.length > 0 && (
        <div className="mt-3 rounded-3xl border border-line bg-surface p-4 shadow-sm">
          <p className="mb-2.5 text-xs font-semibold text-ink-soft">
            よく買うもの（タップで入ります）
          </p>
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => addByName(c)}
                className="flex min-h-[44px] items-center gap-1 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink transition hover:border-brand hover:text-brand-dark active:scale-95"
              >
                <Plus size={14} strokeWidth={2.4} className="text-brand" />
                {c}
              </button>
            ))}
          </div>

          {/* ③食材名だけの1行入力。初回に数量・カテゴリ・期限は聞かない（全部推定で埋める） */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addByName(name);
              setName("");
            }}
            className="mt-3.5 flex gap-2"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ほかにあるもの（例：鶏もも肉）"
              aria-label="食材名"
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft"
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="min-h-[44px] shrink-0 rounded-xl bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-95 disabled:bg-line disabled:text-ink-soft"
            >
              入れる
            </button>
          </form>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
            名前だけでOK。カテゴリと賞味期限は自動で入ります（あとから直せます）。
          </p>
        </div>
      )}

      {/* ④従来の6項目フォームはここまで降ろす */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onManual}
          className="flex min-h-[44px] items-center rounded-full border border-line bg-surface px-4 text-xs font-medium text-ink-soft transition hover:border-brand hover:text-brand-dark"
        >
          数量や期限まで自分で決める
        </button>
        {count > 0 && left > 0 && (
          <Link
            href="/meal"
            onClick={() => setGuide("meal")}
            className="flex min-h-[44px] items-center px-2 text-xs font-medium text-brand-dark underline"
          >
            今のまま献立を見る
          </Link>
        )}
      </div>
    </section>
  );
}
