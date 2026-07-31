// Google OAuth（Authorization Code フロー）。**1人1アカウントを担保する土台**。
//
// なぜ必要か：
//   いまのメール+パスワード登録は捨てアドで無限にアカウントを作れる。
//   Googleアカウントの新規作成には電話番号が要るので、複数作成のコストが跳ね上がる。
//   さらに uid を Google の `sub`（不変のユーザーID）にすると、
//   メールアドレスを変えられても同一人物として追える。
//
// 依存は増やさない：認可URL生成とトークン交換は fetch だけで足りる。
//
// ⚠️ IDトークンの署名検証について：
//   ここでは **Googleのトークンエンドポイントから TLS で直接受け取った** IDトークンだけを扱う。
//   この経路に限り、OIDC仕様(§3.1.3.7)でも署名検証は必須ではない（発行元が保証されているため）。
//   クライアント経由で受け取ったIDトークンを検証なしで信用してはいけない。ここではやらない。

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const OAUTH_STATE_COOKIE = "cooksync_oauth_state";

export interface GoogleProfile {
  /** Googleの不変ユーザーID。メールを変えても変わらない＝identityの軸に使う */
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
}

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** コールバックURL。環境ごとに変わるのでリクエストのオリジンから組み立てる。 */
export function redirectUri(request: Request): string {
  const explicit = process.env.COOKSYNC_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const url = new URL(request.url);
  // プロキシ配下（Vercel/Tailscale）では x-forwarded-* を優先する
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}/api/auth/google/callback`;
}

/** 認可画面のURL。state はCSRF対策（cookieに同じ値を置いて突き合わせる）。 */
export function authorizeUrl(request: Request, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    // 毎回アカウント選択を出す（別アカウントに切り替えたい人のため）
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

/** JWTのペイロード部だけを取り出す（署名検証は上記の理由により行わない） */
function decodeIdToken(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  if (parts.length < 2) throw new Error("invalid id_token");
  const json = Buffer.from(
    parts[1].replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

/** 認可コードをプロフィールに交換する */
export async function exchangeCode(
  request: Request,
  code: string,
): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(request),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`token exchange failed (${res.status}) ${body.slice(0, 200)}`);
  }
  const tok = (await res.json()) as { id_token?: string };
  if (!tok.id_token) throw new Error("id_token missing");

  const claims = decodeIdToken(tok.id_token);
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!sub) throw new Error("sub missing");
  return {
    sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === "string" ? claims.name : undefined,
  };
}

/** uid の形。既存のUUID系uidと衝突しないよう接頭辞を付ける。 */
export function uidFor(profile: GoogleProfile): string {
  return `google:${profile.sub}`;
}
