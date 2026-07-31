"use client";

import { useMemo, useState } from "react";
import { Flame, Refrigerator } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useGuide, setGuide } from "@/lib/guide";
import {
  bucketOf,
  BUCKETS,
  daysUntil,
  FRESHNESS,
  freshnessOf,
  sortByExpiry,
  todayISO,
  type FreshnessBucket,
  type FridgeItem,
} from "@/lib/food";
import { fridgeStore } from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import { useSyncState } from "@/lib/syncStore";
import SyncNotice, { LoadingOrOffline } from "./SyncNotice";
import { BUCKET_UI } from "./freshness";
import PageHeader from "./PageHeader";
import AddItemForm from "./AddItemForm";
import BulkAddForm from "./BulkAddForm";
import PhotoAddForm from "./PhotoAddForm";
import AppIcon from "./AppIcon";
import FoodCard from "./FoodCard";
import EditItemForm from "./EditItemForm";
import MaintenancePanel from "./MaintenancePanel";
import ExpiryReviewPanel from "./ExpiryReviewPanel";

export default function FridgeApp() {
  const router = useRouter();
  const guide = useGuide();
  const [items, setItems] = usePersistentList(fridgeStore);
  const sync = useSyncState();
  const [editing, setEditing] = useState<FridgeItem | null>(null);
  const [mode, setMode] = useState<"single" | "bulk" | "photo">("single");

  const sorted = useMemo(() => sortByExpiry(items), [items]);
  const counts = useMemo(() => {
    const c: Record<FreshnessBucket, number> = {
      priority: 0,
      soon: 0,
      fresh: 0,
    };
    for (const it of items) c[bucketOf(it.expiresOn)] += 1;
    return c;
  }, [items]);

  const priority = useMemo(
    () => sorted.filter((it) => bucketOf(it.expiresOn) === "priority"),
    [sorted],
  );

  function addItem(item: FridgeItem) {
    setItems((prev) => [...prev, item]);
  }
  function deleteItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }
  function updateItem(updated: FridgeItem) {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }
  function addMany(newItems: FridgeItem[]) {
    setItems((prev) => [...prev, ...newItems]);
  }
  /** 期限見直しの反映（idが一致するものを差し替え） */
  function updateMany(updated: FridgeItem[]) {
    setItems((prev) =>
      prev.map((i) => updated.find((u) => u.id === i.id) ?? i),
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <PageHeader title="冷蔵庫" Icon={Refrigerator} iconClass="text-brand" />

      <SyncNotice />

      {guide === "fridge" && (
        <div className="mb-5 rounded-2xl border border-brand/30 bg-brand-soft px-4 py-3.5">
          {items.length === 0 ? (
            <p className="text-sm font-semibold leading-relaxed text-brand-dark">
              登録できました！まずは食材を1つ入れてみましょう（下のフォーム、または「写真で追加」）。
            </p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold leading-relaxed text-brand-dark">
                いい感じ！次は、その食材で献立を探してみましょう。
              </p>
              <button
                type="button"
                onClick={() => {
                  setGuide("meal");
                  router.push("/meal");
                }}
                className="shrink-0 rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
              >
                献立を探す →
              </button>
            </div>
          )}
        </div>
      )}

      <MaintenancePanel onAddToFridge={addItem} />
      <ExpiryReviewPanel items={items} onApply={updateMany} />

      <div className="mb-5 grid grid-cols-3 gap-3">
        {BUCKETS.map((b) => {
          const u = BUCKET_UI[b.key];
          const Icon = u.Icon;
          return (
            <div
              key={b.key}
              className="flex flex-col items-center rounded-2xl border border-line bg-surface p-3 text-center shadow-sm"
            >
              <span className={`grid h-8 w-8 place-items-center rounded-full ${u.tint}`}>
                <Icon size={16} strokeWidth={2.4} />
              </span>
              <p className={`mt-1.5 text-2xl font-bold ${u.num}`}>{counts[b.key]}</p>
              <p className="text-xs text-ink-soft">{u.label}</p>
            </div>
          );
        })}
      </div>

      {priority.length > 0 && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50/70 p-3">
          <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-bold text-red-700">
            <Flame size={15} strokeWidth={2.4} />
            今日の優先消費食材
          </p>
          <p className="text-sm text-red-900">
            {priority
              .map(
                (p) =>
                  `${p.name}（${FRESHNESS[freshnessOf(p.expiresOn)].label(daysUntil(p.expiresOn))}）`,
              )
              .join("　/　")}
          </p>
        </div>
      )}

      <div className="mb-6">
        <div className="mb-2 inline-flex rounded-full border border-line bg-surface p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={`rounded-full px-3 py-1 font-medium transition ${
              mode === "single" ? "bg-brand text-white" : "text-ink-soft"
            }`}
          >
            単品で追加
          </button>
          <button
            type="button"
            onClick={() => setMode("bulk")}
            className={`rounded-full px-3 py-1 font-medium transition ${
              mode === "bulk" ? "bg-brand text-white" : "text-ink-soft"
            }`}
          >
            まとめて追加
          </button>
          <button
            type="button"
            onClick={() => setMode("photo")}
            className={`rounded-full px-3 py-1 font-medium transition ${
              mode === "photo" ? "bg-brand text-white" : "text-ink-soft"
            }`}
          >
            <AppIcon name="camera" size={14} className="mr-1" />
            写真で追加
          </button>
        </div>
        {mode === "single" ? (
          <AddItemForm onAdd={addItem} />
        ) : mode === "bulk" ? (
          <BulkAddForm onAddMany={addMany} />
        ) : (
          <PhotoAddForm onAddMany={addMany} />
        )}
      </div>

      {/*
        ★「空」と「まだ読めていない」を必ず区別する。
          以前はこの分岐が2択しかなく、40件あってもコールドスタート中は
          「まだ食材がありません」と出ていた（圏外なら永久にその表示）。
      */}
      {sorted.length === 0 && !sync.hydrated ? (
        <LoadingOrOffline label="冷蔵庫" />
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-10 text-center">
          <p className="text-sm font-semibold text-ink">まだ食材がありません</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            上の「写真で追加」で冷蔵庫を撮るか、手入力で登録しましょう。
            <br />
            食材が入ると、AIが献立を提案できるようになります。
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((item) => (
            <FoodCard
              key={item.id}
              item={item}
              onDelete={deleteItem}
              onUpdate={updateItem}
              onEdit={setEditing}
            />
          ))}
        </ul>
      )}

      {editing && (
        <EditItemForm
          item={editing}
          onSave={(it) => {
            updateItem(it);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {/*
        ★以前ここは「データはこの端末にだけ保存されます（個人用・localStorage）」だった。
          実際の保存先はサーバー（Upstash Redis）で端末間同期もしているので、これは**嘘**。
          審査担当が最初に見る画面の文言が App Privacy の申告とずれるのはリジェクト事由。
          プライバシーポリシー（/legal/privacy）の記述と揃えてある。
      */}
      <p className="mt-8 text-center text-xs leading-relaxed text-ink-soft/70">
        データは端末に保存したうえで、サーバーにも保存して端末間で同期します（
        <Link href="/legal/privacy" className="underline">
          プライバシーポリシー
        </Link>
        ）。今日は {todayISO()}。
      </p>
    </div>
  );
}
