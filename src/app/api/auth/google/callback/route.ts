// Googleログインのコールバック。
// 認可コード → プロフィール → dataId解決 → **サーバー発行のセッションCookie** を配る。
//
// ここで初めて uid がサーバー管理になる＝AIの枠が偽装できなくなる。

import { OAUTH_STATE_COOKIE, exchangeCode, googleConfigured, uidFor } from "@/lib/oauthGoogle";
import { createSession, readCookie, sessionCookie } from "@/lib/session";
import { resolveGoogleUser } from "@/lib/userStore";

export const dynamic = "force-dynamic";

/** 失敗時はマイページにエラーを載せて戻す（生のスタックをユーザーに見せない） */
function fail(request: Request, reason: string): Response {
  const url = new URL("/mypage", request.url);
  url.searchParams.set("login_error", reason);
  return Response.redirect(url, 302);
}

export async function GET(request: Request) {
  if (!googleConfigured()) return fail(request, "unconfigured");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  if (denied) return fail(request, "cancelled"); // ユーザーが同意画面で拒否
  if (!code || !state) return fail(request, "invalid");

  // CSRF：開始時にcookieへ置いた state と一致するか
  const expected = readCookie(request, OAUTH_STATE_COOKIE);
  if (!expected || expected !== state) return fail(request, "state");

  try {
    const profile = await exchangeCode(request, code);
    const { user, email } = await resolveGoogleUser(profile);

    const token = createSession({
      uid: uidFor(profile), // "google:<sub>" ＝ メールを変えても不変
      dataId: user.dataId, // 既存ユーザーなら従来のデータをそのまま引き継ぐ
      email,
      name: user.name,
    });

    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const dest = new URL("/mypage", request.url);
    dest.searchParams.set("login", "ok");
    // ⚠️ 以前はここで dataId を **HttpOnlyでないCookie** `cooksync_dataid` として配っていた。
    //    dataId は「どのデータを触れるか」を決める値なので、JSから読める場所に置くのは
    //    鍵を玄関マットの下に置くのと同じ（XSS・拡張機能・共用端末で拾える）。
    //    クライアントは代わりに **Cookie必須の /api/auth/session** から受け取る。
    return new Response(null, {
      status: 302,
      headers: [
        ["Location", dest.toString()],
        ["Set-Cookie", sessionCookie(token)],
        // stateは使い捨て。必ず消す。
        [
          "Set-Cookie",
          `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
        ],
        // 過去に配ってしまった dataId Cookie を確実に消す（古い端末に残っている）
        ["Set-Cookie", `cooksync_dataid=; Path=/; SameSite=Lax; Max-Age=0${secure}`],
      ],
    });
  } catch {
    return fail(request, "exchange");
  }
}
