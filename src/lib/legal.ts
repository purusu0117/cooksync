// 法務・サポートページ（/legal/privacy・/legal/terms・/legal/support）の定数。
// 運営者名・連絡先・改定日はここだけ直せば全ページに反映される。
//
// ⚠️ App Store Connect の「プライバシーポリシーURL」「サポートURL」に登録する先なので、
//    URLを変える（独自ドメイン取得など）ときは App Store Connect 側も必ず差し替える。

export const LEGAL = {
  serviceName: "CookSync",
  // 公開ページでは実名を出さず開発者名（屋号）で表記する。運営者の氏名・住所は
  // 法令に基づく請求があった場合に遅滞なく開示する運用（無料アプリのため常時掲示はしない）。
  operatorName: "Sync Apps",
  operatorType: "個人開発",
  contactEmail: "daito150117@gmail.com",
  /** 本番の公開URL（Capacitor の remote URL と同じ先） */
  siteUrl: "https://cooksync-one.vercel.app",
  // 制定日・最終改定日（YYYY年M月D日表記）
  privacyEnacted: "2026年7月31日",
  privacyUpdated: "2026年7月31日",
  termsEnacted: "2026年7月31日",
  termsUpdated: "2026年7月31日",
} as const;
