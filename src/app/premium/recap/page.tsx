import type { Metadata } from "next";
import RecapHistory from "@/components/premium/RecapHistory";
import { APP_NAME } from "@/lib/brand";

// プレミアム特典「作った料理の記録が、ずっと残る」の画面。
// 未加入でもロック表示＋今週ぶん（無料のまま）が見える＝取り上げの証明にもなっている。
// 出し分けは RecapHistory 側に集約してあり、ここはルートを繋ぐだけ。
export const metadata: Metadata = {
  title: `作った料理の記録 | ${APP_NAME}`,
  description: `作った料理の記録。プレミアムでは過去12週ぶんをさかのぼって見られます。今週の記録は無料のまま見られます。`,
};

export default function PremiumRecapRoute() {
  return <RecapHistory />;
}
