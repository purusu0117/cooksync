"use client";

// 買い物リスト。**店の中で、片手で、カートを押しながら使う画面**として作る。
//
// 根拠：このアプリで価値を感じる瞬間の1位は「帰宅途中 50.4%」「買い物中 50.1%」。
// 夜に机で開く画面ではない。だから店で困ることを順に潰してある：
//   ① 売り場順に並べる  … 追加順のままだと店内を行ったり来たりする（src/lib/aisle.ts）
//   ② 行ごと押せる      … 20pxの四角は歩きながら狙えない。行全体を56pxのボタンにする
//   ③ 残り件数を上に出す… 「あと何個で帰れるか」が店で一番知りたい数字
//   ④ 主要ボタンは下端  … 上端は親指が届かない。「冷蔵庫に入れる」は下に固定する
//   ⑤ 追加欄はリストの下… 店では「見る・チェックする」が主で入力は従。上を占有させない

import { useMemo, useState } from "react";
import { shoppingStore, fridgeStore } from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import { useSyncState } from "@/lib/syncStore";
import SyncNotice, { LoadingOrOffline } from "@/components/SyncNotice";
import type { ShoppingItem } from "@/lib/shopping";
import { zoneForCategory, todayISO, type FridgeItem } from "@/lib/food";
import { guessItem } from "@/lib/guess";
import { groupByAisle } from "@/lib/aisle";
import { Check, ShoppingCart, X } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import AppIcon from "@/components/AppIcon";
import ShoppablePanel from "@/components/shopping/ShoppablePanel";
import EmptyState, { EMPTY_STATES } from "@/components/EmptyState";
import { shoppingListText } from "@/lib/affiliate";

// タップ領域 44px（iPhoneの下限）を確保する
const fieldClass =
  "min-h-[44px] rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft";

