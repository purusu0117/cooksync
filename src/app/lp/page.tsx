import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import {
  Camera,
  Flame,
  Clock,
  Leaf,
  ChefHat,
  Recycle,
  Star,
  Timer,
  Refrigerator,
  ShoppingCart,
  CookingPot,
  PackageCheck,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";

export const metadata: Metadata = {
  title: "CookSync｜AIが、冷蔵庫をシェフにする。",
  description:
    "賞味期限が近い食材からAIが献立を提案。写真で在庫登録、買い物リストも在庫管理も半自動。フードロスを減らし、毎日の献立に悩まないキッチンアプリ。",
};

const FEATURES: {
  Icon?: LucideIcon;
  freshness?: boolean;
  title: string;
  desc: string;
  color: string; // アイコン色
  tint: string; // 円タイル背景（淡色・境目が溶けるよう薄め）
}[] = [
  {
    Icon: Camera,
    title: "写真で登録、入力ゼロ",
    desc: "冷蔵庫や食材を撮るだけ。AIが食材名を読み取り、賞味期限とカテゴリを自動で推定します。",
    color: "text-sky-600",
    tint: "bg-sky-50",
  },
  {
    freshness: true,
    title: "賞味期限を見える化",
    desc: "近い・そろそろ・余裕を色で見える化。期限が近い順に並び、使い切りを後押しします。",
    color: "",
    tint: "bg-paper",
  },
  {
    Icon: ChefHat,
    title: "AIが実在レシピを提案",
    desc: "期限が近い食材を活かす人気レシピを、つくれぽ数・再生数など“人気の根拠”つきで。3案は食材を分散。",
    color: "text-accent-dark",
    tint: "bg-accent-soft",
  },
  {
    Icon: Recycle,
    title: "買い物も在庫も自動で循環",
    desc: "不足は買い物リストへ→買ったら在庫へ→作ったら減る。ぐるっと半自動で回り続けます。",
    color: "text-brand",
    tint: "bg-brand-soft",
  },
  {
    Icon: Star,
    title: "好みを学習",
    desc: "星評価で提案が自分仕様に。直近に作った料理は自動で避け、マンネリ化を防ぎます。",
    color: "text-amber-500",
    tint: "bg-amber-50",
  },
  {
    Icon: Timer,
    title: "調理タイマー＆通知",
    desc: "複数同時にかけられ、アプリを離れていても完了を通知。レシピ写真もAIが自動生成。",
    color: "text-rose-500",
    tint: "bg-rose-50",
  },
];

const STEPS: { n: string; Icon: LucideIcon; title: string; desc: string }[] = [
  { n: "01", Icon: Refrigerator, title: "冷蔵庫に登録", desc: "写真を撮るだけ。賞味期限も自動で推定。" },
  { n: "02", Icon: CookingPot, title: "AIが献立を提案", desc: "期限が近い食材から、人気レシピを3案。" },
  { n: "03", Icon: ShoppingCart, title: "不足を買い物リストへ", desc: "足りない食材だけ自動でリスト化。" },
  { n: "04", Icon: PackageCheck, title: "買ったら在庫へ", desc: "購入チェックで冷蔵庫に自動反映。" },
  { n: "05", Icon: CheckCircle2, title: "作ったら在庫が減る", desc: "使った食材を自動で消費。そしてまた01へ。" },
];

const GALLERY = [
  "/recipes/nasu-teriyaki.png",
  "/recipes/mixed-mushroom-spaghetti.png",
  "/recipes/bacon-cherry-tomato-pasta.png",
  "/recipes/ryuji-chicken-tomato-stew.png",
  "/recipes/shiodare-cabbage-pork-bowl.png",
  "/recipes/garlic-miso-smashed-cucumber.png",
];

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-center text-xs font-bold uppercase tracking-[0.25em] text-brand">
      {children}
    </p>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-paper text-ink">
      {/* ===== Hero（編集系・上品） ===== */}
      <section className="relative overflow-hidden px-6 pt-14 pb-8">
        {/* 背景の淡い装飾 */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-brand-soft/70 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-40 -left-20 h-60 w-60 rounded-full bg-accent-soft/50 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <Image
            src="/cooksync-logo.svg"
            alt="CookSync"
            width={260}
            height={148}
            priority
            className="mx-auto h-auto w-[210px]"
          />
          <h1 className="font-display mt-5 text-4xl font-extrabold leading-tight tracking-tight text-brand-dark sm:text-5xl">
            AIが、冷蔵庫を
            <br className="sm:hidden" />
            シェフにする。
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink-soft sm:text-base">
            賞味期限が近い食材から、今日の献立をAIが提案。
            <br className="hidden sm:block" />
            写真で在庫登録、買い物リストも在庫管理も、ほぼ手間ゼロ。
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/"
              className="w-full rounded-full bg-brand px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-dark active:scale-95 sm:w-auto"
            >
              今すぐ始める（無料）
            </Link>
            <a
              href="#features"
              className="w-full rounded-full border border-line bg-surface px-8 py-3.5 text-sm font-bold text-brand-dark transition hover:border-brand sm:w-auto"
            >
              できること
            </a>
          </div>

          {/* ヒーロー写真（フレーム） */}
          <div className="relative mt-10 overflow-hidden rounded-[28px] border border-line shadow-xl">
            <Image
              src="/lp/hero.png"
              alt=""
              width={1200}
              height={675}
              priority
              className="h-auto w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* ===== 主な機能 ===== */}
      <section id="features" className="px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <Kicker>Features</Kicker>
          <h2 className="font-display mt-2 text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            毎日の「何作ろう」を、なくす。
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => {
              const Icon = f.Icon;
              return (
                <div
                  key={i}
                  className="group rounded-3xl border border-line bg-surface p-7 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                >
                  <span
                    className={`mx-auto grid h-20 w-20 place-items-center rounded-full ${f.tint} transition group-hover:scale-105`}
                  >
                    {f.freshness ? (
                      <span className="flex items-center gap-1.5">
                        <Flame size={22} className="text-red-500" strokeWidth={1.9} />
                        <Clock size={22} className="text-amber-500" strokeWidth={1.9} />
                        <Leaf size={22} className="text-brand" strokeWidth={1.9} />
                      </span>
                    ) : (
                      Icon && (
                        <Icon size={34} className={f.color} strokeWidth={1.7} />
                      )
                    )}
                  </span>
                  <h3 className="mt-5 text-base font-bold text-ink">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== ぐるっと1周（4-5ステップの流れ） ===== */}
      <section className="bg-surface/70 px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-2xl">
          <Kicker>How it works</Kicker>
          <h2 className="font-display mt-2 text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            ほぼ手間ゼロで、ぐるっと1周。
          </h2>
          <p className="mx-auto mt-3 max-w-md text-center text-sm text-ink-soft">
            各ステップが自動でつながり、在庫→献立→買い物→在庫が回り続けます。
          </p>
          <ol className="relative mt-12 space-y-5">
            {/* 縦の接続ライン */}
            <span
              aria-hidden
              className="absolute left-[39px] top-4 bottom-4 w-px bg-line sm:left-[43px]"
            />
            {STEPS.map((s) => {
              const Icon = s.Icon;
              return (
              <li key={s.n} className="relative flex items-center gap-4">
                <span className="relative z-10 grid h-20 w-20 shrink-0 place-items-center rounded-full border border-line bg-surface shadow-sm sm:h-[84px] sm:w-[84px]">
                  <Icon size={34} className="text-brand" strokeWidth={1.7} />
                </span>
                <div className="min-w-0 flex-1 rounded-2xl border border-line bg-paper px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg font-extrabold text-brand">
                      {s.n}
                    </span>
                    <h3 className="text-sm font-bold text-ink">{s.title}</h3>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">{s.desc}</p>
                </div>
              </li>
              );
            })}
          </ol>
          <p className="mt-6 flex items-center justify-center gap-2 text-xs font-semibold text-brand">
            <Recycle size={18} strokeWidth={1.9} />
            そしてまた最初へ。半自動でずっと回る。
          </p>
        </div>
      </section>

      {/* ===== ギャラリー ===== */}
      <section className="px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <Kicker>Gallery</Kicker>
          <h2 className="font-display mt-2 text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            レシピの写真も、AIが自動生成。
          </h2>
          <p className="mx-auto mt-3 max-w-md text-center text-sm text-ink-soft">
            提案されたレシピには、おいしそうな料理写真が自動で付きます。
          </p>
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {GALLERY.map((src) => (
              <div
                key={src}
                className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-line shadow-sm transition hover:-translate-y-1 hover:shadow-md"
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 50vw, 320px"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-[32px] bg-brand px-8 py-14 text-center text-white shadow-xl">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            食材を、最後までおいしく使い切る。
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/90">
            献立に悩む時間も、食材を捨てる罪悪感も、もういらない。
          </p>
          <Link
            href="/"
            className="mt-8 inline-block rounded-full bg-white px-10 py-3.5 text-sm font-bold text-brand-dark shadow-lg transition hover:bg-paper active:scale-95"
          >
            CookSync を始める
          </Link>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="border-t border-line py-10">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <Image
            src="/cooksync-logo.svg"
            alt="CookSync"
            width={140}
            height={80}
            className="mx-auto h-auto w-[120px] opacity-80"
          />
          <p className="mt-3 text-xs text-ink-soft">
            個人開発のキッチンアプリ。Next.js / TypeScript / ローカルAI（Claude）で構築。
          </p>
          <p className="mt-1 text-[11px] text-ink-soft/70">© 2026 CookSync</p>
        </div>
      </footer>
    </div>
  );
}
