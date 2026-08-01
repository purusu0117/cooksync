"use client";

import { useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { Apple, Camera, ChevronRight, User } from "lucide-react";
import { bucketOf } from "@/lib/food";
import { starsMapOf } from "@/lib/ranking";
import { CATEGORY_ICON } from "@/components/categoryIcon";
import { fridgeStore, shoppingStore, ratingStore } from "@/lib/storage";
import { usePersistentList, useAllRecipes } from "@/lib/useStore";
import { useSyncState } from "@/lib/syncStore";
import { SUGGEST_THRESHOLD, remainingToSuggest } from "@/lib/starter";
import DishIcon from "@/components/DishIcon";
import RecipeSources from "@/components/home/RecipeSources";
import ResumeCooking from "@/components/home/ResumeCooking";
import TodayPlan from "@/components/home/TodayPlan";
import WeeklyRecap from "@/components/home/WeeklyRecap";
import EmptyState, { EMPTY_STATES } from "@/components/EmptyState";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

export default function HomeDashboard() {
  const recipes = useAllRecipes();
  const [fridge] = usePersistentList(fridgeStore);
  const [shopping] = usePersistentList(shoppingStore);
  const [ratings] = usePersistentList(ratingStore);
  const sync = useSyncState();

  /*
    ★おすすめは useMemo で固定する。
      以前は毎レンダーで「レシピ全件をコピー → 全件ソート、しかも比較関数の中から
      ratings.find() で全走査」していた。**表示に使うのは先頭6件だけ**なのに、
      冷蔵庫や買い物リストが1件変わってホームが再描画されるたび、
      レシピ200件ぶんのソートを丸ごとやり直していた。
      レシピと評価が変わっていないなら計算しない、が正しい。

      並びは従来どおり「星の高い順、同点は元の順」。Array#sort は安定ソートなので、
      同点の並びは recipes の順序のまま変わらない。
  */
  const recommended = useMemo(() => {
    const starsMap = starsMapOf(ratings);
    const starsOf = (id: string) => starsMap.get(id) ?? 0;
    return [...recipes].sort((a, b) => starsOf(b.id) - starsOf(a.id)).slice(0, 6);
  }, [recipes, ratings]);

  const shortage = useMemo(
    () =>
      shopping
        .filter((s) => !s.checked)
        .slice(0, 4)
        .map((s) => s.name),
    [shopping],
  );

  // 初回の一等地。冷蔵庫が3つ未満のあいだは「最初の1アクション」をいちばん上に置く。
  // ★ hydrated を必ず見る（読み込み前は fridge が空なので、既存ユーザーにも一瞬出てしまう）。
  const left = remainingToSuggest(fridge.length);
  const showFirstStep = sync.hydrated && left > 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5">
      {/* トップ：ロゴ＋アバター */}
      <div className="flex items-center justify-between">
        <Image
          src="/cooksync-logo.svg"
          alt={APP_NAME}
          width={160}
          height={91}
          priority
          className="-my-4 h-auto w-[150px]"
        />
        <Link
          href="/mypage"
          aria-label="マイページ"
          className="grid h-11 w-11 place-items-center rounded-full bg-brand-soft text-brand-dark"
        >
          <User size={18} />
        </Link>
      </div>
      {/*
        ここは**初見の人が最初に読む場所**。差別化（分量を勝手に変えない等）はここではなく
        LPの中ほど＝比較検討層が読む場所に置く（[[copywriting-audience]]）。
        「次に何をすればいいか」は直下の初回カードが担当するので、ここでは重ねない。
      */}
      <p className="mt-1 mb-5 text-xs text-ink-soft">{APP_TAGLINE}</p>

      {/*
        初回の一等地。ここに「レシピをつくる」を先に出すと、在庫ゼロの人は
        AI提案を押しても手応えのない結果に着地する。まず食材3つに連れて行く。
      */}
      {showFirstStep && (
        <Link
          href="/fridge"
          className="mb-7 flex items-center gap-3 rounded-2xl border border-brand/30 bg-brand-soft p-4 transition hover:shadow-md active:scale-[0.99]"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-surface">
            <Camera size={24} strokeWidth={1.9} className="text-brand" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-brand-dark">
              まず、いま家にあるものを{SUGGEST_THRESHOLD}つ
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">
              冷蔵庫を1枚撮るか、よく買うものをタップするだけ。
              {fridge.length > 0 && `あと${left}つで今日の献立を出せます。`}
            </span>
          </span>
          <ChevronRight size={20} className="shrink-0 text-brand" />
        </Link>
      )}

      {/*
        作りかけがあるときだけ、**一番上**に出す。
        途中で手を止めた人にとっては「今日ここで何をするか」がこれ以外に無いので、
        レシピを探す導線より先に置く。無い日は何も描かれない。
      */}
      <ResumeCooking />

      {/* 今日の献立（ウィザードで確定した計画。決めた日に戻る理由の一等地） */}
      <TodayPlan />

      {/* レシピをつくる（AI提案／動画／写真） */}
      <RecipeSources />

      {/* 今週の記録（作った記録がある人にだけ出る／AIを使わない） */}
      <WeeklyRecap />

      {/* おすすめレシピ */}
      <section className="mb-7">
        <SectionTitle title="おすすめレシピ" href="/recipes" />
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
          {recommended.map((r) => (
            // 写真もベタ塗りの大きな絵文字もやめ、専用イラストは小さく添えて
            // 「料理名」を主役にする（絵文字が大きいと何の料理か読み取りづらかった）
            <Link
              key={r.id}
              href={`/recipes/${r.id}`}
              className="flex w-40 shrink-0 flex-col rounded-2xl border border-line bg-surface p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
            >
              <span className="mb-2 flex items-start justify-between gap-2">
                <DishIcon
                  name={r.name}
                  staple={r.tags.staple}
                  cuisine={r.tags.cuisine}
                  size={30}
                />
                {r.tags.cookTime && (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-bold text-brand-dark">
                    {r.tags.cookTime}分
                  </span>
                )}
              </span>
              <span className="line-clamp-2 min-h-[2.5rem] text-sm leading-snug font-bold text-ink">
                {r.name}
              </span>
              <span className="mt-1 text-xs text-ink-soft">
                {r.kcal ? `${r.kcal}kcal` : ""}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* 冷蔵庫リスト */}
      <section className="mb-7">
        <SectionTitle title="冷蔵庫リスト" href="/fridge" />
        {fridge.length === 0 ? (
          <EmptyState content={EMPTY_STATES.homeFridge} />
        ) : (
          <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
            {fridge.slice(0, 12).map((item) => {
              const Icon = CATEGORY_ICON[item.category] ?? Apple;
              const priority = bucketOf(item.expiresOn) === "priority";
              return (
                <Link
                  key={item.id}
                  href="/fridge"
                  className={`flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-2xl border bg-surface px-2 py-3 shadow-sm ${
                    priority ? "border-red-300" : "border-line"
                  }`}
                >
                  <Icon size={26} strokeWidth={1.7} className="text-brand" />
                  <span className="line-clamp-1 w-full text-center text-xs text-ink">
                    {item.name}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* 買い物リスト（オレンジ） */}
      <section className="mb-7">
        <h2 className="mb-2.5 text-base font-bold text-brand-dark">買い物リスト</h2>
        {/*
          ★ 空のときは「不足はありません」＋「買い物リストに追加」ボタンだった。
            押しても空のリストに着くだけで、次に何をすればいいかが分からなかった。
            空なら次の1手（献立を決める）に送る。
        */}
        {shortage.length === 0 ? (
          <EmptyState content={EMPTY_STATES.homeShopping} />
        ) : (
          <div className="rounded-2xl border border-accent/30 bg-accent-soft p-4">
            <p className="text-sm font-bold leading-relaxed text-accent-dark">
              買うもの：{shortage.join("、")}
            </p>
            <Link
              href="/shopping"
              className="mt-3 flex min-h-[44px] items-center justify-center rounded-full bg-brand text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
            >
              買い物リストを開く
            </Link>
          </div>
        )}
      </section>

      {/* 余りものから作れるレシピ */}
      <Link
        href="/meal"
        className="mb-4 flex items-center gap-3 rounded-2xl border border-brand/20 bg-gradient-to-br from-brand-soft to-emerald-50 p-4 transition hover:shadow-md"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-surface">
          <DishIcon name="サラダ" size={30} tile={false} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-brand-dark">余りものから作れるレシピ</p>
          <p className="text-xs leading-relaxed text-ink-soft">
            買い足しなし。冷蔵庫にあるものと基本調味料だけで作れる献立を提案します。
          </p>
        </div>
        <ChevronRight size={20} className="shrink-0 text-brand" />
      </Link>
    </div>
  );
}

function SectionTitle({ title, href }: { title: string; href: string }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="text-base font-bold text-brand-dark">{title}</h2>
      {/* -my-2.5 で44pxのヒット領域ぶん見出し行が高くならないよう相殺 */}
      <Link
        href={href}
        className="-my-2.5 inline-flex min-h-[44px] items-center px-1 text-xs font-medium text-ink-soft transition hover:text-brand"
      >
        もっと見る
        <ChevronRight size={14} />
      </Link>
    </div>
  );
}
