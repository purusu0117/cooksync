"use client";

import Link from "next/link";
import Image from "next/image";
import { Apple, ChevronRight, User } from "lucide-react";
import { bucketOf } from "@/lib/food";
import { CATEGORY_ICON } from "@/components/categoryIcon";
import { fridgeStore, shoppingStore, ratingStore } from "@/lib/storage";
import { usePersistentList, useAllRecipes } from "@/lib/useStore";
import DishIcon from "@/components/DishIcon";
import RecipeSources from "@/components/home/RecipeSources";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

export default function HomeDashboard() {
  const recipes = useAllRecipes();
  const [fridge] = usePersistentList(fridgeStore);
  const [shopping] = usePersistentList(shoppingStore);
  const [ratings] = usePersistentList(ratingStore);

  const starsOf = (id: string) =>
    ratings.find((r) => r.recipeId === id)?.stars ?? 0;
  // 高評価を優先（同点は元の順）
  const recommended = [...recipes]
    .sort((a, b) => starsOf(b.id) - starsOf(a.id))
    .slice(0, 6);
  const todo = shopping.filter((s) => !s.checked);
  const shortage = todo.slice(0, 4).map((s) => s.name);

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
          className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-brand-dark"
        >
          <User size={18} />
        </Link>
      </div>
      {/* 初めて開いた人に「他と何が違うか」を1行で。ロゴだけだと伝わらない。 */}
      <p className="mt-1 mb-5 text-xs text-ink-soft">
        {APP_TAGLINE}読み取れなかった分量は、そう書きます。
      </p>

      {/* レシピをつくる（AI提案／動画／写真） */}
      <RecipeSources />

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
          <Link
            href="/fridge"
            className="flex items-center justify-center rounded-2xl border border-dashed border-line bg-surface/60 py-6 text-sm text-ink-soft"
          >
            冷蔵庫に食材を追加する →
          </Link>
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

      {/* 不足→買い物リストに追加（オレンジ） */}
      <section className="mb-7">
        <h2 className="mb-2.5 text-base font-bold text-brand-dark">買い物リストに追加</h2>
        <div className="rounded-2xl border border-accent/30 bg-accent-soft p-4">
          <p className="text-sm font-bold leading-relaxed text-accent-dark">
            {shortage.length > 0 ? (
              <>不足：{shortage.join("、")}</>
            ) : (
              <span className="font-medium text-ink-soft">
                不足はありません。献立を決めると、足りない分だけ店で買える単位で追加されます。
              </span>
            )}
          </p>
          <Link
            href="/shopping"
            className="mt-3 block rounded-full bg-brand py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
          >
            買い物リストに追加
          </Link>
        </div>
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
      <Link
        href={href}
        className="flex items-center text-xs font-medium text-ink-soft transition hover:text-brand"
      >
        もっと見る
        <ChevronRight size={14} />
      </Link>
    </div>
  );
}
