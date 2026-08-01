// CookSync の**価格と採算の唯一の定義**。画面・ドキュメント・検算はすべてここから読む。
//
// なぜ1箇所にするか：
//   価格は「App Store Connect の課金アイテム」「課金画面」「LP」「docs」の4箇所に出る。
//   数字を直書きすると、値上げしたときに画面のどこかが古い金額のまま残る。
//   ¥480 と書いた画面と ¥580 で請求されるアプリは、ガイドライン 3.1.2 の
//   「価格を明示する」に反するだけでなく、単純に返金と★1の原因になる。
//
// ⚠️ **このファイルは node 固有のものを一切importしない**（aiLimits.ts と同じ理由）。
//    課金画面はクライアントコンポーネントなので、fs や crypto を引くと読めなくなる。
//
// 原価の出どころ：実測（2026-07-31・ダミーusageを流して確認）
//   AIレシピ探索 ¥19.6 / 写真で在庫登録 ¥0.53 / 写真からレシピ ¥12.8
//   → src/lib/aiCost.ts の EST_YEN は安全側に丸めた値（22/1/15）で、こちらは実測値。
//     採算の検算は**実測**でやる。EST_YEN は「止める」ための値なので多めに寄せてある。

import { FREE_LIMITS, PREMIUM_LIMITS, type AiKind } from "./aiLimits";

// ---------------------------------------------------------------- 価格

/**
 * 月額（税込・円）。**¥480 に決めた。**
 *
 * 根拠（日本のレシピアプリの実勢価格・2026-08 時点）:
 *   クラシル プレミアム ¥480/月 ／ DELISH KITCHEN プレミアム ¥480/月 ／
 *   クックパッド プレミアム ¥400/月（iOS）
 *   → **¥480 は相場のど真ん中**。この価格帯から外れると、
 *     ユーザーは「レシピアプリなのに高い」という既に持っている物差しで判断する。
 *
 * 上げなかった理由：
 *   原価から逆算すると ¥2,200 前後まで上げないとプレミアム上限（週15/75/5）を
 *   フルに使う人を賄えない（下の premiumWorstCaseCostYen 参照）。
 *   だが相場の4.6倍は売れない。**価格ではなく「1人あたりの原価上限」で採算を取る**
 *   （PREMIUM_AI_COST_CAP_YEN）。これがこのファイルの中心的な判断。
 *
 * 下げなかった理由：
 *   クックパッドの ¥400 に合わせても、手取りは ¥371→¥309 に落ちるだけで
 *   「安いから選ぶ」層は AI の原価を最も食う層と重なる。安売りは採算を直接悪くする。
 */
export const MONTHLY_PRICE_YEN = 480;

/**
 * 年額（税込・円）。**¥4,800 に決めた＝2ヶ月ぶん無料・17%オフ。**
 *
 * 日本のサブスクの慣行は「月額×10ヶ月」。20%オフ以上にすると
 * 月額を選ぶ人がいなくなり、解約タイミングが年1回に集中して読みが効かなくなる。
 * 17%は「2ヶ月無料」と言い切れる最小の割引率で、言葉にしたときに一番強い。
 */
export const YEARLY_PRICE_YEN = 4800;

/**
 * Apple の手数料。**15%**（App Store Small Business Program）。
 *
 * ⚠️ **自動では適用されない。App Store Connect から申請が要る（大翔の手作業）。**
 *    承認された会計月の末日+15日から適用されるので、リリース後に申請すると
 *    初月は 30% 取られ、手取りが ¥371 → ¥305 に落ちる。**申請してからリリースする。**
 */
export const APPLE_COMMISSION_RATE = 0.15;

/** 消費税。App Store の表示価格は税込なので、手取りの計算では先に抜く。 */
export const CONSUMPTION_TAX_RATE = 0.1;

/** 表示価格（税込）から手取り（円）を出す。端数は切り捨てず四捨五入。 */
export function netYen(grossTaxIncluded: number): number {
  return Math.round(
    (grossTaxIncluded / (1 + CONSUMPTION_TAX_RATE)) * (1 - APPLE_COMMISSION_RATE),
  );
}

