"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { APP_TAGLINE } from "@/lib/brand";
import { setUid } from "@/lib/syncStore";
import { setGuide } from "@/lib/guide";
import {
  fridgeStore,
  shoppingStore,
  mealStore,
  accountStore,
} from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import { recentMeals } from "@/lib/mealplan";
import { useUsage, AI_LABEL, type AiKind } from "@/lib/usage";
import { ChefHat, HelpCircle } from "lucide-react";
import PageHeader from "./PageHeader";
import { OPEN_EVENT } from "./Onboarding";
import AppIcon from "./AppIcon";

const fieldClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft";

/** Googleの公式4色マーク（lucideには無いのでinline SVG） */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.8-1.6 4.5-4.5 6.3l6.9 5.4c4.1-3.8 6.6-9.4 6.6-14.9z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.9l7.1-5.5z"
      />
      <path
        fill="#EA4335"
        d="M24 10.3c4.1 0 6.9 1.8 8.5 3.3l6.1-6C34.9 4.1 29.9 2 24 2 15.4 2 8.1 6.9 4.4 14.1l7.1 5.5c1.8-5.3 6.7-9.3 12.5-9.3z"
      />
    </svg>
  );
}

export default function MyPage() {
  const router = useRouter();
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
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    // マウント後にlocalStorageのセッションを反映＝外部状態との同期（意図的）。
    /* eslint-disable react-hooks/set-state-in-effect */
    setMounted(true);
    try {
      setSession(window.localStorage.getItem("cooksync:session") === "1");
    } catch {
      /* noop */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Googleログインの戻り（/mypage?login=ok）と、この環境でGoogleが使えるかの確認。
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const s = (await res.json()) as {
          loggedIn?: boolean;
          dataId?: string | null;
          googleEnabled?: boolean;
        };
        if (!alive) return;
        setGoogleEnabled(!!s.googleEnabled);
        // Googleログイン直後：サーバーが決めた dataId に切り替えて再読込する。
        // ここを合わせないと、その人のデータではなく端末のUUID側を見てしまう。
        if (s.loggedIn && s.dataId) {
          const current = window.localStorage.getItem("cooksync:uid");
          if (current !== s.dataId) {
            setUid(s.dataId);
            window.localStorage.setItem("cooksync:session", "1");
            window.location.reload();
            return;
          }
          window.localStorage.setItem("cooksync:session", "1");
          setSession(true);
        }
      } catch {
        /* オフライン等：従来のローカル判定のまま動かす */
      }
    })();
    // 同意画面でキャンセルした等のエラーを画面に出す（URLという外部状態の取り込み）。
    /* eslint-disable react-hooks/set-state-in-effect */
    const p = new URLSearchParams(window.location.search);
    const err = p.get("login_error");
    if (err) {
      setError(
        err === "cancelled"
          ? "Googleログインをキャンセルしました。"
          : "Googleログインに失敗しました。時間をおいてお試しください。",
      );
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      alive = false;
    };
  }, []);

  async function handleRegister() {
    if (!name.trim() || !email.trim() || !password) {
      setError("すべての項目を入力してください。");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.dataId) {
        setError(data.error || "登録に失敗しました。");
        return;
      }
      // 本人のデータIDへ切り替えてアカウントを保存
      setUid(data.dataId);
      window.localStorage.setItem("cooksync:session", "1");
      // パスワードは端末に保存しない（認証はサーバーが持つ）
      setAccs([
        {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          createdAt: Date.now(),
          loggedIn: true,
        },
      ]);
      setError("");
      setPassword("");
      setSession(true);
      // 操作ガイド開始：まず冷蔵庫へ
      setGuide("fridge");
      router.push("/fridge");
    } catch {
      setError("通信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError("メールとパスワードを入力してください。");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          email: email.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.dataId) {
        setError(data.error || "ログインに失敗しました。");
        return;
      }
      // 本人のデータIDに切り替え→reloadして本人のデータを読み込む
      setUid(data.dataId);
      window.localStorage.setItem("cooksync:session", "1");
      window.location.reload();
    } catch {
      setError("通信に失敗しました。時間をおいて再度お試しください。");
      setBusy(false);
    }
  }

  function submitAuth() {
    if (busy) return;
    if (mode === "register") void handleRegister();
    else void handleLogin();
  }

  function logout() {
    try {
      window.localStorage.removeItem("cooksync:session");
    } catch {
      /* noop */
    }
    // サーバー側のセッションCookieも破棄する（消さないとAIの枠は前の人のままになる）
    void fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    setSession(false);
    if (account) setAccs([{ ...account, loggedIn: false }]);
  }

  /** アカウントと全データを削除する（審査ガイドライン 5.1.1(v) 対応）。
   *  取り返しがつかないので2段階で確認し、成功したら端末側の残りも消して初期状態へ戻す。 */
  async function deleteAccount() {
    if (typeof window === "undefined" || deleting) return;
    if (
      !window.confirm(
        "アカウントと、冷蔵庫・買い物リスト・レシピ・献立履歴のすべてを削除します。元に戻せません。続けますか？",
      )
    ) {
      return;
    }
    if (!window.confirm("本当に削除しますか？この操作は取り消せません。")) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setDeleteError(data.error || "削除に失敗しました。時間をおいてお試しください。");
        return;
      }
      // 端末に残っているデータも消す（消さないと次の登録に前の人の内容が混ざる）
      try {
        for (const k of Object.keys(window.localStorage)) {
          if (k.startsWith("cooksync:") || k.startsWith("fridge-app:")) {
            window.localStorage.removeItem(k);
          }
        }
      } catch {
        /* noop */
      }
      window.location.href = "/mypage";
    } catch {
      setDeleteError("通信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setDeleting(false);
    }
  }

  function resetAll() {
    if (typeof window === "undefined") return;
    if (!window.confirm("冷蔵庫・買い物・献立履歴をすべて削除します。よろしいですか？")) return;
    setFridge([]);
    setShopping([]);
    setMeals([]);
  }

  // ハイドレーション前は描画しない（SSRと不一致を避ける）
  if (!mounted) return null;

  // ログイン済みだがデータ読込中（別端末でログインした直後のreload後など）
  if (session && !account) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pt-16 text-center text-sm text-ink-soft">
        読み込み中…
      </div>
    );
  }

  // 未ログイン：登録 / ログイン
  if (!session) {
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

        {/* Googleログイン。未設定の環境ではボタン自体を出さない（押すと501になるだけなので） */}
        {googleEnabled && (
          <>
            <a
              href="/api/auth/google/start"
              className="mb-3 flex touch-manipulation items-center justify-center gap-2.5 rounded-xl border border-line bg-surface py-3.5 text-sm font-semibold text-ink shadow-sm transition hover:border-brand/40 active:scale-[0.99]"
            >
              <GoogleMark />
              Googleでログイン
            </a>
            <div className="mb-3 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[11px] text-ink-soft">または</span>
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

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
            disabled={busy}
            className="mt-1 touch-manipulation rounded-xl bg-brand py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
          >
            {busy
              ? "処理中…"
              : mode === "register"
                ? "アカウントを作成"
                : "ログイン"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-soft/80">
          メールとパスワードで登録すると、別の端末からも同じアカウントでログインできます。
        </p>

        {/* 未ログインでも規約・プライバシー・サポートに辿り着けるようにする（審査担当者もここを見る） */}
        <nav className="mt-5 mb-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-ink-soft">
          <Link href="/legal/support" className="underline underline-offset-4">
            サポート・FAQ
          </Link>
          <Link href="/legal/privacy" className="underline underline-offset-4">
            プライバシーポリシー
          </Link>
          <Link href="/legal/terms" className="underline underline-offset-4">
            利用規約
          </Link>
        </nav>
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
          {account.name.slice(0, 1) || <ChefHat size={24} strokeWidth={2} />}
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

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface py-3 text-sm font-semibold text-ink-soft shadow-sm transition hover:border-brand"
      >
        <HelpCircle className="h-4 w-4" strokeWidth={1.75} />
        使い方を見る
      </button>

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
            まだ記録がありません。レシピの「作った」ボタンで記録されます。
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
            ? "プレミアム：たっぷり使えます（公平利用のため上限あり）。毎月1日リセット。"
            : "無料枠（毎月1日リセット）。AI機能だけ回数制限があります。プレミアムで大幅に増えます（準備中）。"}
        </p>
        <ul className="flex flex-col gap-2.5">
          {(["research", "scan", "import"] as AiKind[]).map((k) => {
            const used = usage.used(k);
            const limit = usage.limitOf(k);
            const pct = Math.min(100, (used / limit) * 100);
            return (
              <li key={k}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-ink">{AI_LABEL[k]}</span>
                  <span className="font-medium text-ink-soft">
                    {used} / {limit}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper">
                  <div
                    className={`h-full rounded-full ${pct >= 100 ? "bg-accent" : "bg-brand"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-2.5 text-[11px] leading-relaxed text-ink-soft">
          同じ条件のレシピが既に見つかっている場合は、AIを使わずに返すので枠を消費しません。
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <p className="text-sm font-semibold text-ink">データについて</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          冷蔵庫・買い物リスト・レシピ・献立履歴はアカウントに紐づけて保存され、別の端末からログインしても引き継がれます。写真はAIの読み取りにだけ使い、サーバーには保存しません。詳しくは
          <Link href="/legal/privacy" className="underline underline-offset-2">
            プライバシーポリシー
          </Link>
          をご覧ください。
        </p>
        <button
          type="button"
          onClick={resetAll}
          className="mt-3 rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
        >
          すべてのデータをリセット
        </button>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">
          冷蔵庫・買い物・献立履歴だけを空にします（アカウントは残ります）。
        </p>

        {/* アカウント削除：App Store審査ガイドライン 5.1.1(v) で
            「アプリ内から削除を開始できること」が必須。 */}
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-sm font-semibold text-ink">アカウントを削除</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            アカウントと、サーバーに保存された全データを完全に削除します。元に戻せません。
          </p>
          {deleteError && <p className="mt-2 text-xs text-red-600">{deleteError}</p>}
          <button
            type="button"
            onClick={deleteAccount}
            disabled={deleting}
            className="mt-3 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {deleting ? "削除中…" : "アカウントを削除する"}
          </button>
        </div>
      </div>

      <nav className="mt-6 mb-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-ink-soft">
        <Link href="/legal/support" className="underline underline-offset-4">
          サポート・FAQ
        </Link>
        <Link href="/legal/privacy" className="underline underline-offset-4">
          プライバシーポリシー
        </Link>
        <Link href="/legal/terms" className="underline underline-offset-4">
          利用規約
        </Link>
      </nav>
    </div>
  );
}
