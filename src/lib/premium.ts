// プレミアムで**何ができるようになるか**の定義と、課金画面を**いつ・どこで出すか**の判断。
// 値段の話は src/lib/pricing.ts にある（ここは「中身」、あちらは「いくら」）。
//
// ## このファイルが守っている一番大事なルール
//
// **プレミアムは足すだけ。無料でできていたことを有料の裏に隠さない。**
//   大翔から明示的に叱られている（「勝手にCookSyncの機能を弱くすんのはやめて」）。
//   だから PremiumFeature は必ず `freeKeeps` を持つ ＝ その機能について
//   **無料ユーザーが今までどおりできること**を1つずつ書かないと定義できない形にしてある。
//   空文字は premium.test.ts が落とす。「無料から取り上げた」設計は型とテストで作れない。
//
// ## 文言の置き場所（Preferences/copywriting-audience.md）
//
//   ここに書く文言が出るのは **課金画面** ＝ 読むのは**比較検討中の人**。
//   すでにCookSyncを使い、無料枠を使い切って、他と比べている。
//   なので「他と何が違うか」を書いてよい（分量を勝手に変えない・出典が残る）。
//   ⚠️ 逆に、ここの文言を**ホーム画面やApp Storeのサブタイトルへ流用しない**。
//     初見の人には「AIが分量を変える」という現象自体が伝わらず空振りする。

import { FREE_LIMITS, PREMIUM_LIMITS, AI_LABEL, QUOTA_RESET_LABEL } from "./aiLimits";
import type { PlanId } from "./pricing";

// ------------------------------------------------------- プレミアムの中身

/** その特典が**もう使えるか**。課金画面での扱いが変わる。 */
export type FeatureStatus =
  /** 実装済み。課金したその瞬間から使える＝**売ってよい** */
  | "shipped"
  /** これから追加する。**「使えます」とは書かない**（App Store 2.3.1・実装にない機能は謳えない） */
  | "planned";

export interface PremiumFeature {
  id: string;
  /** 見出し。比較検討層向け＝「他とどう違うか」まで踏み込んでよい */
  title: string;
  /** 1〜2行の説明 */
  detail: string;
  /**
   * **その機能について、無料ユーザーが今までどおりできること。**
   * 必須。ここが書けない＝無料から取り上げているということなので、そもそも特典にしない。
   */
  freeKeeps: string;
  status: FeatureStatus;
  /** 実装の在処（レビュー時に「本当にあるのか」を確認できるようにする） */
  source: string;
}

/**
 * プレミアムの特典。**順番がそのまま課金画面の並び順**。
 *
 * 選定の方針：**新しい大きなAI機能を足さない**。
 *   AIを足すと原価が増え、¥480 で賄えなくなる（pricing.ts の検算）。
 *   だから特典は「すでにあるロジックの上に積める・原価ゼロのもの」から選んだ。
 *   唯一の例外が①のAI枠で、これは原価上限（PREMIUM_AI_COST_CAP_YEN）で頭が止まる。
 */
