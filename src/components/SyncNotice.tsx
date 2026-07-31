"use client";

// 同期の状態を「隠さずに」出すための共通表示。
//
// 方針（.secretary/Preferences/system-reliability.md）：
//   「もう一度送ってね」はNG。自動再開＋上限つきリトライで完遂し、
//   エラーは**「伝える」＋「自動でやり直し中」をセットで**通知する。
// なので文言は必ず「いま起きていること」＋「勝手に直す」を両方書く。
// 手動の再試行ボタンは、待ちたくない人のための近道であって、必須の操作ではない。

import { CloudOff, LogIn, RefreshCw } from "lucide-react";
import Link from "next/link";
import { retryNow, useSyncState } from "@/lib/syncStore";

export default function SyncNotice() {
  const { offline, authRequired, pending, hydrated } = useSyncState();

  // 通信できていて、送り残しも無い＝いつも通り。何も出さない。
  if (!offline && pending === 0) return null;
  // 起動直後の一瞬（まだ1回目の通信が終わっていないだけ）で騒がない
  if (!hydrated && !offline) return null;

  // ⚠️ セッション切れは「オフライン」と別物。ここを分けないと、実際はオンラインなのに
  //    「接続が戻り次第、自動で送ります」と**嘘**が出る（自動再送は止まっている）。
  //    直す手段（ログインし直す）を出さないと、ユーザーは待ち続けることになる。
  if (authRequired) {
    return (
      <div
        role="status"
        className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3"
      >
        <LogIn size={16} strokeWidth={2.2} className="mt-0.5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">ログインの有効期限が切れました</p>
          <p className="mt-0.5 text-xs text-amber-800">
            変更はこの端末に保存済みです（未送信 {pending} 件）。
            ログインし直すと、そのまま送られます。
          </p>
          <Link
            href="/mypage"
            className="mt-2.5 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-amber-700 px-4 text-xs font-bold text-white"
          >
            <LogIn size={14} strokeWidth={2.4} />
            マイページでログインし直す
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <CloudOff size={16} strokeWidth={2.2} className="mt-0.5 shrink-0 text-amber-700" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-900">
          {offline ? "オフラインです" : "サーバーに送信中です"}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-amber-900/80">
          {pending > 0
            ? `変更はこの端末に保存済みです（未送信 ${pending} 件）。接続が戻り次第、自動で送ります。`
            : "接続が戻り次第、自動で読み込み直します。データは消えていません。"}
        </p>
      </div>
      <button
        type="button"
        onClick={retryNow}
        className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 active:scale-95"
      >
        <RefreshCw size={13} strokeWidth={2.4} />
        今すぐ再試行
      </button>
    </div>
  );
}

/**
 * 「まだ読めていない」ときの置き換え表示。
 * ★ここが無かったせいで、40件あっても起動中は「まだ食材がありません」と出ていた。
 *   圏外だとその表示のまま永久に変わらず、データが消えたようにしか見えなかった。
 */
export function LoadingOrOffline({ label }: { label: string }) {
  const { offline, error } = useSyncState();
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-10 text-center"
    >
      {offline ? (
        <>
          <p className="text-sm font-semibold text-ink">
            オフラインのため{label}を読み込めていません
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            電波が届く場所に戻ると、自動で読み込み直します。
            <br />
            データは消えていません。
          </p>
          <button
            type="button"
            onClick={retryNow}
            className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink transition hover:bg-paper active:scale-95"
          >
            <RefreshCw size={14} strokeWidth={2.4} />
            今すぐ再試行
          </button>
          {error && <p className="mt-2 text-xs text-ink-soft/70">({error})</p>}
        </>
      ) : (
        <>
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
          <p className="text-sm font-semibold text-ink">{label}を読み込んでいます…</p>
        </>
      )}
    </div>
  );
}
