// 「◯◯がありません」で終わる画面を無くすための共通部品。
//
// 空の画面は、初見の人がいちばん長く見る画面でもある。
// そこに「ありません」しか書いていないと、次に何をすればいいか分からないまま閉じられる。
// なので **空状態には必ず「次の1手」を1つ以上置く** ことを、型と EMPTY_STATES で強制する。
// （テスト src/components/__tests__/emptyState.test.tsx が全項目を走査して検証している）
//
// 文言の原則（Preferences/copywriting-audience.md）:
//   初見の人が見る場所は「その人が既に持っている悩み」の言葉で書く。
//   否定形（「〜しない」）や競合比較はここでは使わない。
//   夕食の悩み1位は「今日なに作るか決まらない」（65.8%）。

import Link from "next/link";

export interface EmptyAction {
  /** 何が起きるかが分かる言葉で書く（「見る」ではなく「献立を決める」） */
  label: string;
  href: string;
  /** 主導線を1つだけ true にする */
  primary?: boolean;
}

export interface EmptyStateContent {
  title: string;
  body: string;
  /** 空でも必ず1つ以上。ここが空＝行き止まりの画面になる */
  actions: [EmptyAction, ...EmptyAction[]];
}

/**
 * アプリ内の空状態を1か所に集める。
 * バラバラに書くと「ここだけ次の1手が無い」が必ず生まれるので、文言ごと集約する。
 */
export type EmptyStateKey =
  | "fridge"
  | "shopping"
  | "homeFridge"
  | "homeShopping"
  | "meal";

export const EMPTY_STATES: Record<EmptyStateKey, EmptyStateContent> = {
  /** 冷蔵庫：リストが空（上に QuickStart が出ている状態） */
  fridge: {
    title: "冷蔵庫はまだ空です",
    body: "写真を1枚撮るか、よく買うものをタップすると入ります。3つ入れば、今日の献立を出せます。",
    actions: [
      { label: "よく買うものから足す", href: "#cooksync-quickstart", primary: true },
    ],
  },
  /** 買い物リスト：空 */
  shopping: {
    title: "買うものはまだありません",
    body: "献立を決めると、足りない材料だけが「1パック」など店で買える単位でここに入ります。",
    actions: [
      { label: "今日の献立を決める", href: "/meal", primary: true },
      { label: "冷蔵庫の中身を入れる", href: "/fridge" },
    ],
  },
  /** ホーム：冷蔵庫リストのカルーセルが空 */
  homeFridge: {
    title: "冷蔵庫の中身がまだありません",
    body: "写真1枚か、よく買うものをタップするだけで入ります。",
    actions: [{ label: "食材を入れる", href: "/fridge", primary: true }],
  },
  /** ホーム：買い物リストに未購入が無い */
  homeShopping: {
    title: "買うものはまだありません",
    body: "献立を決めると、足りない分が店で買える単位で入ります。",
    actions: [{ label: "今日の献立を決める", href: "/meal", primary: true }],
  },
  /** 献立：在庫が空のまま献立画面に来た */
  meal: {
    title: "冷蔵庫が空でも大丈夫です",
    body: "買い物してから作る前提で提案します。先に食材を入れておくと、あるものだけで作れる案も出せます。",
    actions: [{ label: "冷蔵庫に食材を入れる", href: "/fridge", primary: true }],
  },
};

/**
 * 空状態の見た目。
 * ボタンは min-h-[44px]（iPhoneのタップ領域の下限）。文字は text-xs=13.5px 以上。
 */
export default function EmptyState({
  content,
  className = "",
}: {
  content: EmptyStateContent;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-8 text-center ${className}`}
    >
      <p className="text-sm font-semibold text-ink">{content.title}</p>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-ink-soft">
        {content.body}
      </p>
      <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
        {content.actions.map((a) => (
          <Link
            key={a.href + a.label}
            href={a.href}
            className={`flex min-h-[44px] items-center justify-center rounded-full px-5 text-sm font-semibold transition ${
              a.primary
                ? "bg-brand text-white shadow-sm hover:bg-brand-dark active:scale-[0.99]"
                : "border border-line bg-surface text-ink-soft hover:border-brand hover:text-brand-dark"
            }`}
          >
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
