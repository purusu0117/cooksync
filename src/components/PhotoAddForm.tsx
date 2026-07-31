"use client";

import { useEffect, useState } from "react";
import { Camera, X } from "lucide-react";
import { guessItem } from "@/lib/guess";
import { zoneForCategory, todayISO, type FridgeItem } from "@/lib/food";
import { readApiError, useUsage } from "@/lib/usage";
import { getUid } from "@/lib/syncStore";
import { isNativeApp } from "@/lib/native";
import { takeOrPickPhoto } from "@/lib/nativeCamera";

interface Props {
  onAddMany: (items: FridgeItem[]) => void;
}

export default function PhotoAddForm({ onAddMany }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // ⚠️ `id` は表示用の**行の同一性**。配列の添字を key にすると、途中の行を消したとき
  //    残った行が別の DOM ノードに載り替わる。名前を漢字変換の途中（IME変換中）で消すと
  //    確定前の文字が隣の行に残ることがあり、実際に「入力した名前がずれる」になる。
  //    保存時に作る FridgeItem の id とは別物（あちらは保存のたびに新規発行）。
  const [items, setItems] = useState<
    { id: string; name: string; checked: boolean }[]
  >([]);
  const [done, setDone] = useState("");
  // アプリ版はOSのカメラ/フォトピッカーを直接呼ぶ。Web版は <input type="file"> のまま。
  // 初期値falseでマウント後に確定させる＝サーバー描画（＝Web版）とズレさせない。
  const [native, setNative] = useState(false);
  const usage = useUsage();

  useEffect(() => {
    // マウント後に確定させる（effect本体での同期setStateを避ける）
    const t = setTimeout(() => setNative(isNativeApp()), 0);
    return () => clearTimeout(t);
  }, []);

  // ネイティブ：OSのアクションシートで「写真を撮る／ライブラリから選ぶ」
  async function onNativePick() {
    if (loading) return;
    setError("");
    try {
      const file = await takeOrPickPhoto();
      if (file) await scan(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "写真を取得できませんでした");
    }
  }

  // Web：<input type="file"> から
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じ写真を選び直せるように
    if (!file) return;
    await scan(file);
  }

  // 取得経路がどちらでも、ここから先（送信・表示）は同じ
  async function scan(file: File) {
    // 事前チェックは表示用。文言はサーバーの429と揃える（説明がブレないように）。
    if (!usage.canUse("scan")) {
      setError(usage.limitMessage("scan"));
      return;
    }
    usage.recordUse("scan");
    setError("");
    setDone("");
    setItems([]);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/scan-fridge", {
        method: "POST",
        headers: { "x-cooksync-uid": getUid() },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        // 429（枠切れ）は**サーバーの文言をそのまま**出す。断られた理由（本人の枠／回線／
        // 全体／予算）はサーバーしか知らないので、こちらで書き換えると嘘になる。
        const fail = readApiError(data, "認識に失敗しました");
        usage.syncFromServer("scan", fail.quota); // 表示カウンタをサーバーの実態に合わせる
        throw new Error(fail.message);
      }
      if (!Array.isArray(data.items) || data.items.length === 0) {
        // 200だが空＝AIは呼ばれている（サーバーの枠も減っている）ので戻さない
        throw new Error(
          "食材を認識できませんでした。明るく撮り直すか、手入力をお試しください。",
        );
      }
      setItems(
        (data.items as string[]).map((n) => ({
          id: crypto.randomUUID(),
          name: n,
          checked: true,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "認識に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  function save() {
    const today = todayISO();
    const toAdd: FridgeItem[] = items
      .filter((i) => i.checked && i.name.trim())
      .map((i) => {
        const g = guessItem(i.name.trim(), today);
        return {
          id: crypto.randomUUID(),
          name: i.name.trim(),
          quantity: "",
          category: g.category,
          zone: zoneForCategory(g.category),
          purchasedOn: today,
          expiresOn: g.expiresOn,
          createdAt: Date.now(),
        };
      });
    if (toAdd.length === 0) return;
    onAddMany(toAdd);
    setDone(`${toAdd.length}品を冷蔵庫に追加しました（期限は目安。気になるものは編集できます）`);
    setItems([]);
  }

  const selectedCount = items.filter((i) => i.checked).length;

  return (
    <div className="rounded-3xl border border-line bg-surface p-4 shadow-sm">
      <p className="mb-3 text-xs text-ink-soft">
        <Camera size={13} strokeWidth={2} className="mr-1 inline-block align-[-0.15em]" />
        冷蔵庫や食材を撮るだけ。AIが食材名を読み取り、
        <strong>賞味期限とカテゴリは自動で推定</strong>します（あとで編集可）。
      </p>

      {native ? (
        <button
          type="button"
          onClick={onNativePick}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99] disabled:bg-line disabled:text-ink-soft"
        >
          <Camera size={18} />
          {loading ? "読み取り中…（10〜30秒）" : "写真を撮る / 選ぶ"}
        </button>
      ) : (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99]">
          <Camera size={18} />
          {loading ? "読み取り中…（10〜30秒）" : "写真を撮る / 選ぶ"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFile}
            disabled={loading}
            className="hidden"
          />
        </label>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {done && <p className="mt-2 text-xs font-medium text-brand-dark">{done}</p>}

      {items.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-ink">
            認識した食材（チェックを外す・名前を直せます）
          </p>
          <ul className="flex max-h-[44vh] flex-col gap-2 overflow-y-auto">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-2 rounded-xl bg-paper px-3 py-1.5"
              >
                {/* チェックボックス本体は小さいので、ラベルごと44pxの当たり判定にする */}
                <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center">
                  <input
                    type="checkbox"
                    checked={it.checked}
                    onChange={() =>
                      setItems((prev) =>
                        prev.map((x) =>
                          x.id === it.id ? { ...x, checked: !x.checked } : x,
                        ),
                      )
                    }
                    aria-label={`${it.name} を追加する`}
                    className="h-5 w-5 accent-[var(--color-brand)]"
                  />
                </label>
                <input
                  value={it.name}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x) =>
                        x.id === it.id ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                  aria-label="食材名"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() =>
                    setItems((prev) => prev.filter((x) => x.id !== it.id))
                  }
                  aria-label={`${it.name} をこの一覧から外す`}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-soft transition hover:bg-red-50 hover:text-red-600"
                >
                  <X size={18} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={save}
            disabled={selectedCount === 0}
            className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99] disabled:bg-line disabled:text-ink-soft"
          >
            ＋ 選んだ{selectedCount}品を冷蔵庫に追加
          </button>
        </div>
      )}
    </div>
  );
}
