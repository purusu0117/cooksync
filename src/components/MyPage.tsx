"use client";

import { useState } from "react";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import {
  fridgeStore,
  shoppingStore,
  mealStore,
  accountStore,
} from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import PageHeader from "./PageHeader";

const fieldClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft";

export default function MyPage() {
  const [accs, setAccs] = usePersistentList(accountStore);
  const [fridge] = usePersistentList(fridgeStore);
  const [shopping] = usePersistentList(shoppingStore);
  const [meals] = usePersistentList(mealStore);

  const account = accs[0] ?? null;

  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleRegister(e: React.FormEvent) {
    e.preventDefault();
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

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
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

  function logout() {
    if (account) setAccs([{ ...account, loggedIn: false }]);
  }

  function resetAll() {
    if (typeof window === "undefined") return;
    if (!window.confirm("冷蔵庫・買い物・献立履歴をすべて削除します。よろしいですか？")) return;
    fridgeStore.save([]);
    shoppingStore.save([]);
    mealStore.save([]);
    window.location.reload();
  }

  // 未ログイン：登録 / ログイン
  if (!account || !account.loggedIn) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pt-8">
        <div className="mb-6 text-center">
          <p className="wordmark text-3xl font-bold text-brand-dark">{APP_NAME}</p>
          <p className="mt-1 text-sm text-ink-soft">{APP_TAGLINE}</p>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-full border border-line bg-surface p-0.5 text-sm">
          <button
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
          onSubmit={mode === "register" ? handleRegister : handleLogin}
          className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5 shadow-sm"
        >
          {mode === "register" && (
            <label>
              <span className="mb-1 block text-xs font-medium text-ink-soft">お名前</span>
              <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="大翔" />
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
            type="submit"
            className="mt-1 rounded-xl bg-brand py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]"
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
  const stats = [
    { label: "冷蔵庫の食材", value: fridge.length },
    { label: "買い物リスト", value: shopping.filter((s) => !s.checked).length },
    { label: "作った献立", value: meals.length },
  ];

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
