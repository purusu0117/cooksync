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
  TriangleAlert,
  Link2,
  ScanLine,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { APP_NAME, APP_TAGLINE, APP_PROMISE } from "@/lib/brand";
// 「あと3つ」の3は starter.ts の定数。LPだけ数字が古くなる事故を防ぐため直に取る。
import { SUGGEST_THRESHOLD } from "@/lib/starter";

export const metadata: Metadata = {
  title: `${APP_NAME}｜${APP_TAGLINE}`,
  // 検索結果に出る2〜3行。前半＝初見に通じる悩み、後半＝比較検討層向けの差別化、の順。
  description:
    "今日なに作るかは、家にあるものだけで決まります。冷蔵庫の食材を入れると、それだけで作れる料理を提案し、足りない分は店で買える単位で買い物リストへ。読み取れなかった分量は「読み取れなかった」と書き、参考にしたページのURLも必ず残す、レシピ・冷蔵庫アプリ。",
};

/* ============================================================
   ここに書いてあることは全部、実装済みの画面から取った文言です。
   （出典：ImportedRecipePreview.tsx / RecipeDetail.tsx /
     MealWizard.tsx / RecipeSources.tsx / lib/recipeScale.ts / lib/ai.ts）
   実装に無いことは書かない。書き足すときは必ずコードを見てから。

   ★ 文言の置き場所（2026-08-01・Preferences/copywriting-audience.md）
     ・ヒーロー＝**初見の人**。夕食の悩み1位「献立を考えること」65.8% を肯定形で言い当てる。
       ここに「AIが勝手に、分量を変えない」（＝否定形・競合の失点が前提）を置いていたのが失敗。
       初見の人は「AIが分量を変える」現象自体を知らないので意味が通らなかった。
     ・#proof 以降＝**比較検討中の人**。ここまでスクロールした人は他アプリと比べている。
       差別化（分量・出典・在庫厳守・人数換算）は捨てず、この位置に下ろした。
   ============================================================ */

/** ヒーロー直下の「証拠」。アプリが実際に出す文言をそのまま並べる。 */
const PROOFS: {
  Icon: LucideIcon;
  label: string;
  headline: string;
  /** アプリ内の実物の文言 */
  quote: React.ReactNode;
  note: string;
  tone: "warn" | "brand";
}[] = [
  {
    Icon: TriangleAlert,
    label: "読み取れなかったとき",
    headline: "推測で埋めない。",
    quote: (
      <>
        ⚠ 分量が読み取れなかった材料：みりん、砂糖
        <br />
        保存後にレシピを開いて、元の動画・写真を見ながら直してください。
      </>
    ),
    note: "AIには「書かれていないことを推測で埋めない」と指示しています。読めなかった材料は名前を挙げて警告し、分量欄も「確認できず」と表示します。",
    tone: "warn",
  },
  {
    Icon: ScanLine,
    label: "どれくらい自信があるか",
    headline: "確度も一緒に出す。",
    quote: <>一部は読み取れなかったので確認してください</>,
    note: "取り込みごとに3段階で自己申告します。確度が低いときは「分量は必ず元の動画・写真で確認してください」とはっきり書きます。",
    tone: "warn",
  },
  {
    Icon: Link2,
    label: "どこから来たレシピか",
    headline: "出典のURLを必ず残す。",
    quote: (
      <>
        参考にしたページ
        <br />
        <span className="underline underline-offset-2">
          リュウジのバズレシピ 至高を超えた回鍋肉
        </span>
      </>
    ),
    note: "AIには「実在のレシピを参照し、出典のない創作は禁止。出典が空の候補は出さない」と指示しています。つくれぽ数・再生数が分かれば一緒に添えます。それでも出典が付かなかったときは、見出しごと消さずに「このレシピには参考ページが記録されていません。」と正直に書きます。",
    tone: "brand",
  },
];

/** 差別化の2本柱（在庫厳守／人数スケール）。 */
const PILLARS: {
  Icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
}[] = [
  {
    Icon: Refrigerator,
    eyebrow: "在庫厳守モード",
    title: "「冷蔵庫にあるものだけ」を、本当に守る。",
    // 実装：MealWizard の shopMode。在庫が1つでもあれば初期選択は "stock"（0件のときだけ "buy"）。
    body: "冷蔵庫に食材が入っていれば、献立提案は最初から「在庫だけで作る」で始まります。塩・しょうゆなどの基本調味料以外は、冷蔵庫に無い食材を使わせません。",
    points: [
      "買い足したい日は「買い物してもOK」に1タップで切り替え",
      "足りない分だけを「1パック」「1束」など店で買える単位で買い物リストへ",
      "作り終わって「作った」を押すと、使った分だけ在庫が減る（取り消しも可）",
    ],
  },
  {
    Icon: Users,
    eyebrow: "人数の自動換算",
    title: "手順の文章の中の分量まで、書き換わる。",
    body: "1〜4人分を選ぶと、材料表だけでなく手順文とkcalまで換算します。AIを呼ばない計算なので、利用枠を使いません。",
    points: [
      "「大さじ1」「80〜90g」「1と1/2個」も読める形のまま換算",
      "手順の「5分煮る」など時間・温度は換算しない（分量だけを直す）",
      "増やすときは「調味料は7〜8割から入れて味を見て」と注意も表示",
    ],
  },
];

