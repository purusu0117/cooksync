import type { Metadata } from "next";
import PremiumScreen from "@/components/premium/PremiumScreen";
import { APP_NAME } from "@/lib/brand";

// 課金画面。**初回起動では出さない**（審査 5.1.1(v)・離脱の両面で悪手）。
// 入口は「マイページの常設エントリ」と「枠を使い切った直後のシート」の2つだけ。
// 判定は src/lib/premium.ts に集約してある。
export const metadata: Metadata = {
  title: `プレミアム | ${APP_NAME}`,
  description: `${APP_NAME}プレミアムの内容と料金。AIレシピ探索・写真での在庫登録の回数が増え、作った料理の記録を過去12週ぶんさかのぼって見られます。`,
};

export default function PremiumRoute() {
  return <PremiumScreen />;
}
