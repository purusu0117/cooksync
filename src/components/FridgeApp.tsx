"use client";

import { useMemo, useState } from "react";
import { Flame } from "lucide-react";
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
import { BUCKET_UI } from "./freshness";
import PageHeader from "./PageHeader";
import AddItemForm from "./AddItemForm";
import BulkAddForm from "./BulkAddForm";
import PhotoAddForm from "./PhotoAddForm";
import AppIcon from "./AppIcon";
import FoodCard from "./FoodCard";
import EditItemForm from "./EditItemForm";
import MaintenancePanel from "./MaintenancePanel";

export default function FridgeApp() {
  const [items, setItems] = usePersistentList(fridgeStore);
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

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <PageHeader title="冷蔵庫" icon="/icons/fridge.png" tint="bg-brand-soft" />

      <MaintenancePanel onAddToFridge={addItem} />

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

      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface/60 py-12 text-center text-sm text-ink-soft">
          まだ食材がありません。上のフォームから追加してみましょう。
        </p>
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

      <p className="mt-8 text-center text-xs text-ink-soft/70">
        データはこの端末にだけ保存されます（個人用・localStorage）。今日は {todayISO()}。
      </p>
    </div>
  );
}
