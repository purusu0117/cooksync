"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { APP_TAGLINE } from "@/lib/brand";
import { clearStoresServer, getUid, setUid } from "@/lib/syncStore";
import { isNativeApp } from "@/lib/native";
import { setGuide } from "@/lib/guide";
import {
  fridgeStore,
  shoppingStore,
  mealStore,
  accountStore,
} from "@/lib/storage";
import { usePersistentList } from "@/lib/useStore";
import { recentMeals } from "@/lib/mealplan";
import {
  useUsage,
  AI_LABEL,
  QUOTA_METER_TITLE,
  quotaMeterNote,
  type AiKind,
} from "@/lib/usage";
import {
  enablePush,
  fetchExpirySettings,
  pushPermissionState,
  saveExpirySettings,
  type ExpiryNotifyConfig,
} from "@/lib/pushClient";
import { Bell, ChefHat, ChevronRight, HelpCircle, Sparkles } from "lucide-react";
import { HISTORY_WEEKS } from "./premium/recapData";
import { getPurchaseAdapter } from "@/lib/premium";
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
  const [fridge] = usePersistentList(fridgeStore);
  const [shopping] = usePersistentList(shoppingStore);
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
  /** ネイティブアプリ（iOS）内で動いているか。Googleログインの出し分けに使う */
  const [native, setNative] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  /** ログイン済みなのにアカウントが読めない状態が続いたか（永久ローディング防止） */
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  /** この端末のID（サポート・復旧用の表示）。マウント後に localStorage から読む */
  const [deviceId, setDeviceId] = useState("");

  // ---- 賞味期限のお知らせ ----
  /** サーバーに保存されている設定と選択肢（読み込み前は null） */
  const [notify, setNotify] = useState<ExpiryNotifyConfig | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState("");
  /** 通知の許可状態。**ここでは絶対にダイアログを出さない**（見に行くだけ） */
  const [perm, setPerm] = useState<"granted" | "denied" | "prompt" | "unsupported">("prompt");

  useEffect(() => {
    // マウント後にlocalStorageのセッションを反映＝外部状態との同期（意図的）。
    /* eslint-disable react-hooks/set-state-in-effect */
    setMounted(true);
    setNative(isNativeApp());
    try {
      setSession(window.localStorage.getItem("cooksync:session") === "1");
      setDeviceId(getUid());
    } catch {
      /* noop */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // 読み込みが終わらないまま放置されるのを防ぐ。4秒で「出口」を出す。
  // （[[system-reliability]] 大翔に再操作を強いない＝黙って固まらせない）
  useEffect(() => {
    if (!session || account) return;
    const t = setTimeout(() => setLoadTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, [session, account]);

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
          return;
        }
        // サーバーが「ログインしていない」と答えた（＝Cookieが無い／期限切れ）のに
        // 端末側だけログイン済みのつもりでいる状態。
        // データの認可はCookieだけで決まるので、このままでは何も読めずに固まる。
        // → 端末側の思い込みを捨てて、すぐログイン画面に戻す（データは消さない）。
        if (window.localStorage.getItem("cooksync:session") === "1") {
          window.localStorage.removeItem("cooksync:session");
          setSession(false);
          setError("ログインの有効期限が切れました。もう一度ログインしてください。");
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

  // 期限通知の設定を読み込む。**許可ダイアログは出さない**（起動時に勝手に聞くと審査で嫌われる）。
  useEffect(() => {
    if (!session) return;
    let alive = true;
    void (async () => {
      const [cfg, p] = await Promise.all([fetchExpirySettings(), pushPermissionState()]);
      if (!alive) return;
      if (cfg) setNotify(cfg);
      setPerm(p);
    })();
    return () => {
      alive = false;
    };
  }, [session]);

  /** 設定を保存して画面に反映する。保存できなければ画面の値も戻す（嘘の表示をしない） */
  async function persistNotify(
    next: ExpiryNotifyConfig["settings"],
    okMessage: string,
  ): Promise<boolean> {
    const ok = await saveExpirySettings(next);
    if (!ok) {
      setNotifyMsg("設定を保存できませんでした。通信を確認して、もう一度お試しください。");
      return false;
    }
    setNotify((prev) => (prev ? { ...prev, settings: next } : prev));
    setNotifyMsg(okMessage);
    return true;
  }

  /** オン/オフ。**許可を求めるのはオンにした直後のここだけ** */
  async function toggleNotify() {
    if (!notify || notifyBusy) return;
    const on = !notify.settings.enabled;
    setNotifyBusy(true);
    setNotifyMsg("");
    try {
      if (on) {
        const granted = await enablePush();
        const state = await pushPermissionState();
        setPerm(state);
        if (!granted) {
          setNotifyMsg(
            state === "denied"
              ? "通知が拒否されています。端末の設定でCookSyncの通知をオンにすると受け取れます。"
              : "通知を有効にできませんでした。時間をおいて、もう一度お試しください。",
          );
          return;
        }
      }
      const next = { ...notify.settings, enabled: on };
      await persistNotify(
        next,
        on
          ? `毎日${next.hour}時に、期限が近い食材をまとめて1通お知らせします。`
          : "期限のお知らせを止めました。通知は届きません。",
      );
    } finally {
      setNotifyBusy(false);
    }
  }

  /** 「何日前に知らせるか」の切り替え。最後の1つは外せない（全部外すと何も届かなくなるため） */
  async function toggleLeadDay(d: number) {
    if (!notify || notifyBusy) return;
    const cur = notify.settings.leadDays;
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b);
    if (next.length === 0) {
      setNotifyMsg("1つ以上を選んでください。当日と期限切れは常にお知らせします。");
      return;
    }
    setNotifyBusy(true);
    try {
      await persistNotify(
        { ...notify.settings, leadDays: next },
        `期限の${next.join("・")}日前に知らせます（当日と期限切れは常に届きます）。`,
      );
    } finally {
      setNotifyBusy(false);
    }
  }

  /** 送る時刻の変更 */
  async function changeNotifyHour(hour: number) {
    if (!notify || notifyBusy) return;
    setNotifyBusy(true);
    try {
      await persistNotify(
        { ...notify.settings, hour },
        `毎日${hour}時にまとめてお知らせします。`,
      );
    } finally {
      setNotifyBusy(false);
    }
  }

  /** 本当に届くかの確認。自分の宛先にだけ1通送る */
  async function sendTestNotification() {
    if (notifyBusy) return;
    setNotifyBusy(true);
    setNotifyMsg("");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        web?: number;
        native?: number;
        error?: string;
      };
      if (!res.ok) {
        setNotifyMsg(data.error || "テスト通知を送れませんでした。");
        return;
      }
      const n = (data.web ?? 0) + (data.native ?? 0);
      setNotifyMsg(
        n > 0
          ? `テスト通知を${n}件の端末に送りました。届いていれば設定は完了です。`
          : "送り先の端末が見つかりませんでした。もう一度オンにし直すと登録されます。",
      );
    } catch {
      setNotifyMsg("通信に失敗しました。時間をおいて、もう一度お試しください。");
    } finally {
      setNotifyBusy(false);
    }
  }

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

  /**
   * ログアウト。
   *
   * ⚠️ 以前は `cooksync:session` を消すだけで、**`cooksync:uid` を前の人の dataId のまま**
   *    残していた（2026-08-01 監査 C-2 の派生）。共用端末では次に開いた人の画面に
   *    前の人の冷蔵庫・レシピ・献立がそのまま出た。
   *    → ログアウトしたら端末IDを**新しいUUIDに振り直す**＝「まっさらな未ログイン端末」に戻す。
   *      サーバー上の本人のデータは消さない（ログインし直せば元通り）。
   */
  async function logout() {
    // サーバー側のセッションCookieを先に破棄する（残るとAIの枠が前の人のままになる）
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    try {
      // 端末に残った前の人のキャッシュを一掃してから、新しい端末IDを割り当てる
      for (const k of Object.keys(window.localStorage)) {
        if (k.startsWith("cooksync:") || k.startsWith("fridge-app:")) {
          window.localStorage.removeItem(k);
        }
      }
      setUid(crypto.randomUUID());
    } catch {
      /* noop */
    }
    setSession(false);
    // ⚠️ ここでストアに書き込んではいけない。uid を振り直した直後なので、
    //    書くと**前の人のアカウント情報が新しい匿名端末の領域にコピーされる**。
    //    アカウント情報はサーバー側（本人の dataId）に残っているので何もしなくてよい。
    // メモリ上のストアにも前の人のデータが載っているので、読み込み直す
    window.location.href = "/mypage";
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
        // ⚠️ logout と同じく端末IDを振り直し、メモリ上のキャッシュも空に戻す。
        //    以前はここが抜けており、削除〜遷移の隙間に再送タイマーが発火すると
        //    メモリに残った旧データが**新しい匿名uidとしてサーバーに再アップロード**される
        //    競合があった（2026-08-01 QA 3周目。「削除は元に戻せません」の約束に反する）。
        setUid(crypto.randomUUID());
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
    // ⚠️ setFridge([]) 等の通常経路で消さない。あちらは3方向マージなので、
    //    端末の同期状態によってはサーバー側の項目が生き残り「削除したのに残る」が起きる
    //    （2026-08-01 QA 3周目）。forced（マージせず空で上書き）の専用経路で消す。
    void clearStoresServer([fridgeStore.key, shoppingStore.key, mealStore.key]);
  }

  // ハイドレーション前は描画しない（SSRと不一致を避ける）
  if (!mounted) return null;

  // ログイン済みだがデータ読込中（別端末でログインした直後のreload後など）
  //
  // ⚠️ 以前はここが **脱出できない永久ローディング** だった（2026-08-01・大翔の「マイページが開けない」）。
  //    localStorage に session=1 が残っているのに account が無いと、この分岐から永遠に出られず、
  //    ログアウトすらできない（ログアウトのボタンはこの下にあるので描画されない）。
  //    consoleにエラーも出ないので原因も分からない。
  //    → 数秒待って読めなければ、**必ず自力で復帰できる出口を出す**。
  if (session && !account) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pt-16 text-center">
        {!loadTimedOut ? (
          <p className="text-sm text-ink-soft">読み込み中…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink">
              アカウント情報を読み込めませんでした。
              <br />
              通信が不安定か、ログイン情報が古くなっている可能性があります。
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[52px] rounded-2xl bg-brand text-[15px] font-bold text-white active:scale-[.98]"
            >
              もう一度読み込む
            </button>
            <button
              type="button"
              onClick={() => {
                // セッションだけ捨ててログイン画面へ戻す。冷蔵庫などのデータは消さない。
                try {
                  window.localStorage.removeItem("cooksync:session");
                } catch {
                  /* noop */
                }
                setSession(false);
              }}
              className="min-h-[52px] rounded-2xl border border-line text-[15px] font-semibold text-ink-soft"
            >
              ログイン画面に戻る
            </button>
          </div>
        )}
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

        {/* Googleログイン。
            ・未設定の環境ではボタン自体を出さない（押すと501になるだけなので）
            ・**ネイティブアプリ（iOS）でも出さない**（2026-08-01 監査 H-12）。
              素の <a> でのフルページ遷移なので WKWebView から Safari に出たきり
              アプリに戻る手段が無く（@capacitor/browser も CFBundleURLTypes も未使用）、
              押した人はログインできないまま詰む。
              審査ガイドライン4.8（外部ログインを出すなら同等の選択肢が要る）も同時に回避できる。
              アプリ版はメール＋パスワードで登録・ログインする。 */}
        {googleEnabled && !native && (
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
              <span className="text-xs text-ink-soft">または</span>
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

        <p className="mt-4 text-center text-xs leading-relaxed text-ink-soft/80">
          メールとパスワードで登録すると、別の端末からも同じアカウントでログインできます。
        </p>

        {/* 未ログインでも規約・プライバシー・サポートに辿り着けるようにする（審査担当者もここを見る） */}
        <nav className="mt-5 mb-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-ink-soft">
          <Link href="/legal/support" className="inline-flex min-h-[44px] items-center px-1 underline underline-offset-4">
            サポート・FAQ
          </Link>
          <Link href="/legal/privacy" className="inline-flex min-h-[44px] items-center px-1 underline underline-offset-4">
            プライバシーポリシー
          </Link>
          <Link href="/legal/terms" className="inline-flex min-h-[44px] items-center px-1 underline underline-offset-4">
            利用規約
          </Link>
        </nav>

        {/* サポート・復旧用の端末ID。ログインできないとき、この端末のデータ領域を
            特定する唯一の手がかりになる（2026-08-01 users.json消失の復旧で必要になった）。
            秘密ではない（自分の端末にしか出ない・他人は使えない）。 */}
        {deviceId && (
          <p className="mb-2 text-center text-[11px] text-ink-soft select-all">
            端末ID: {deviceId}
          </p>
        )}
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
          onClick={() => void logout()}
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
            <p className="mt-0.5 text-xs text-ink-soft">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 賞味期限のお知らせ。
          ・許可を求めるのは「オンにする」を押した直後だけ（起動時には聞かない＝審査対策）
          ・画面のいちばん上には置かない（iPhoneで指が届かない位置に主要操作を置かない） */}
      <div className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <h2 className="mb-1 inline-flex items-center gap-1.5 text-sm font-bold text-ink">
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
          賞味期限のお知らせ
        </h2>
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">
          期限が近い食材を、毎日1回まとめて1通お知らせします。買い物や帰宅の前に気づけるので、使い切れずに捨てるのを防げます。対象が0件の日は送りません。
        </p>

        {perm === "unsupported" ? (
          <p className="rounded-xl bg-paper p-3 text-xs leading-relaxed text-ink-soft">
            この画面では通知を受け取れません。ホーム画面に追加したCookSync、またはアプリ版で開くとオンにできます。
          </p>
        ) : !notify ? (
          <p className="rounded-xl bg-paper p-3 text-xs text-ink-soft">読み込み中…</p>
        ) : (
          <>
            <button
              type="button"
              role="switch"
              aria-checked={notify.settings.enabled}
              onClick={() => void toggleNotify()}
              disabled={notifyBusy}
              className="flex min-h-[52px] w-full touch-manipulation items-center justify-between gap-3 rounded-xl bg-paper px-3.5 text-left transition active:scale-[0.99] disabled:opacity-60"
            >
              <span className="text-sm font-semibold text-ink">
                {notify.settings.enabled
                  ? "期限が近い食材を通知する"
                  : "期限が近い食材を通知する（オフ）"}
              </span>
              <span
                aria-hidden="true"
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                  notify.settings.enabled ? "bg-brand" : "bg-line"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                    notify.settings.enabled ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </span>
            </button>

            {notify.settings.enabled && (
              <div className="mt-3 flex flex-col gap-3">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-ink">何日前に知らせるか</p>
                  <div className="flex flex-wrap gap-2">
                    {notify.choices.leadDays.map((d) => {
                      const on = notify.settings.leadDays.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => void toggleLeadDay(d)}
                          disabled={notifyBusy}
                          className={`min-h-[44px] touch-manipulation rounded-xl border px-3.5 text-xs font-semibold transition disabled:opacity-60 ${
                            on
                              ? "border-brand bg-brand-soft text-brand-dark"
                              : "border-line text-ink-soft"
                          }`}
                        >
                          {d}日前
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                    当日と期限切れは、選ばなくても必ずお知らせします。
                  </p>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink">
                    知らせる時刻（帰宅前に気づける夕方がおすすめ）
                  </span>
                  <select
                    value={notify.settings.hour}
                    onChange={(e) => void changeNotifyHour(Number(e.target.value))}
                    disabled={notifyBusy}
                    className={`${fieldClass} min-h-[44px] disabled:opacity-60`}
                  >
                    {notify.choices.hours.map((h) => (
                      <option key={h} value={h}>
                        毎日 {h}:00 に知らせる
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => void sendTestNotification()}
                  disabled={notifyBusy}
                  className="min-h-[44px] touch-manipulation rounded-xl border border-line px-4 text-xs font-semibold text-ink-soft transition hover:border-brand disabled:opacity-60"
                >
                  テスト通知を自分に送って確認する
                </button>
              </div>
            )}

            {notifyMsg && (
              <p className="mt-2.5 text-xs leading-relaxed text-ink-soft">{notifyMsg}</p>
            )}
          </>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <h2 className="mb-1 inline-flex items-center gap-1.5 text-sm font-bold text-ink">
          <AppIcon name="check" size={18} />
          最近作ったもの
        </h2>
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">
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
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[12px] font-medium text-amber-700">
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
        {/* ⚠️ 文言を直書きしない。枠は**週次**（毎週月曜リセット）に変わっており、
            ここに「今月」「毎月1日」と書くと画面が嘘をつく。
            期間の言い回しは src/lib/usage.ts に1本化してあり、テストで固定されている。 */}
        <h2 className="mb-1 text-sm font-bold text-ink">{QUOTA_METER_TITLE}</h2>
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">
          {quotaMeterNote(usage.premium)}
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
        <p className="mt-2.5 text-xs leading-relaxed text-ink-soft">
          同じ条件のレシピが既に見つかっている場合は、AIを使わずに返すので枠を消費しません。
        </p>
      </div>

      {/* プレミアムの常設エントリ（premium.ts の PaywallPlacement "mypage"）。
          枠切れシートと違って、いつでも自分から見に行ける入口。ここでは売り込まない。
          読むのは既存ユーザーなので、特典の中身に踏み込んでよい（copywriting-audience.md）。
          ⚠️ **ネイティブアプリでは、課金が「準備中」のあいだ出さない**（審査 2.1: 未完成の
          機能を審査員に触らせない）。Webは審査対象外なので正直に「準備中」を出してよい。 */}
      {(!native || usage.premium || getPurchaseAdapter().available()) && (
      <div className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <h2 className="mb-1 inline-flex items-center gap-1.5 text-sm font-bold text-ink">
          <Sparkles className="h-[18px] w-[18px] text-accent-dark" strokeWidth={1.75} />
          プレミアム
        </h2>
        {usage.premium ? (
          <p className="mb-3 text-xs leading-relaxed text-ink-soft">
            ご利用中です。解約や更新日の確認は、iPhoneの「設定 → Apple ID →
            サブスクリプション」から行えます。
          </p>
        ) : (
          <p className="mb-3 text-xs leading-relaxed text-ink-soft">
            AIの回数を増やして、作った料理の記録を過去{HISTORY_WEEKS}
            週ぶんさかのぼれるプランです。無料でできることは変わりません。
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Link
            href="/premium"
            className="flex min-h-[48px] items-center justify-between gap-2 rounded-xl bg-paper px-3.5 text-sm font-semibold text-ink transition active:scale-[0.99]"
          >
            {usage.premium ? "プレミアムの内容を見る" : "プレミアムでできることを見る"}
            <ChevronRight size={16} className="shrink-0 text-ink-soft" />
          </Link>
          <Link
            href="/premium/recap"
            className="flex min-h-[48px] items-center justify-between gap-2 rounded-xl bg-paper px-3.5 text-sm font-semibold text-ink transition active:scale-[0.99]"
          >
            作った料理の記録
            <ChevronRight size={16} className="shrink-0 text-ink-soft" />
          </Link>
        </div>
      </div>
      )}

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
        <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
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
        <Link href="/legal/support" className="inline-flex min-h-[44px] items-center px-1 underline underline-offset-4">
          サポート・FAQ
        </Link>
        <Link href="/legal/privacy" className="inline-flex min-h-[44px] items-center px-1 underline underline-offset-4">
          プライバシーポリシー
        </Link>
        <Link href="/legal/terms" className="inline-flex min-h-[44px] items-center px-1 underline underline-offset-4">
          利用規約
        </Link>
      </nav>
    </div>
  );
}