export default function ShoppingList() {
  const [items, setItems] = usePersistentList(shoppingStore);
  const [, setFridge] = usePersistentList(fridgeStore);
  const sync = useSyncState();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  const { todo, done } = useMemo(
    () => ({
      todo: items.filter((i) => !i.checked),
      done: items.filter((i) => i.checked),
    }),
    [items],
  );

  // 売り場ごとにまとめる。中身の順番は追加順のまま（＝レシピから入った順に読める）。
  const aisles = useMemo(() => groupByAisle(todo, (i) => i.name), [todo]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        amount: amount.trim(),
        checked: false,
        addedAt: Date.now(),
      },
    ]);
    setName("");
    setAmount("");
  }

  function toggle(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)),
    );
  }
  function remove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }
  function clearChecked() {
    setItems((prev) => prev.filter((i) => !i.checked));
  }
  function moveCheckedToFridge() {
    if (done.length === 0) return;
    const today = todayISO();
    const newItems: FridgeItem[] = done.map((i) => {
      const g = guessItem(i.name, today);
      return {
        id: crypto.randomUUID(),
        name: i.name,
        quantity: i.amount ?? "",
        category: g.category,
        zone: zoneForCategory(g.category),
        purchasedOn: today,
        expiresOn: g.expiresOn,
        createdAt: Date.now(),
      };
    });
    setFridge((prev) => [...prev, ...newItems]);
    setItems((prev) => prev.filter((i) => !i.checked));
  }

  /**
   * 1行。**行全体がチェックのボタン**（min-h-14＝56px）。
   * カートを押しながら片手で押すので、小さな四角を狙わせない。
   * 削除(×)だけは別ボタンなので、右端に離したうえで44px幅を確保する。
   */
  function row(i: ShoppingItem) {
    return (
      <li key={i.id} className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={() => toggle(i.id)}
          aria-pressed={i.checked}
          className={`flex min-h-14 flex-1 items-center gap-3 rounded-xl border px-3 py-3 text-left shadow-sm transition active:scale-[0.99] ${
            i.checked
              ? "border-line bg-paper"
              : "border-line bg-surface hover:border-brand/40"
          }`}
        >
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 transition ${
              i.checked ? "border-brand bg-brand text-white" : "border-line bg-paper"
            }`}
          >
            {i.checked && <Check size={17} strokeWidth={3} />}
          </span>
          <span
            className={`min-w-0 flex-1 ${i.checked ? "text-ink-soft line-through" : "text-ink"}`}
          >
            <span className="block truncate text-base leading-tight font-semibold">
              {i.name}
              {i.amount && (
                <span className="ml-2 text-sm font-medium text-ink-soft">{i.amount}</span>
              )}
            </span>
            {i.note && (
              <span className="mt-0.5 block truncate text-xs text-ink-soft">{i.note}</span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => remove(i.id)}
          aria-label={`${i.name}をリストから消す`}
          className="grid w-11 shrink-0 place-items-center rounded-xl text-ink-soft transition hover:bg-red-50 hover:text-red-600"
        >
          <X size={18} strokeWidth={2} />
        </button>
      </li>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <PageHeader title="買い物リスト" Icon={ShoppingCart} iconClass="text-sky-500" />

      <SyncNotice />

      {/* 「あと何個で帰れるか」。店で一番知りたい数字なので、リストの直前に置く */}
      {todo.length > 0 && (
        <p className="mb-3 text-sm font-semibold text-ink">
          あと{todo.length}個
          {done.length > 0 && (
            <span className="ml-2 text-xs font-medium text-ink-soft">
              （{done.length}個かごに入れました）
            </span>
          )}
        </p>
      )}

      {/* 「空」と「まだ読めていない」を区別する（店頭で圏外になっても消えたように見せない） */}
      {items.length === 0 && !sync.hydrated ? (
        <LoadingOrOffline label="買い物リスト" />
      ) : items.length === 0 ? (
        <EmptyState content={EMPTY_STATES.shopping} />
      ) : (
        <div className="flex flex-col gap-5">
          {/* 売り場ごと。見出しは小さくても**固まっていること**が効く */}
          {aisles.map((g) => (
            <div key={g.category}>
              <p className="mb-1.5 text-xs font-bold tracking-wide text-ink-soft">
                {g.label}
              </p>
              <ul className="flex flex-col gap-2">{g.items.map(row)}</ul>
            </div>
          ))}

          {done.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-xs font-bold tracking-wide text-ink-soft">
                  かごに入れた（{done.length}）
                </p>
                <button
                  type="button"
                  onClick={clearChecked}
                  className="min-h-[44px] rounded-full border border-line px-4 text-xs font-medium text-ink-soft transition hover:bg-paper"
                >
                  消す
                </button>
              </div>
              <ul className="flex flex-col gap-2">{done.map(row)}</ul>
            </div>
          )}
        </div>
      )}

      {/*
        追加欄は**リストの下**。店では「見る・チェックする」が主で入力は従なので、
        画面の一等地（上）を入力欄に使わない。下にあるほうが片手でも打ちやすい。
      */}
      <form onSubmit={add} className="mt-6 flex gap-2">
        <input
          className={`${fieldClass} min-w-0 flex-1`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="買うもの（例：玉ねぎ）"
        />
        <input
          className={`${fieldClass} w-16 shrink-0`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="数量"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="min-h-[44px] shrink-0 rounded-xl bg-brand px-4 text-sm font-semibold whitespace-nowrap text-white transition hover:bg-brand-dark active:scale-95 disabled:bg-line disabled:text-ink-soft"
        >
          追加
        </button>
      </form>

      {/*
        まとめて注文する導線。**リストの一番下**に置く。
        画面最上部は iPhone だと親指が届かないうえ、ここは「追加して・見て・チェックする」画面なので、
        上に置くと本来の操作より先に注文リンクが目に入ってしまう（＝広告に見える）。
        買うものを一通り見終わったあとの選択肢として最後に出す。
      */}
      <ShoppablePanel
        placement="shopping"
        count={todo.length}
        title={`まだ買っていない${todo.length}件を、ネットで注文して届けてもらう`}
        description="お店に行かなくても、ネットスーパーや食材宅配で受け取れます。リストをコピーしてから開くと、注文先で探すのが楽になります。"
        copyText={shoppingListText(todo)}
      />

      {/*
        帰宅後の一手。**下端に固定**する（親指が届く場所）。
        かごに入れたものがあるときだけ出るので、普段はリストの邪魔をしない。
      */}
      {done.length > 0 && (
        <div className="sticky bottom-0 -mx-4 mt-4 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-md">
          <button
            type="button"
            onClick={moveCheckedToFridge}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-sm font-bold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
          >
            <AppIcon name="fridge" size={18} />
            買った{done.length}個を冷蔵庫に入れる
          </button>
          <p className="mt-1.5 text-center text-xs text-ink-soft">
            期限の目安を付けて冷蔵庫リストに移します
          </p>
        </div>
      )}
    </div>
  );
}
