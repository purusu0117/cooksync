"use client";

// 初回ウェルカム（全画面オーバーレイ・1回だけ・スキップ可）。
// ログイン前トップでも表示。マイページの「使い方を見る」から再表示（window イベント）。
import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Sparkles,
  Refrigerator,
  ChefHat,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
  X,
  type LucideIcon,
} from "lucide-react";

const FLAG = "cooksync:onboarded:v1";
export const OPEN_EVENT = "cooksync:tutorial";

interface Slide {
  Icon: LucideIcon;
  ring: string; // 円の背景（ソフト）
  color: string; // アイコン色
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    Icon: Sparkles,
    ring: "bg-brand-soft",
    color: "text-brand",
    title: "CookSync へようこそ",
    body: "冷蔵庫にある食材から、AIが今日の献立を提案します。「何作ろう」と「期限切れ」をまとめて解決。",
  },
  {
    Icon: Refrigerator,
    ring: "bg-brand-soft",
    color: "text-brand",
    title: "① まず冷蔵庫に入れる",
    body: "写真を撮るだけ、または手入力で食材を登録。期限が近いものは 🔴 で教えるので、使い切りに役立ちます。",
  },
  {
    Icon: ChefHat,
    ring: "bg-accent-soft",
    color: "text-accent",
    title: "② 献立をAIにおまかせ",
    body: "「献立を決める」を押すと、AIが実在の人気レシピを3案提案。期限が近い食材から優先して使います。",
  },
  {
    Icon: ShoppingCart,
    ring: "bg-sky-100",
    color: "text-sky-500",
    title: "③ 買い物 & 作った記録",
    body: "足りない材料は買い物リストへ自動で追加。作ったら「作った」を押すだけで在庫が自動で減ります。",
  },
];

export default function Onboarding() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    try {
      // 初回（未オンボード）だけ表示＝localStorageとの同期。意図的な初回setState。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!window.localStorage.getItem(FLAG)) setOpen(true);
    } catch {
      /* noop */
    }
    const onOpen = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(FLAG, "1");
    } catch {
      /* noop */
    }
    setOpen(false);
  }, []);

  if (!open || pathname === "/lp") return null;

  const last = i === SLIDES.length - 1;
  const s = SLIDES[i];
  const Icon = s.Icon;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 py-6 sm:items-center">
      <div className="flex max-h-[88vh] w-full max-w-sm flex-col overflow-y-auto rounded-3xl bg-paper p-6 shadow-xl">
        {/* スキップ */}
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={finish}
            className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-ink-soft transition hover:bg-line/40"
          >
            スキップ
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        {/* アイコン */}
        <div className="flex flex-col items-center text-center">
          <span
            className={`mb-5 grid h-24 w-24 place-items-center rounded-full ${s.ring}`}
          >
            <Icon className={`h-12 w-12 ${s.color}`} strokeWidth={1.5} aria-hidden />
          </span>
          <h2 className="font-display text-xl font-bold text-brand-dark">
            {s.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">{s.body}</p>
        </div>

        {/* ドット */}
        <div className="mt-6 flex justify-center gap-1.5">
          {SLIDES.map((_, idx) => (
            <span
              key={idx}
              className={`h-1.5 rounded-full transition-all ${
                idx === i ? "w-5 bg-brand" : "w-1.5 bg-line"
              }`}
            />
          ))}
        </div>

        {/* 操作 */}
        <div className="mt-6 flex items-center gap-3">
          {i > 0 && (
            <button
              type="button"
              onClick={() => setI((v) => v - 1)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-ink-soft transition hover:border-brand"
              aria-label="戻る"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {last ? (
            <button
              type="button"
              onClick={() => {
                finish();
                router.push("/fridge");
              }}
              className="flex-1 rounded-full bg-brand py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
            >
              さっそく冷蔵庫に追加する
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setI((v) => v + 1)}
              className="flex flex-1 items-center justify-center gap-1 rounded-full bg-brand py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
            >
              次へ
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