/** レシピの入れ方3つ（動画取り込みはここに置く。看板にはしない）。 */
const SOURCES: { Icon: LucideIcon; title: string; desc: string }[] = [
  {
    Icon: ChefHat,
    title: "AIに提案してもらう",
    desc: "冷蔵庫の食材と、気分・調理時間・人数から3案。期限が近い食材から優先して使います。",
  },
  {
    Icon: Video,
    title: "動画のURLから",
    desc: "YouTube・TikTokの料理動画を貼るだけ。概要欄と字幕から材料と手順を書き起こします。",
  },
  {
    Icon: Camera,
    title: "写真から",
    desc: "レシピ本のページ、SNSのスクショ、手書きメモを4枚まで。順番がバラバラでも並べ直します。",
  },
];

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
    title: "レシピに合わせて自動タイマー",
    desc: "手順の「○分」をAIが読み取り、ワンタップで使えるタイマーを自動セット。複数同時OK、離れていても完了を通知します。",
    color: "text-rose-500",
    tint: "bg-rose-50",
  },
  {
    Icon: PackageCheck,
    title: "余った分の保存方法まで",
    desc: "使い切れなかった食材の保存のしかたをレシピごとに表示。次に使うまで傷ませません。",
    color: "text-accent-dark",
    tint: "bg-accent-soft",
  },
];