export const PREMIUM_FEATURES: PremiumFeature[] = [
  {
    id: "ai-quota",
    title: `${AI_LABEL.research}が週${FREE_LIMITS.research}回 → ${PREMIUM_LIMITS.research}回`,
    detail: `${AI_LABEL.scan}は週${PREMIUM_LIMITS.scan}回、${AI_LABEL.import}は週${PREMIUM_LIMITS.import}回まで。献立を決めるたびに残り回数を気にしなくてよくなります。`,
    freeKeeps: `無料でも毎週 ${AI_LABEL.research} ${FREE_LIMITS.research}回・${AI_LABEL.scan} ${FREE_LIMITS.scan}回・${AI_LABEL.import} ${FREE_LIMITS.import}回が使えます（${QUOTA_RESET_LABEL}に戻ります）。`,
    status: "shipped",
    source: "src/lib/quotaServer.ts",
  },
  {
    id: "recap-history",
    title: "作った料理の記録が、ずっと残る",
    detail:
      "先週までのふりかえりを12週ぶんさかのぼって見られます。何を何回作ったか、どの食材を使ったか、何週続いているか。",
    freeKeeps: "ホームの「今週のふりかえり」は無料のままです（内容も変わりません）。",
    status: "shipped",
    source: "src/components/premium/RecapHistory.tsx",
  },
  {
    id: "aisle-order",
    title: "買い物リストを、いつもの店の並びに",
    detail:
      "売り場の順番を自分の店に合わせて並べ替えて覚えさせられます。上から順に取っていけば1周で買い終わります。",
    freeKeeps: "標準の売り場順（野菜→肉魚→乳製品→…）でのまとめ表示は無料のままです。",
    status: "planned",
    source: "src/lib/aisle.ts",
  },
  {
    id: "expiry-notify-plus",
    title: "賞味期限の知らせを、自分の生活時間に",
    detail:
      "朝と夕方の2回に分けたり、食材ごとに「何日前に知らせるか」を変えたりできます。",
    freeKeeps: "1日1通の賞味期限のお知らせ（時刻と何日前かの設定つき）は無料のままです。",
    status: "planned",
    source: "src/lib/expiryNotify.ts",
  },
  {
    id: "family-fridge",
    title: "家族と、同じ冷蔵庫を見る",
    detail:
      "買ってきたものを誰が入れても全員の画面に反映されます。買い物リストも共有されます。",
    freeKeeps: "自分の冷蔵庫を複数の端末で使うこと（同じアカウントでログイン）は無料のままです。",
    status: "planned",
    source: "未実装（アカウント間のデータ共有が要るため v1 では出さない）",
  },
];

/** 課金画面の「今すぐ使えるもの」に出す特典。**planned は絶対に混ぜない。** */
export function sellableFeatures(): PremiumFeature[] {
  return PREMIUM_FEATURES.filter((f) => f.status === "shipped");
}

/** 「これから追加するもの」として、使えないと分かる形で並べる特典。 */
export function plannedFeatures(): PremiumFeature[] {
  return PREMIUM_FEATURES.filter((f) => f.status === "planned");
}

// ----------------------------------------------------------- 課金画面の文言

/** 課金画面の見出し。**比較検討層向け**なので差別化を出してよい。 */
export const PREMIUM_HEADLINE = "毎日の献立を、CookSyncに任せる。";

/**
 * 見出しの下の1行。競合の失点（AIが分量を勝手に変える）を根拠にした差別化は、
 * 初見の一等地ではなく**この位置**に置く。
 */
export const PREMIUM_SUBHEAD =
  "分量を勝手に書き換えず、参考にしたページも残す。そのうえで、AIをたっぷり使えるようにするプランです。";

/** 「これから追加するもの」の見出し。**まだ使えないことが読んで分かる言葉にする。** */
export const PLANNED_SECTION_TITLE = "これから追加するもの（まだ使えません）";

/** 無料のままでできることの見出し。ここを出すのが「弱くしない」の証明。 */
export const FREE_KEEPS_TITLE = "無料のままできること（変わりません）";

// ------------------------------------------------- 課金画面を出す場所と時機

export type PaywallPlacement =
  /** 枠を使い切った直後に出すシート。**最も転換する**が、条件を厳しくする */
  | "quota-exhausted"
  /** マイページの常設エントリ。いつでも自分から見に行ける */
  | "mypage"
  /** 課金画面そのもの（/premium） */
  | "premium-page";

/**
 * **初回起動では絶対に出さない。**
 *
 * 理由は2つあり、どちらも単独で致命的：
 *   ① App Store 審査 5.1.1(v)：機能に必要のない登録・課金を先に要求してはいけない。
 *      CookSyncは無料枠だけで一通り使えるので、入口で課金画面を出すと
 *      「使う前に払わせようとしている」と見える。
 *   ② 離脱：Food&Drink カテゴリの Day1 残存は 16.5%（全カテゴリ最下位）。
 *      価値を1回も感じていない人に売っても買わないうえ、その場で消される。
 */
export const PAYWALL_ON_FIRST_LAUNCH = false;

/**
 * **アプリ内から外部の決済ページへ誘導しない。**（App Store 審査 3.1.1）
 *
 * iOS アプリ内でデジタルコンテンツを売るなら In-App Purchase 以外は使えない。
 * 「Webから契約すると安い」等のリンク・案内・ボタンを1つでも置くとリジェクト対象。
 * Web版のLPで契約を受けるのは自由だが、**アプリ内にそのリンクを置かない**。
 */
export const EXTERNAL_PAYMENT_URL: string | null = null;

