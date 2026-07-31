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
    // クライアント側のデータIDを合わせるため dataId も渡す（HttpOnlyではない別Cookie）
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
        // JSから読める形で dataId を1回だけ渡す（読んだら消す運用）
        [
          "Set-Cookie",
          `cooksync_dataid=${encodeURIComponent(user.dataId)}; Path=/; SameSite=Lax; Max-Age=120${secure}`,
        ],
      ],
    });
  } catch {
    return fail(request, "exchange");
  }
}
