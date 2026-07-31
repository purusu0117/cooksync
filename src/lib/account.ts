// 端末内(localStorage)に持つアカウント表示情報。認証そのものは /api/auth（サーバー）が行う。
//
// ⚠️ password は **保存しない**（2026-07-31に廃止）。
//    以前は平文で localStorage に置いていたが、認証はサーバーが行うので端末に持つ必要がない。
//    型は既存データの読み込み互換のためだけに optional で残してある。書き込みには使わない。

export interface Account {
  name: string;
  email: string;
  /** @deprecated 平文保存していた名残。新規には書き込まない。 */
  password?: string;
  createdAt: number;
  loggedIn: boolean;
  /** true=プレミアム（枠が大きい）。無制限ではなくフェアユース上限あり。 */
  premium?: boolean;
}
