"use client";

// 課金画面（/premium）。**読むのは比較検討中の人**なので、他とどう違うかを書いてよい。
// 初見向けの文言（ホーム・App Storeのサブタイトル）とは分けてある。
//   → Preferences/copywriting-audience.md ／ src/lib/brand.ts のコメント
//
// ⚠️ App Store 審査で見られるところ（ガイドライン 3.1.2）:
//   ・プランの名前 / 期間 / 期間ごとの価格 を**この画面に**書く
//   ・利用規約(EULA)とプライバシーポリシーへのリンクを**この画面に**置く
//   ・「購入を復元」を必ず用意する（機種変更・再インストールで払い直させない）
// ⚠️ ガイドライン 3.1.1: **アプリ内から外部の決済ページへ誘導しない。**
//   「Webなら安い」等のリンクを1つでも置くとリジェクト対象。EXTERNAL_PAYMENT_URL は null 固定。

import { useState } from "react";
import Link from "next/link";
import { Check, Clock, Sparkles } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { PLANS, type PlanId } from "@/lib/pricing";
import {
  FREE_KEEPS_TITLE,
  PLANNED_SECTION_TITLE,
  PREMIUM_HEADLINE,
  PREMIUM_SUBHEAD,
  getPurchaseAdapter,
  plannedFeatures,
  sellableFeatures,
} from "@/lib/premium";
import { useUsage } from "@/lib/usage";

export default function PremiumScreen() {
  const { premium } = useUsage();
  const [plan, setPlan] = useState<PlanId>("yearly");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const adapter = getPurchaseAdapter();
  const ready = adapter.available();

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await fn();
      // 成功したときは何も言わない（画面が「ご利用中」に変わるのが返事になる）
      if (!r.ok) setMessage(r.message ?? "うまくいきませんでした。時間をおいてお試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-4">
      <PageHeader
        title="プレミアム"
        tagline={PREMIUM_HEADLINE}
        Icon={Sparkles}
        iconClass="text-accent-dark"
      />

      <p className="mb-6 text-sm leading-relaxed text-ink">{PREMIUM_SUBHEAD}</p>

      {premium ? (
        <div className="mb-6 rounded-2xl border border-brand bg-brand-soft p-4">
          <p className="text-sm font-bold text-brand-dark">ご利用中です</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            解約や更新日の確認は、iPhoneの「設定 → Apple ID → サブスクリプション」から行えます。
          </p>
        </div>
      ) : (
        <>
          {/* --- プラン選択。価格・期間はここに必ず書く（3.1.2） --- */}
          <div className="mb-4 flex flex-col gap-2.5">
            {PLANS.map((p) => {
              const selected = plan === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlan(p.id)}
                  aria-pressed={selected}
                  className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                    selected
                      ? "border-brand bg-brand-soft"
                      : "border-line bg-surface hover:bg-paper"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      selected ? "border-brand bg-brand" : "border-line"
                    }`}
                  >
                    {selected && <Check size={12} strokeWidth={3} className="text-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-bold text-ink">{p.label}</span>
                      {p.recommended && (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent-dark">
                          おすすめ
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-soft">{p.note}</span>
                  </span>
                  <span className="shrink-0 text-base font-bold text-brand-dark tabular-nums">
                    ¥{p.priceYen.toLocaleString("ja-JP")}
                  </span>
                </button>
              );
            })}
          </div>

          {/* --- 購入ボタン。**押しても何も起きない偽ボタンにしない。**
                 課金アイテムが未登録のあいだは「準備中」と正直に出す。 --- */}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => adapter.purchase(plan))}
            className={`min-h-[52px] w-full rounded-2xl text-[15px] font-bold transition active:scale-[.98] disabled:opacity-60 ${
              ready ? "bg-brand text-white" : "border border-line bg-surface text-ink-soft"
            }`}
          >
            {ready ? "プレミアムを始める" : "準備中（もうすぐ受付を開始します）"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => adapter.restore())}
            className="mt-2 min-h-[44px] w-full rounded-2xl text-xs font-medium text-ink-soft underline underline-offset-2 disabled:opacity-60"
          >
            購入を復元する
          </button>

          {message && (
            <p
              role="status"
              className="mt-2 rounded-xl bg-paper p-3 text-xs leading-relaxed text-ink"
            >
              {message}
            </p>
          )}
        </>
      )}

      {/* --- 今すぐ使えるもの。**planned は絶対に混ぜない**（2.3.1・実装にない機能を謳わない） --- */}
      <section className="mt-7">
        <h2 className="mb-2.5 text-base font-bold text-brand-dark">プレミアムでできること</h2>
        <ul className="flex flex-col gap-2.5">
          {sellableFeatures().map((f) => (
            <li key={f.id} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
              <p className="flex items-start gap-2 text-sm font-bold text-ink">
                <Check size={16} strokeWidth={2.5} className="mt-0.5 shrink-0 text-brand" />
                <span>{f.title}</span>
              </p>
              <p className="mt-1.5 pl-6 text-xs leading-relaxed text-ink-soft">{f.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* --- 無料のままできること。**これを出すこと自体が「弱くしていない」の証明**。 --- */}
      <section className="mt-6">
        <h2 className="mb-2.5 text-base font-bold text-brand-dark">{FREE_KEEPS_TITLE}</h2>
        <ul className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 shadow-sm">
          {sellableFeatures().map((f) => (
            <li key={f.id} className="text-xs leading-relaxed text-ink-soft">
              ・{f.freeKeeps}
            </li>
          ))}
        </ul>
      </section>

      {/* --- まだ無いもの。「使えます」と読めない見出しにする --- */}
      <section className="mt-6">
        <h2 className="mb-2.5 text-base font-bold text-ink-soft">{PLANNED_SECTION_TITLE}</h2>
        <ul className="flex flex-col gap-2">
          {plannedFeatures().map((f) => (
            <li
              key={f.id}
              className="flex items-start gap-2 rounded-xl bg-paper px-3 py-2.5 text-xs leading-relaxed text-ink-soft"
            >
              <Clock size={14} className="mt-0.5 shrink-0" />
              <span>
                <b className="font-semibold text-ink">{f.title}</b>
                <br />
                {f.detail}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* --- 3.1.2 の必須表示。自動更新・解約導線・規約 --- */}
      <section className="mt-6 mb-2 rounded-2xl border border-line bg-surface p-4">
        <p className="text-xs leading-relaxed text-ink-soft">
          月額プランは1ヶ月ごと、年額プランは1年ごとの自動更新です。更新日の24時間前までに解約しない場合は自動的に更新されます。解約はiPhoneの「設定
          → Apple ID → サブスクリプション」からいつでも行えます。表示価格は税込です。
        </p>
        <p className="mt-2 flex gap-3 text-xs">
          <Link href="/legal/terms" className="underline underline-offset-2 text-ink-soft">
            利用規約
          </Link>
          <Link href="/legal/privacy" className="underline underline-offset-2 text-ink-soft">
            プライバシーポリシー
          </Link>
        </p>
      </section>
    </div>
  );
}