/** 月額プランの手取り（円/月）。¥480 → ¥371 */
export function monthlyNetYen(): number {
  return netYen(MONTHLY_PRICE_YEN);
}

/** 年額プランの手取り（円/年）。¥4,800 → ¥3,709 */
export function yearlyNetYen(): number {
  return netYen(YEARLY_PRICE_YEN);
}

/** 年額プランを月割りした手取り（円/月）。¥309 ＝ 月額より ¥62 薄い。 */
export function yearlyNetYenPerMonth(): number {
  return Math.round(yearlyNetYen() / 12);
}

/** 年額の割引率（%）。表示にも使うので計算で出す（「2ヶ月無料」と食い違わせない）。 */
export function yearlyDiscountPercent(): number {
  return Math.round((1 - YEARLY_PRICE_YEN / (MONTHLY_PRICE_YEN * 12)) * 100);
}

/** 年額を月あたりに直した表示価格（税込・円）。¥400 */
export function yearlyMonthlyEquivalentYen(): number {
  return Math.round(YEARLY_PRICE_YEN / 12);
}

export type PlanId = "monthly" | "yearly";

export interface Plan {
  id: PlanId;
  /** App Store Connect に登録する Product ID（大翔の手作業。ここと**同じ文字列**にすること） */
  productId: string;
  label: string;
  priceYen: number;
  /** 価格の下に出す一行。年額は「月あたりいくらか」を必ず併記する */
  note: string;
  recommended: boolean;
}

/**
 * 販売するプラン。**この2つだけ。**
 *
 * ⚠️ productId は App Store Connect 側で作るサブスクリプションの Product ID と
 *    1文字でも違うと購入が失敗する。変えるときは両方直す。
 */
export const PLANS: Plan[] = [
  {
    id: "monthly",
    productId: "com.cooksync.premium.monthly",
    label: "月額",
    priceYen: MONTHLY_PRICE_YEN,
    note: "いつでも解約できます",
    recommended: false,
  },
  {
    id: "yearly",
    productId: "com.cooksync.premium.yearly",
    label: "年額",
    priceYen: YEARLY_PRICE_YEN,
    note: `月あたり ¥${yearlyMonthlyEquivalentYen()}（2ヶ月ぶん無料）`,
    recommended: true,
  },
];

// ------------------------------------------------- 出さないと決めたもの

/**
 * **ファミリープランは v1 では出さない。**
 *
 * 大翔の発言（2026-08-01）:「家族と冷蔵庫を共有するならファミリープランを作ってもいいかも」
 * 方向は正しいが、**今の原価構造では席を増やすほど損をする**。
 *
 *   1契約の手取り ¥371 に対し、AI原価は**席の数だけ増える**。
 *   5人ファミリーを ¥780（手取り ¥603）で売ると、原価上限は5席ぶん＝¥1,100（¥220×5）。
 *   手取り ¥603 < 原価 ¥1,100 で、**売れるほど赤字が増える**。
 *   ¥220/席という原価上限のまま黒字にするには ¥1,600/月（税込）が必要で、これは売れない。
 *
 * ⚠️ **Apple の「ファミリー共有」も OFF のままにする。**（App Store Connect のチェックボックス）
 *    有効にすると1契約で最大6人が entitlement を得る＝上と同じ計算で最悪 ¥1,320 の原価に対し
 *    手取り ¥371。ON にするのは一瞬でできるが、**原価が席数に比例するアプリでは無料の機能ではない**。
 *
 * 再検討する条件（これが満たされたら計算し直す）:
 *   **AIレシピ探索の実効原価が ¥5 を切ったとき**（＝共有レシピキャッシュのヒット率が
 *   実測で70%を超えたとき）。そのとき1席あたりの原価上限は ¥60 前後まで落ち、
 *   5席で ¥300 < 手取り ¥603 となってファミリープランが成立する。
 *   ヒット率は現在**未計測**なので、まず計測する。
 *
 * なお「家族と冷蔵庫を共有する」機能そのものは、課金プランとは別に価値がある。
 * ただし複数アカウント間のデータ共有はデータ構造の変更を伴うので、v1 では出さない。
 */