export interface QuotaPaywallInput {
  /** サーバーの429が返した拒否理由 */
  reason?: "user" | "ip" | "global" | "budget";
  /** その人がもうプレミアムか */
  premium: boolean;
  /** 前にこのシートを出した週（aiLimits.weekKey の値）。一度も出していなければ undefined */
  lastShownWeek?: string;
  /** 今の週（aiLimits.weekKey()） */
  currentWeek: string;
}

/**
 * 枠切れのときに課金画面を出すか。
 *
 * 出す条件を厳しくしている理由：
 *   ・`reason` が "user" 以外（IP上限・全体の混雑・月間予算）は**こちら側の都合**で、
 *     プレミアムになっても解決しない。そこで売るのは**嘘**なので出さない。
 *     （"budget" は特にそう。プレミアムでもAIは動かない）
 *   ・同じ週に何度も出さない。枠切れは週の後半に何度でも起きるので、
 *     出しっぱなしにすると「使い切るたびに広告が出るアプリ」になる。
 *     出すのは**その週で1回だけ**、次は枠が戻ったあと（＝別の週）。
 */
export function shouldShowQuotaPaywall(input: QuotaPaywallInput): boolean {
  if (input.premium) return false; // もう入っている人に売らない
  if (input.reason !== "user") return false; // 本人の枠の話でなければ売らない
  if (input.lastShownWeek === input.currentWeek) return false; // 同じ週に2回出さない
  return true;
}

/**
 * 枠切れシートの本文。**最初に「いつ戻るか」を伝える。**
 *
 * 順番を逆にしない：先に課金を出すと「金を払わないと使えない」と読める。
 * 無料のままでも続けられることを先に言い切ってから、待たない選択肢として出す。
 */
export function quotaPaywallBody(resetHint: string): string {
  return `${resetHint}。待たずに続けるなら、プレミアムで今週ぶんの回数を増やせます。`;
}

// ------------------------------------------------------------- 購入の口

export type PurchaseResult =
  | { ok: true; plan: PlanId }
  | { ok: false; reason: "not-configured" | "cancelled" | "failed"; message: string };

/**
 * 購入処理の差し込み口。
 *
 * ⚠️ **実装は空（notConfiguredAdapter）。** App Store Connect の課金アイテム登録と
 *    StoreKit 2 の組み込みは**大翔の手作業**として残してある。
 *    出来たら setPurchaseAdapter() で本物を挿す。ここから先のコードは変えなくてよい。
 *
 * ⚠️ **押しても何も起きない偽ボタンにしない。** 未設定のときはボタンを
 *    「準備中」と明示し、押せば理由が出る。黙って無反応にすると、
 *    ユーザーは自分の操作ミスか通信障害だと思って何度も押す。
 */
export interface PurchaseAdapter {
  /** 本当に買えるか。false ならボタンは「準備中」表示にする */
  available(): boolean;
  purchase(plan: PlanId): Promise<PurchaseResult>;
  /** 購入の復元。**App Store 審査 3.1.1 で実装が必須**（機種変更・再インストール時） */
  restore(): Promise<PurchaseResult>;
}

export const NOT_CONFIGURED_MESSAGE =
  "プレミアムはまだお申し込みを受け付けていません。準備ができ次第、この画面でお知らせします。";

/** 課金アイテムが未登録のときのアダプタ。**正直に「準備中」と返す。** */
export const notConfiguredAdapter: PurchaseAdapter = {
  available: () => false,
  purchase: async () => ({
    ok: false,
    reason: "not-configured",
    message: NOT_CONFIGURED_MESSAGE,
  }),
  restore: async () => ({
    ok: false,
    reason: "not-configured",
    message: NOT_CONFIGURED_MESSAGE,
  }),
};

let adapter: PurchaseAdapter = notConfiguredAdapter;

/** TODO(大翔の手作業): StoreKit 2 の実装ができたらここに挿す。 */
export function setPurchaseAdapter(next: PurchaseAdapter): void {
  adapter = next;
}

export function getPurchaseAdapter(): PurchaseAdapter {
  return adapter;
}

/** テスト用に既定へ戻す（他のテストへ持ち越さないため）。 */
export function resetPurchaseAdapter(): void {
  adapter = notConfiguredAdapter;
}
