// 個人ローカルアプリのアカウント。端末内(localStorage)にのみ保存される簡易版。
// ※本格的な認証ではない（パスワードは平文・端末内のみ）。公開時はサーバー認証へ。

export interface Account {
  name: string;
  email: string;
  password: string;
  createdAt: number;
  loggedIn: boolean;
  premium?: boolean; // true=AI無制限。未設定/false=無料枠（月◯回）
}
