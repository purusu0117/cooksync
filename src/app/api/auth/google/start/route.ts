// Googleログインの開始。認可画面へリダイレクトする。
// CSRF対策：ランダムな state を作り、cookie にも同じ値を置いてコールバックで突き合わせる。

import { randomBytes } from "crypto";
import { OAUTH_STATE_COOKIE, authorizeUrl, googleConfigured } from "@/lib/oauthGoogle";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!googleConfigured()) {
    return Response.json(
      {
        error:
          "Googleログインは未設定です（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）。",
      },
      { status: 501 },
    );
  }
  const state = randomBytes(16).toString("hex");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl(request, state),
      // 認可画面から戻ってくるまでの短命cookie。SameSite=Lax でリダイレクト時も送られる。
      "Set-Cookie": `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
    },
  });
}