export const FAMILY_PLAN: Plan | null = null;

/** Apple のファミリー共有を有効にするか。**false のまま**（理由は FAMILY_PLAN のコメント）。 */
export const APPLE_FAMILY_SHARING_ENABLED = false;

/**
 * **無料トライアルは付けない。**
 *
 * 試用7日間でプレミアム枠（週 research 15）をそのまま渡すと、原価は最大 ¥294。
 * 手取り ¥371 の79%を、契約するか分からない人に先払いする計算になる。
 * トライアル→有料の転換率を20%とすると、1契約あたりの獲得原価は ¥1,470。
 *
 * その代わり **無料枠そのものが試用**として機能している：
 * 無料でも毎週 research 2 / scan 6 / import 2 が使え、月曜に戻る。
 * 「使ってみないと分からない」は無料枠が既に解いている。
 */
export const FREE_TRIAL_DAYS = 0;

// ---------------------------------------------------------------- 原価

/**
 * 1回あたりの**実測**原価（円）。2026-07-31 計測。
 * ⚠️ aiCost.ts の EST_YEN（22/1/15）は「予算で止める」ための安全側の値。
 *    採算の検算は実測でやらないと、実際より悲観的な結論になる。
 */
export const UNIT_COST_YEN: Record<AiKind, number> = {
  research: 19.6,
  scan: 0.53,
  import: 12.8,
};

/** 1ヶ月の週数。365.25 / 12 / 7 = 4.348。週次の枠を月額の採算に換算するのに要る。 */
export const WEEKS_PER_MONTH = 365.25 / 12 / 7;

/** 週間の枠をフルに使ったときの月間原価（円）。 */
export function monthlyCostYen(weeklyLimits: Record<AiKind, number>): number {
  const perWeek =
    weeklyLimits.research * UNIT_COST_YEN.research +
    weeklyLimits.scan * UNIT_COST_YEN.scan +
    weeklyLimits.import * UNIT_COST_YEN.import;
  return Math.round(perWeek * WEEKS_PER_MONTH);
}

/** プレミアムの枠（週 15/75/5）をフルに使う人の月間原価。**¥1,730** */
export function premiumWorstCaseCostYen(): number {
  return monthlyCostYen(PREMIUM_LIMITS);
}

/** 無料枠（週 2/6/2）をフルに使う人の月間原価。**¥296** */
export function freeWorstCaseCostYen(): number {
  return monthlyCostYen(FREE_LIMITS);
}

/**
 * サービス全体の月間予算（円）。`COOKSYNC_MONTHLY_BUDGET_YEN` の既定値と同じ。
 * ⚠️ 実際に効いている値はサーバーの環境変数。ここは**採算計算の前提**として置いてある。
 */
export const MONTHLY_BUDGET_YEN = 3000;

/** 予算内で支えられる「枠を毎週使い切る無料ユーザー」の人数。**10人**。 */
export function freeUsersWithinBudget(): number {
  return Math.floor(MONTHLY_BUDGET_YEN / freeWorstCaseCostYen());
}

// ------------------------------------------ 採算の要：1人あたりの原価上限

