"use client";

import { useState } from "react";
import Image from "next/image";
import { APP_TAGLINE } from "@/lib/brand";
import {
  fridgeStore,
  shoppingStore,
  mealStore,
  accountStore,
} from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import { recentMeals } from "@/lib/mealplan";
import { useUsage, FREE_LIMITS, AI_LABEL, type AiKind } from "@/lib/usage";
import PageHeader from "./PageHeader";
import AppIcon from "./AppIcon";

const fieldClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft";

export default function MyPage() {
  const [accs, setAccs] = usePersistentList(accountStore);
  const [fridge, setFridge] = usePersistentList(fridgeStore);
  const [shopping, setShopping] = usePersistentList(shoppingStore);
  const [meals, setMeals] = usePersistentList(mealStore);
  const usage = useUsage();

  const account = accs[0] ?? null;

  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleRegister() {
    if (!name.trim() || !email.trim() || !password) {
      setError("すべての項目を入力してください。");
      return;
    }
    setAccs([
      {
        name: name.trim(),
        email: email.trim(),
        password,
        createdAt: Date.now(),
        loggedIn: true,
      },
    ]);
    setError("");
    setPassword("");
  }

  function handleLogin() {
    if (!account) {
      setError("アカウントがありません。新規登録してください。");
      return;
    }
    if (account.email !== email.trim() || account.password !== password) {
      setError("メールアドレスかパスワードが違います。");
      return;
    }
    setAccs([{ ...account, loggedIn: true }]);
    setError("");
    setPassword("");
  }

  function submitAuth() {
    if (mode === "register") handleRegister();
    else handleLogin();
  }

  function logout() {
    if (account) setAccs([{ ...account, loggedIn: false }]);
  }

  function resetAll() {
    if (typeof window === "undefined") return;
    if (!window.confirm("冷蔵庫・買い物・献立履歴をすべて削除します。よろしいですか？")) return;
    setFridge([]);
    setShopping([]);
    setMeals([]);
  }

  // 未ログイン：登録 / ログイン
  if (!account || !account.loggedIn) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pt-8">
        <div className="mb-6 text-center">
          <Image
            src="/cooksync-logo.svg"
            alt="CookSync"
            width={260}
            height={149}
            priority
            className="mx-auto -my-2 h-auto w-[220px]"
          />
          <p className="mt-1 text-sm text-ink-soft">{APP_TAGLINE}</p>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-full border border-line bg-surface p-0.5 text-sm">
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError("");
            }}
            className={`rounded-full py-2 font-medium transition ${
              mode === "register" ? "bg-brand text-white" : "text-ink-soft"
            }`}
          >
            新規登録
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
            }}
            className={`rounded-full py-2 font-medium transition ${
              mode === "login" ? "bg-brand text-white" : "text-ink-soft"
            }`}
          >
            ログイン
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitAuth();
          }}
          className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5 shadow-sm"
        >
          {mode === "register" && (
            <label>
              <span className="mb-1 block text-xs font-medium text-ink-soft">お名前</span>
              <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="タロウ" />
            </label>
          )}
          <label>
            <span className="mb-1 block text-xs font-medium text-ink-soft">メールアドレス</span>
            <input type="email" className={fieldClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-ink-soft">パスワード</span>
            <input type="password" className={fieldClass} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </label>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            type="button"
            onClick={submitAuth}
            className="mt-1 touch-manipulation rounded-xl bg-brand py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
          >
            {mode === "register" ? "アカウントを作成" : "ログイン"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-soft/80">
          アカウント情報はこの端末内にのみ保存される簡易版です（本格的な認証ではありません）。
        </p>
      </div>
    );
  }

  // ログイン済み：プロフィール
  // 「作った」＝🍳作ったボタンで記録した分だけ（献立に入れただけの計画は含めない）
  const madeMeals = meals.filter((m) => m.made);
  const stats = [
    { label: "冷蔵庫の食材", value: fridge.length },
    { label: "買い物リスト", value: shopping.filter((s) => !s.checked).length },
    { label: "作った料理", value: madeMeals.length },
  ];
  const sortedMeals = recentMeals(madeMeals, 36500); // 作ったもの・新しい順
  const avoidIds = new Set(recentMeals(madeMeals, 2).map((e) => e.id)); // 直近2日＝提案で除外中

  function removeMeal(mid: string) {
    setMeals((prev) => prev.filter((m) => m.id !== mid));
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6">
      <PageHeader title="マイページ" />

      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-brand text-xl font-bold text-white">
          {account.name.slice(0, 1) || "🧑‍🍳"}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-ink">{account.name}</p>
          <p className="truncate text-xs text-ink-soft">{account.email}</p>
        </div>
        <button
          onClick={logout}
          className="ml-auto shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-paper"
        >
          ログアウト
        </button>
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

      <div className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <h2 className="mb-1 inline-flex items-center gap-1.5 text-sm font-bold text-ink">
          <AppIcon name="check" size={18} />
          最近作ったもの
        </h2>
        <p className="mb-3 text-[11px] leading-relaxed text-ink-soft">
          「提案で除外中」は直近2日に作ったため、献立提案で避けられています。間違いは × で削除できます。
        </p>
        {sortedMeals.length === 0 ? (
          <p className="rounded-xl bg-paper p-3 text-sm text-ink-soft">
            まだ記録がありません。レシピの「🍳 作った」で記録されます。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sortedMeals.slice(0, 30).map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-xl bg-paper px-3 py-2"
              >
                <span className="shrink-0 text-xs tabular-nums text-ink-soft">
                  {m.date.slice(5).replace("-", "/")}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {m.recipeName}
                </span>
                {avoidIds.has(m.id) && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    提案で除外中
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeMeal(m.id)}
                  aria-label="削除"
                  className="shrink-0 rounded-lg px-2 py-1 text-ink-soft transition hover:bg-red-50 hover:text-red-600"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-bold text-ink">今月のAI利用</h2>
        <p className="mb-3 text-[11px] leading-relaxed text-ink-soft">
          {usage.premium
            ? "プレミアム：AI機能は無制限です。"
            : "無料枠（毎月1日リセット）。AI機能だけ回数制限があります。プレミアムで無制限（準備中）。"}
        </p>
        <ul className="flex flex-col gap-2.5">
          {(["research", "image", "scan"] as AiKind[]).map((k) => {
            const used = usage.used(k);
            const limit = FREE_LIMITS[k];
            const pct = usage.premium ? 0 : Math.min(100, (used / limit) * 100);
            return (
              <li key={k}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-ink">{AI_LABEL[k]}</span>
                  <span className="font-medium text-ink-soft">
                    {usage.premium ? "無制限" : `${used} / ${limit}`}
                  </span>
                </div>
                {!usage.premium && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper">
                    <div
                      className={`h-full rounded-full ${pct >= 100 ? "bg-accent" : "bg-brand"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
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
