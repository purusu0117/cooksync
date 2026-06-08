"use client";

import Link from "next/link";
import {
  Search,
  User,
  Carrot,
  Beef,
  Egg,
  Wheat,
  Soup,
  CupSoda,
  Apple,
  ChevronRight,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { bucketOf, type Category } from "@/lib/food";
import { fridgeStore, shoppingStore } from "@/lib/storage";
import { usePersistentList, useAllRecipes } from "@/lib/useStore";

const CATEGORY_ICON: Record<Category, LucideIcon> = {
  野菜: Carrot,
  "肉・魚": Beef,
  "乳製品・卵": Egg,
  主食: Wheat,
  調味料: Soup,
  飲料: CupSoda,
  その他: Apple,
};

const CUISINE_GRADIENT: Record<string, string> = {
  和: "from-emerald-100 to-lime-50",
  洋: "from-amber-100 to-orange-50",
  中: "from-rose-100 to-orange-50",
  アジアン: "from-orange-100 to-yellow-50",
};

export default function HomeDashboard() {
  const recipes = useAllRecipes();
  const [fridge] = usePersistentList(fridgeStore);
  const [shopping] = usePersistentList(shoppingStore);

  const recommended = recipes.slice(0, 6);
  const todo = shopping.filter((s) => !s.checked);
  const shortage = todo.slice(0, 4).map((s) => s.name);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5">
      {/* トップ：ロゴ＋アバター */}
      <div className="mb-5 flex items-center justify-between">
        <span className="wordmark flex items-center gap-1 text-2xl font-bold text-brand-dark">
          {APP_NAME}
          <Sparkles size={18} className="text-brand" />
        </span>
        <Link
          href="/mypage"
          aria-label="マイページ"
          className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-brand-dark"
        >
          <User size={18} />
        </Link>
      </div>

      {/* 検索バー → 献立ウィザード */}
      <Link
        href="/meal"
        className="mb-7 flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-3 text-sm text-ink-soft shadow-sm transition hover:border-brand"
      >
        <Search size={18} className="text-brand" />
        今日は何を作る？
      </Link>

      {/* おすすめレシピ */}
      <section className="mb-7">
        <SectionTitle title="おすすめレシピ" href="/recipes" />
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
          {recommended.map((r) => (
            <Link
              key={r.id}
              href={`/recipes/${r.id}`}
              className="w-44 shrink-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div
                className={`grid h-28 place-items-center bg-gradient-to-br text-5xl ${
                  CUISINE_GRADIENT[r.tags.cuisine ?? ""] ?? "from-brand-soft to-emerald-50"
                }`}
              >
                <span aria-hidden>{r.emoji}</span>
              </div>
              <div className="p-3">
                <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold text-ink">
                  {r.name}
                </p>
                {r.tags.cookTime && (
                  <span className="mt-1.5 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-dark">
                    ⏱ {r.tags.cookTime}分
                  </span>
                )}
              </div>
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
                  <span className="line-clamp-1 w-full text-center text-[11px] text-ink">
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
        <div className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4">
          <p className="flex-1 text-sm font-bold leading-relaxed text-accent-dark">
            {shortage.length > 0 ? (
              <>不足：{shortage.join("、")}</>
            ) : (
              <span className="font-medium text-ink-soft">
                不足はありません。献立を決めると自動で追加されます。
              </span>
            )}
          </p>
          <Link
            href="/shopping"
            className="shrink-0 rounded-full bg-brand px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-95"
          >
            買い物リスト
          </Link>
        </div>
      </section>

      {/* 余りものから作れるレシピ */}
      <Link
        href="/meal"
        className="mb-4 flex items-center gap-3 rounded-2xl border border-brand/20 bg-gradient-to-br from-brand-soft to-emerald-50 p-4 transition hover:shadow-md"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-surface text-2xl">
          🥗
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-brand-dark">余りものから作れるレシピ</p>
          <p className="text-xs leading-relaxed text-ink-soft">
            期限が近い食材を活かす献立を提案します。
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