const STEPS: { n: string; Icon: LucideIcon; title: string; desc: string }[] = [
  { n: "01", Icon: Refrigerator, title: "冷蔵庫に登録", desc: "写真を撮るだけ。賞味期限も自動で推定。" },
  { n: "02", Icon: CookingPot, title: "在庫だけで献立を提案", desc: "冷蔵庫にあるものだけで作れる案を3つ。" },
  { n: "03", Icon: ShoppingCart, title: "不足を買い物リストへ", desc: "足りない分だけ、店で買える単位で。" },
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
      {/* ===== Hero ===== */}
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
            alt={APP_NAME}
            width={260}
            height={148}
            priority
            className="mx-auto h-auto w-[210px]"
          />
          {/* 初見の人が読む場所。製品を知らなくても意味が通る言葉だけを使う。 */}
          <h1 className="font-display mt-5 text-4xl font-extrabold leading-tight tracking-tight text-brand-dark sm:text-5xl">
            今日なに作るか、
            <br />
            家にあるもので
            {/* 393px幅だと「決まる。」が溢れて「る。」だけ次行に落ちる。狭い画面だけ3行に割る */}
            <br className="sm:hidden" />
            決まる。
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-sm leading-relaxed text-ink-soft sm:text-base">
            冷蔵庫にあるものを入れるだけ。
            <br />
            作れる料理と、足りない分の
            <br className="sm:hidden" />
            買い物リストが出ます。
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {/* ボタンは「動作＋対象＋結果」。どこへ行くかではなく、何が起きるかを書く。 */}
            <Link
              href="/"
              className="w-full rounded-full bg-brand px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-dark active:scale-95 sm:w-auto"
            >
              家にあるもので献立を出す（無料）
            </Link>
            <a
              href="#proof"
              className="w-full rounded-full border border-line bg-surface px-8 py-3.5 text-sm font-bold text-brand-dark transition hover:border-brand sm:w-auto"
            >
              他のレシピアプリとの違いを見る
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

      {/* ===== 証拠：実際にアプリが出す文言 ===== */}
      <section id="proof" className="px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-5xl">
          {/* ここから下は「比較検討中の人」向け。ヒーローから下ろしてきた差別化を置く。
              ただし「分量を変えない」だけでは通じないので、まず現象そのものを説明する。 */}
          <Kicker>What makes it different</Kicker>
          <h2 className="font-display mt-2 text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {APP_PROMISE}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-ink-soft">
            レシピをAIに読み取らせると、はっきり読めなかった分量まで、それらしい数字で埋めてしまうことがあります。
            「砂糖 大さじ1」が「小さじ1」に変わっていても、作りはじめてからでは戻せません。
            {APP_NAME}
            は、分からなかったことを分からないまま出します。以下は実際に画面に出る文言です。
          </p>

          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            {PROOFS.map((p) => {
              const Icon = p.Icon;
              const warn = p.tone === "warn";
              return (
                <div
                  key={p.label}
                  className="flex flex-col rounded-3xl border border-line bg-surface p-6 shadow-sm"
                >
                  <span
                    className={`grid h-12 w-12 place-items-center rounded-2xl ${
                      warn ? "bg-amber-50" : "bg-brand-soft"
                    }`}
                  >
                    <Icon
                      size={24}
                      strokeWidth={1.8}
                      className={warn ? "text-amber-600" : "text-brand"}
                    />
                  </span>
                  <p className="mt-4 text-xs font-bold tracking-wide text-ink-soft">
                    {p.label}
                  </p>
                  <h3 className="mt-1 text-base font-bold text-ink">{p.headline}</h3>

                  {/* アプリ内の実物の文言（画像ではなく本物のテキスト） */}
                  <div
                    className={`mt-4 rounded-xl px-3.5 py-3 text-xs leading-relaxed ${
                      warn
                        ? "bg-amber-50 text-amber-800"
                        : "bg-brand-soft text-brand-dark"
                    }`}
                  >
                    {p.quote}
                  </div>

                  <p className="mt-4 text-xs leading-relaxed text-ink-soft">{p.note}</p>
                </div>
              );
            })}
          </div>

          <p className="mx-auto mt-8 max-w-2xl rounded-2xl border border-line bg-surface px-5 py-4 text-center text-xs leading-relaxed text-ink-soft">
            取り込んだレシピは<strong className="text-ink">確認画面を挟んでから</strong>
            保存します。材料と手順、読み取れなかった箇所を見て、納得してから残せます。
          </p>
        </div>
      </section>

      {/* ===== 2本柱：在庫厳守・人数換算 ===== */}
      <section className="bg-surface/70 px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-4xl">
          <Kicker>Two promises</Kicker>
          <h2 className="font-display mt-2 text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            当たり前のことを、当たり前にやる。
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2">
            {PILLARS.map((p) => {
              const Icon = p.Icon;
              return (
                <div
                  key={p.eyebrow}
                  className="flex flex-col rounded-3xl border border-line bg-paper p-7 shadow-sm"
                >
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft">
                    <Icon size={28} strokeWidth={1.7} className="text-brand" />
                  </span>
                  <p className="mt-4 text-xs font-bold tracking-wide text-brand">
                    {p.eyebrow}
                  </p>
                  <h3 className="font-display mt-1 text-xl font-bold leading-snug text-ink">
                    {p.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">{p.body}</p>
                  <ul className="mt-4 flex flex-col gap-2.5">
                    {p.points.map((pt) => (
                      <li key={pt} className="flex gap-2 text-xs leading-relaxed text-ink">
                        <CheckCircle2
                          size={16}
                          strokeWidth={2}
                          className="mt-px shrink-0 text-brand"
                        />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== レシピの入れ方は3つ ===== */}
      <section className="px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <Kicker>Add a recipe</Kicker>
          <h2 className="font-display mt-2 text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            レシピの入れ方は、3つ。
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-sm leading-relaxed text-ink-soft">
            どの入れ方でも、読み取れなかった分量と出典の扱いは同じです。
          </p>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {SOURCES.map((s) => {
              const Icon = s.Icon;
              return (
                <div
                  key={s.title}
                  className="rounded-3xl border border-line bg-surface p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft">
                    <Icon size={22} strokeWidth={1.8} className="text-brand" />
                  </span>
                  <h3 className="mt-4 text-base font-bold text-ink">{s.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-ink-soft">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== 主な機能 ===== */}
      <section id="features" className="bg-surface/70 px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <Kicker>Features</Kicker>
          <h2 className="font-display mt-2 text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            続けられるように、細かいところまで。
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => {
              const Icon = f.Icon;
              return (
                <div
                  key={i}
                  className="group rounded-3xl border border-line bg-paper p-7 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
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

      {/* ===== ぐるっと1周（在庫が回る流れ） ===== */}
      <section className="px-6 py-16 sm:py-24">
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
                <div className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-5 py-4">
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
      <section className="bg-surface/70 px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <Kicker>Gallery</Kicker>
          <h2 className="font-display mt-2 text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            冷蔵庫から、こんな一皿へ。
          </h2>
          <p className="mx-auto mt-3 max-w-md text-center text-sm text-ink-soft">
            余りがちな食材から実際に提案された料理の一例です。
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
      <section className="px-6 py-20">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-[32px] bg-brand px-8 py-14 text-center text-white shadow-xl">
          {/* 最後にもう一度、初見の言葉に戻す（ここまで読まずに飛んできた人もいる） */}
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            今日の晩ごはん、
            <br className="sm:hidden" />
            決めてしまおう。
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/90">
            いま家にあるものを{SUGGEST_THRESHOLD}つ入れるだけで、今日の一品と買い物リストが出ます。
            <br className="hidden sm:block" />
            登録もログインも要りません。
          </p>
          <Link
            href="/"
            className="mt-8 inline-block rounded-full bg-white px-10 py-3.5 text-sm font-bold text-brand-dark shadow-lg transition hover:bg-paper active:scale-95"
          >
            家にあるもので献立を出す
          </Link>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="border-t border-line py-10">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <Image
            src="/cooksync-logo.svg"
            alt={APP_NAME}
            width={140}
            height={80}
            className="mx-auto h-auto w-[120px] opacity-80"
          />
          <p className="mt-3 text-xs text-ink-soft">
            個人開発のキッチンアプリ。Next.js / TypeScript / AI（Claude）で構築。
          </p>
          <nav className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-ink-soft">
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
          <p className="mt-3 text-xs text-ink-soft/70">© 2026 {APP_NAME}</p>
        </div>
      </footer>
    </div>
  );
}
