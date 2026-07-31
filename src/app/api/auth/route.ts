// メール＋パスワードのサーバー認証。email → dataId をレジストリに保存し、
// どの端末/コンテキストからでも同じデータ(dataId)に辿り着けるようにする。
//  - 公開：Redis hash `cooksync:users`（field=email, value=JSON）
//  - ローカル：.data/users.json
//
// パスワードは scrypt でハッシュ化して保存する（2026-07-31に平文保存から移行）。
// 既存ユーザーの平文レコードは、次回ログイン成功時に自動でハッシュへ移行する。
//
// ⚠️ このメール+パスワード方式は暫定。捨てアドで無限にアカウントを作れるため、
//    公開時は Google OAuth / Sign in with Apple に置き換える。
//    → .secretary/Decisions/2026-07-31-cooksync-profitable-monetization.md §4
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, sessionCookie } from "@/lib/session";
import { getUser, normEmail as norm, putUser } from "@/lib/userStore";

export const dynamic = "force-dynamic";

/** ログイン成功時は**サーバー発行のセッションCookie**も配る。
 *  これがあるとAIの枠がクライアントの申告ではなくCookieで数えられる（偽装不可）。 */
function withSession(
  body: Record<string, unknown>,
  s: { uid: string; dataId: string; email: string; name: string },
): Response {
  return Response.json(body, {
    headers: { "Set-Cookie": sessionCookie(createSession(s)) },
  });
}

export async function POST(request: Request) {
  try {
    const { action, name, email, password } = (await request.json()) as {
      action?: string;
      name?: string;
      email?: string;
      password?: string;
    };
    const em = norm(email || "");
    if (!em || !password) {
      return Response.json(
        { error: "メールとパスワードを入力してください。" },
        { status: 400 },
      );
    }

    if (action === "register") {
      if (!name || !name.trim()) {
        return Response.json({ error: "お名前を入力してください。" }, { status: 400 });
      }
      const existing = await getUser(em);
      if (existing) {
        return Response.json(
          { error: "このメールは既に登録済みです。ログインしてください。" },
          { status: 409 },
        );
      }
      if (password.length < 8) {
        return Response.json(
          { error: "パスワードは8文字以上にしてください。" },
          { status: 400 },
        );
      }
      const dataId = globalThis.crypto.randomUUID();
      await putUser(em, {
        dataId,
        name: name.trim(),
        password: await hashPassword(password),
        createdAt: Date.now(),
      });
      return withSession(
        { ok: true, dataId, name: name.trim(), email: em },
        { uid: dataId, dataId, email: em, name: name.trim() },
      );
    }

    // login
    const u = await getUser(em);
    // ユーザーが居なくても照合処理は走らせる（応答時間の差でメール存在を推測されないように）
    const { ok, needsUpgrade } = await verifyPassword(password, u?.password ?? "");
    if (!u || !ok) {
      return Response.json(
        { error: "メールアドレスかパスワードが違います。" },
        { status: 401 },
      );
    }
    // 平文で保存されていた旧レコードを、この機会にハッシュへ移行する
    if (needsUpgrade) {
      await putUser(em, { ...u, password: await hashPassword(password) }).catch(() => {});
    }
    return withSession(
      { ok: true, dataId: u.dataId, name: u.name, email: em },
      { uid: u.dataId, dataId: u.dataId, email: em, name: u.name },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "auth failed" },
      { status: 500 },
    );
  }
}
