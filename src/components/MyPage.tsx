"use client";

import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { fridgeStore, shoppingStore, mealStore } from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import PageHeader from "./PageHeader";

export default function MyPage() {
  const [fridge] = usePersistentList(fridgeStore);
  const [shopping] = usePersistentList(shoppingStore);
  const [meals] = usePersistentList(mealStore);

  function resetAll() {
    if (typeof window === "undefined") return;
    if (!window.confirm("冷蔵庫・買い物・献立履歴をすべて削除します。よろしいですか？")) return;
    fridgeStore.save([]);
    shoppingStore.save([]);
    mealStore.save([]);
    window.location.reload();
  }

  const stats = [
    { label: "冷蔵庫の食材", value: fridge.length },
    { label: "買い物リスト", value: shopping.filter((s) => !s.checked).length },
    { label: "作った献立", value: meals.length },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6">
      <PageHeader kicker="My Page" title="マイページ" />

      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-xl">
          🧑‍🍳
        </span>
        <div>
          <p className="wordmark text-lg font-bold text-brand-dark">{APP_NAME}</p>
          <p className="text-xs text-ink-soft">{APP_TAGLINE}</p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-line bg-surface p-3 text-center shadow-sm"
          >
            <p className="text-2xl font-bold text-brand-dark">{s.value}</p>
            <p className="mt-0.5 text-[11px] text-ink-soft">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <p className="text-sm font-semibold text-ink">データについて</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          すべてのデータはこの端末（ブラウザ）にだけ保存されます。個人用なので外部に送信されません。
        </p>
        <button
          type="button"
          onClick={resetAll}
          className="mt-3 rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
        >
          すべてのデータをリセット
        </button>
      </div>
    </div>
  );
}
