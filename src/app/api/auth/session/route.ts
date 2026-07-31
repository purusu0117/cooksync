// 現在のログイン状態を返す／ログアウトする。
// クライアントは「Googleログインが使える環境かどうか」もここで知る
// （未設定の環境でボタンだけ出して押させると501になるので、出さない判断に使う）。

import { googleConfigured } from "@/lib/oauthGoogle";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  readCookie,
  verifySession,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const s = verifySession(readCookie(request, SESSION_COOKIE));
  return Response.json({
    loggedIn: !!s,
    // dataId はクライアントの保存先を合わせるために返す（秘密ではない）
    dataId: s?.dataId ?? null,
    email: s?.email ?? null,
    name: s?.name ?? null,
    googleEnabled: googleConfigured(),
  });
}

/** ログアウト（セッションCookieを即時失効） */
export async function DELETE() {
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearSessionCookie() },
  });
}