/**
 * **プレミアム1人あたりの月間AI原価の上限（円）。この設計の中心。**
 *
 * ## なぜ回数だけでは採算が取れないのか（検算）
 *
 * | | 手取り/月 | 枠フル使用時の原価/月 | 差 |
 * |---|---|---|---|
 * | 月額 ¥480 | ¥371 | ¥1,730 | **▲¥1,359** |
 * | 年額 ¥4,800 | ¥309 | ¥1,730 | **▲¥1,421** |
 *
 * 週 15/75/5 をフルに使う人は、どちらのプランでも**赤字**。
 * 回数だけで黒字にしようとすると週 2/40/1 まで絞ることになり、
 * 無料枠（週 2/6/2）とほとんど変わらない＝**¥480 を払う理由が消える**。
 *
 * ## 決めたこと：**回数ではなく金額で縛る**
 *
 *   ・回数上限（週 15/75/5）は **使い方の目安**として残す（体験の話）
 *   ・実際の採算は **1人あたり月間原価 ¥220** で止める（お金の話）
 *
 * ¥220 の根拠は **月額プランの手取り ¥371 の 60%**。残る40%（¥151）が粗利。
 * 年額プラン（手取り ¥309/月）でも ¥89/月 の粗利が残るので、**両プランとも黒字**。
 *
 * ## 検算（この上限を入れた後）
 *
 * | | 手取り | 原価上限 | 粗利 |
 * |---|---|---|---|
 * | 月額 ¥480 | ¥371 | ¥220 | **+¥151/月** |
 * | 年額 ¥4,800 | ¥309 | ¥220 | **+¥89/月** |
 *
 * ⚠️ **この上限はまだサーバーで強制されていない。**
 *    quotaServer.ts に「uidごとの月間原価カウンタ」を足して consume() から見る必要がある。
 *    それが入るまで、採算は「回数上限＋全体予算 ¥3,000」でしか守られていない
 *    （＝プレミアム1人が全予算を食い潰せる）。docs/monetization.md の「他部門への依頼」参照。
 */
export const PREMIUM_AI_COST_CAP_YEN = 220;

/** 原価上限を手取りの何割に置くか。上限を動かすときはこの比率で考える。 */
export const COST_CAP_RATIO = 0.6;

/** そのプランの粗利（手取り − 原価上限）。**両プランとも正であること**がリリース条件。 */
export function grossProfitYen(plan: PlanId): number {
  const net = plan === "yearly" ? yearlyNetYenPerMonth() : monthlyNetYen();
  return net - PREMIUM_AI_COST_CAP_YEN;
}

/** 原価上限を入れる前の粗利（＝回数上限だけで守った場合）。**負になる**ことを示すための関数。 */
export function grossProfitWithoutCostCapYen(plan: PlanId): number {
  const net = plan === "yearly" ? yearlyNetYenPerMonth() : monthlyNetYen();
  return net - premiumWorstCaseCostYen();
}

/**
 * その人が今月あといくら使えるか（円）。0 以下なら原価上限に達している。
 * サーバー（quotaServer）とドキュメントで同じ計算を使うために置いてある。
 */
export function remainingCostBudgetYen(spentYen: number): number {
  return Math.max(0, PREMIUM_AI_COST_CAP_YEN - spentYen);
}

/** これから使う1回（estYen）を足しても原価上限内か。 */
export function withinUserCostCap(spentYen: number, estYen: number): boolean {
  return spentYen + estYen <= PREMIUM_AI_COST_CAP_YEN;
}

// ------------------------------------------------------------ 損益分岐

/**
 * 固定費（円/月）。Apple Developer Program $99/年（¥155/$で ¥15,345）＋ ドメイン ¥1,500/年。
 * Vercel / Upstash は無料枠で回している前提。
 */
export const FIXED_COST_YEN_PER_MONTH = Math.round((15345 + 1500) / 12);

/**
 * 固定費を回収するのに必要な有料会員数。
 * @param costPerUserYen 1人あたりの実際のAI原価（既定は上限いっぱいの最悪ケース）
 */
export function breakEvenSubscribers(
  costPerUserYen: number = PREMIUM_AI_COST_CAP_YEN,
  plan: PlanId = "monthly",
): number {
  const net = plan === "yearly" ? yearlyNetYenPerMonth() : monthlyNetYen();
  const margin = net - costPerUserYen;
  if (margin <= 0) return Infinity;
  return Math.ceil(FIXED_COST_YEN_PER_MONTH / margin);
}
