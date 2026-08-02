"use client";

import { useCallback, useMemo, useState } from "react";
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
  type FreshnessBucket,
  type FridgeItem,
} from "@/lib/food";
import { fridgeStore } from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import { useSyncState } from "@/lib/syncStore";
import { SUGGEST_THRESHOLD, remainingToSuggest } from "@/lib/starter";
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
import QuickStart from "./QuickStart";
import EmptyState, { EMPTY_STATES } from "./EmptyState";

export default function FridgeApp() {
  const router = useRouter();
  const guide = useGuide();
  const [items, setItems] = usePersistentList(fridgeStore);
  const sync = useSyncState();
  const [editing, setEditing] = useState<FridgeItem | null>(null);
  const [mode, setMode] = useState<"single" | "bulk" | "photo">("single");
  // 「数量や期限まで自分で決める」を押したら、初回でも従来のフォームに切り替える
  const [manual, setManual] = useState(false);

  // 初回の画面。ここでは6項目のフォームを出さない（作業感で離脱するため）。
  // ★ hydrated を必ず見る。読み込み前は items が空なので、
  //   これを見ないと在庫40件の既存ユーザーにも一瞬「はじめかた」が出てしまう。
  const showQuickStart =
    sync.hydrated && items.length < SUGGEST_THRESHOLD && !manual;
  const left = remainingToSuggest(items.length);

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

  // ⚠️ **すべて useCallback + updater 形式で書くこと。**
  //    これらは FoodCard（React.memo）へ props で渡る。毎レンダー新しい関数を作ると
  //    memo が毎回はずれて、在庫100件のとき全カードが再描画される。
  //    updater 形式（prev => …）なので items を deps に持つ必要がなく、
  //    同一性が保てるうえに古い items を掴む（stale closure）事故も起きない。
  const addItem = useCallback((item: FridgeItem) => {
    setItems((prev) => [...prev, item]);
  }, [setItems]);
  const deleteItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, [setItems]);
  const updateItem = useCallback((updated: FridgeItem) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, [setItems]);
  const addMany = useCallback((newItems: FridgeItem[]) => {
    setItems((prev) => [...prev, ...newItems]);
  }, [setItems]);
  /** 期限見直しの反映（idが一致するものを差し替え） */
  const updateMany = useCallback((updated: FridgeItem[]) => {
    setItems((prev) => prev.map((i) => updated.find((u) => u.id === i.id) ?? i));
  }, [setItems]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <PageHeader title="冷蔵庫" Icon={Refrigerator} iconClass="text-brand" />

      <SyncNotice />

      {/*
        初回ガイド。3つ未満のあいだは QuickStart 側が「あと何個か」を出しているので、
        ここは **そろったあとの「次は献立」** だけを担当する（同じ案内を二重に出さない）。
      */}
      {guide === "fridge" && left === 0 && (
        <div className="mb-5 rounded-2xl border border-brand/30 bg-brand-soft px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold leading-relaxed text-brand-dark">
              そろいました。この食材で作れる料理を出します。
            </p>
            <button
              type="button"
              onClick={() => {
                setGuide("meal");
                router.push("/meal");
              }}
              className="flex min-h-[44px] shrink-0 items-center rounded-full bg-brand px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
            >
              献立を出す →
            </button>
          </div>
        </div>
      )}

      <MaintenancePanel onAddToFridge={addItem} />
      <ExpiryReviewPanel items={items} onApply={updateMany} />

      {/*
        ★ 在庫が1つも無いときは出さない（2026-08-01）。
          初見の人が /fridge を開いて最初に見るのが「0・0・0」の3枚のカードで、
          そのぶん本題（あと3つで献立が出る）が画面の下に押し出されていた。
          数える対象が無いのだから、数えるUIも要らない。
      */}
      {items.length > 0 && (
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
      )}

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

      {showQuickStart ? (
        <QuickStart
          count={items.length}
          existingNames={items.map((i) => i.name)}
          onAdd={addItem}
          onAddMany={addMany}
          onManual={() => setManual(true)}
        />
      ) : (
      <div className="mb-6">
        <div className="mb-2 inline-flex rounded-full border border-line bg-surface p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={`flex min-h-[44px] items-center rounded-full px-3.5 font-medium transition ${
              mode === "single" ? "bg-brand text-white" : "text-ink-soft"
            }`}
          >
            単品で追加
          </button>
          <button
            type="button"
            onClick={() => setMode("bulk")}
            className={`flex min-h-[44px] items-center rounded-full px-3.5 font-medium transition ${
              mode === "bulk" ? "bg-brand text-white" : "text-ink-soft"
            }`}
          >
            まとめて追加
          </button>
          <button
            type="button"
            onClick={() => setMode("photo")}
            className={`flex min-h-[44px] items-center rounded-full px-3.5 font-medium transition ${
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
      )}

      {/*
        ★「空」と「まだ読めていない」を必ず区別する。
          以前はこの分岐が2択しかなく、40件あってもコールドスタート中は
          「まだ食材がありません」と出ていた（圏外なら永久にその表示）。
      */}
      {sorted.length === 0 && !sync.hydrated ? (
        <LoadingOrOffline label="冷蔵庫" />
      ) : sorted.length === 0 ? (
        // QuickStart が出ているあいだは、それ自体が空状態の案内なので二重に出さない。
        // （手入力フォームに切り替えた人だけがここを見る）
        showQuickStart ? null : <EmptyState content={EMPTY_STATES.fridge} />
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
      <p className="mt-8 text-center text-xs leading-relaxed text-ink-soft">
        データは端末に保存したうえで、サーバーにも保存して端末間で同期します（
        {/* インラインリンク：-my-3 で44pxのヒット領域ぶん行間が広がらないよう相殺 */}
        <Link
          href="/legal/privacy"
          className="-my-3 inline-flex min-h-[44px] items-center px-1 underline"
        >
          プライバシーポリシー
        </Link>
        {/* ⚠️ ここに「今日は {todayISO()}」を出さない（2026-06-08から残っていた開発用の名残）。
            この画面は**静的生成**なので、描画されるのは"ビルドした日"で固定される。
            日付が変わった翌日から画面が古い日付を表示し（＝嘘）、さらにSSRとクライアントで
            文字が食い違ってハイドレーションエラー(React #418)になっていた。
            日付を出す必要が出たら、必ずマウント後（useEffect）にクライアントだけで描くこと。 */}
        ）。
      </p>
    </div>
  );
}
