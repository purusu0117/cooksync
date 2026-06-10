"use client";

import { useState } from "react";
import { Camera, X } from "lucide-react";
import { guessItem } from "@/lib/guess";
import { zoneForCategory, todayISO, type FridgeItem } from "@/lib/food";
import { useUsage, FREE_LIMITS } from "@/lib/usage";

interface Props {
  onAddMany: (items: FridgeItem[]) => void;
}

export default function PhotoAddForm({ onAddMany }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<{ name: string; checked: boolean }[]>([]);
  const [done, setDone] = useState("");
  const usage = useUsage();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じ写真を選び直せるように
    if (!file) return;
    if (!usage.canUse("scan")) {
      setError(
        `今月の写真で在庫登録の無料枠（${FREE_LIMITS.scan}回）を使い切りました。来月1日にリセットされます。`,
      );
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
      const res = await fetch("/api/scan-fridge", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.items) || data.items.length === 0) {
        throw new Error(data.error || "食材を認識できませんでした。明るく撮り直すか、手入力をお試しください。");
      }
      setItems(
        (data.items as string[]).map((n) => ({ name: n, checked: true })),
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
        📷 冷蔵庫や食材を撮るだけ。AIが食材名を読み取り、
        <strong>賞味期限とカテゴリは自動で推定</strong>します（あとで編集可）。
      </p>

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

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {done && <p className="mt-2 text-xs font-medium text-brand-dark">{done}</p>}

      {items.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-ink">
            認識した食材（チェックを外す・名前を直せます）
          </p>
          <ul className="flex max-h-[44vh] flex-col gap-2 overflow-y-auto">
            {items.map((it, idx) => (
              <li
                key={idx}
                className="flex items-center gap-2 rounded-xl bg-paper px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={it.checked}
                  onChange={() =>
                    setItems((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, checked: !x.checked } : x,
                      ),
                    )
                  }
                  className="h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                />
                <input
                  value={it.name}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() =>
                    setItems((prev) => prev.filter((_, i) => i !== idx))
                  }
                  aria-label="削除"
                  className="shrink-0 rounded-lg p-1 text-ink-soft transition hover:bg-red-50 hover:text-red-600"
                >
                  <X size={15} />
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
