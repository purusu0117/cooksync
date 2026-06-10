import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import AppIcon, { type IconName } from "@/components/AppIcon";

export const metadata: Metadata = {
  title: "CookSync｜冷蔵庫から献立まで、ぜんぶ半自動。",
  description:
    "賞味期限が近い食材からAIが献立を提案。写真で在庫登録、買い物リストも在庫管理も半自動。フードロスを減らし、毎日の献立に悩まないキッチンアプリ。",
};

const STEPS: { icon: IconName; title: string; desc: string }[] = [
  { icon: "fridge", title: "冷蔵庫の在庫", desc: "写真を撮るだけで登録。期限は自動推定。" },
  { icon: "meal", title: "AIが献立提案", desc: "期限が近い食材から、人気レシピを提案。" },
  { icon: "shopping", title: "買い物リスト", desc: "足りない食材だけ自動でリスト化。" },
  { icon: "fridge", title: "在庫へ自動反映", desc: "買ったらタップ一つで冷蔵庫へ。" },
  { icon: "check", title: "作ったら自動で減る", desc: "使った食材を在庫から自動で消費。" },
];

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  {
    icon: "camera",
    title: "写真で登録、入力ゼロ",
    desc: "冷蔵庫や食材を撮るだけ。AIが食材名を読み取り、賞味期限とカテゴリを自動で推定します。",
  },
  {
    icon: "signal",
    title: "賞味期限を見える化",
    desc: "期限が近い順に並び、今日使うべき食材がひと目で。食材を使い切ってフードロスを減らせます。",
  },
  {
    icon: "meal",
    title: "AIが実在レシピを提案",
    desc: "期限が近い食材を活かす人気レシピを、つくれぽ数・再生数など“人気の根拠”つきで提案。3案は使う食材を分散。",
  },
  {
    icon: "loop",
    title: "買い物も在庫も自動連携",
    desc: "不足は買い物リストへ→買ったら在庫へ→作ったら減る。在庫→献立→買い物→在庫がぐるっと半自動で回ります。",
  },
  {
    icon: "star",
    title: "好みを学習",
    desc: "星評価で提案が自分仕様に。直近に作った料理は自動で避けるので、献立がマンネリ化しません。",
  },
  {
    icon: "timer",
    title: "調理タイマー＆通知",
    desc: "複数同時にかけられ、アプリを離れていても完了を通知。レシピの写真もAIが自動生成します。",
  },
];

const GALLERY = [
  "/recipes/nasu-teriyaki.png",
  "/recipes/mixed-mushroom-spaghetti.png",
  "/recipes/bacon-cherry-tomato-pasta.png",
  "/recipes/ryuji-chicken-tomato-stew.png",
  "/recipes/shiodare-cabbage-pork-bowl.png",
  "/recipes/garlic-miso-smashed-cucumber.png",
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Hero */}
      <section className="relative h-[78vh] min-h-[520px] w-full overflow-hidden">
        <Image
          src="/lp/hero.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/30 to-ink/10" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <Image
            src="/cooksync-logo.svg"
            alt="CookSync"
            width={220}
            height={125}
            priority
            className="mb-4 h-auto w-[180px] drop-shadow"
          />
          <h1 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight text-white drop-shadow sm:text-5xl">
            冷蔵庫から献立まで、
            <br />
            ぜんぶ<span className="text-[#8be0a8]">半自動</span>。
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/90 drop-shadow sm:text-base">
            賞味期限が近い食材から、AIが今日の献立を提案。
            <br className="hidden sm:block" />
            写真で在庫登録、買い物リストも在庫管理も、ほぼ手間ゼロ。
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/"
              className="rounded-full bg-brand px-8 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-brand-dark active:scale-95"
            >
              アプリを使ってみる
            </Link>
            <a
              href="#features"
              className="rounded-full bg-white/90 px-8 py-3 text-sm font-bold text-brand-dark shadow-lg transition hover:bg-white"
            >
              できること
            </a>
          </div>
        </div>
      </section>

      {/* 半自動ループ */}
      <section className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
        <p className="text-center text-sm font-semibold text-brand">CORE</p>
        <h2 className="mt-1 text-center text-2xl font-bold tracking-tight sm:text-3xl">
          ほぼ手間ゼロで、ぐるっと1周。
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-ink-soft">
          各ステップが自動でつながるから、「在庫管理→献立→買い物→また在庫」が回り続けます。
        </p>
        <ol className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-5">
          {STEPS.map((s, i) => (
            <li
              key={i}
              className="relative rounded-2xl border border-line bg-surface p-5 text-center shadow-sm"
            >
              <AppIcon name={s.icon} size={44} className="mx-auto" />
              <p className="mt-2 text-sm font-bold text-ink">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{s.desc}</p>
              {i < STEPS.length - 1 && (
                <span className="pointer-events-none absolute -right-3 top-1/2 hidden -translate-y-1/2 text-xl text-brand sm:block">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* Features */}
      <section id="features" className="bg-surface/60 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            CookSync の特長
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className="rounded-2xl border border-line bg-surface p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <AppIcon name={f.icon} size={40} />
                <h3 className="mt-3 text-base font-bold text-ink">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI写真ギャラリー */}
      <section className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
          レシピの写真も、AIが自動生成
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-ink-soft">
          提案されたレシピには、おいしそうな料理写真が自動で付きます。
        </p>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {GALLERY.map((src) => (
            <div
              key={src}
              className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-line shadow-sm"
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
      </section>

      {/* CTA */}
      <section className="bg-brand py-16 text-center text-white sm:py-20">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            食材を、最後までおいしく使い切る。
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/90">
            献立に悩む時間も、食材を捨てる罪悪感も、もういらない。
          </p>
          <Link
            href="/"
            className="mt-7 inline-block rounded-full bg-white px-9 py-3 text-sm font-bold text-brand-dark shadow-lg transition hover:bg-paper active:scale-95"
          >
            CookSync を使ってみる
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line bg-paper py-10">
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
          <p className="mt-1 text-[11px] text-ink-soft/70">
            © 2026 CookSync
          </p>
        </div>
      </footer>
    </div>
  );
}
