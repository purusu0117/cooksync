// 署名付きセッションCookie。**サーバーだけが発行でき、クライアントは改竄できない**。
//
// なぜ要るか：
//   いまAIの枠は、クライアントが送ってくる `u`（localStorageのUUID）で数えている。
//   これは**書き換え放題**なので、枠をリセットし放題＝1軸目が砂の上に建っている。
//   セッションCookieに切り替えると uid をサーバーが決めるので、初めて枠が意味を持つ。
//
// 依存を増やさないため JWT ライブラリは使わず、HMAC-SHA256 で自前署名する
// （用途が「自分が発行して自分が検証する」だけなので、これで必要十分）。
//
// 形式:  base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload))

import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "cooksync_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 60; // 60日

export interface SessionPayload {
  /** 枠・データの identity。OAuth移行後は "google:<sub>" 形式 */
  uid: string;
  /** 実データの保存先ID（既存の /api/auth が返す dataId をそのまま使う） */
  dataId: string;
  email?: string;
  name?: string;
  /** 発行時刻（秒） */
  iat: number;
  /** 失効時刻（秒） */
  exp: number;
}

/** 署名鍵。本番で未設定なら**発行させない**（弱い鍵で運用するより落ちた方が良い）。 */
function secret(): string {
  const s = process.env.COOKSYNC_SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "COOKSYNC_SESSION_SECRET が未設定です（16文字以上のランダム文字列を設定してください）",
    );
  }
  return "dev-only-insecure-secret-do-not-ship";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(body: string): string {
  return b64url(createHmac("sha256", secret()).update(body).digest());
}

/** セッション文字列を作る（Cookieに入れる値） */
export function createSession(
  data: Omit<SessionPayload, "iat" | "exp">,
  maxAgeSec: number = MAX_AGE_SEC,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { ...data, iat: now, exp: now + maxAgeSec };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${sign(body)}`;
}

/** 検証して中身を返す。改竄・期限切れ・形式不正はすべて null。 */
export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const expected = Buffer.from(sign(body));
    const actual = Buffer.from(sig);
    // 長さが違うと timingSafeEqual が投げるので先に見る
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(unb64url(body).toString("utf8")) as SessionPayload;
    if (!payload?.uid || !payload?.dataId) return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Cookieヘッダから1つ取り出す（next/headers に依存しないので Route Handler でそのまま使える） */
export function readCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** Set-Cookie の値を組み立てる。HttpOnly＝JSから読めない＝XSSで盗まれにくい。 */
export function sessionCookie(token: string, maxAgeSec: number = MAX_AGE_SEC): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

/** ログアウト用（即時失効） */
export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/**
 * リクエストから **信頼できる** uid / dataId を取り出す。
 *
 * 移行期の方針：
 *   Cookieがあればそれを正とする（＝偽装不可）。
 *   無ければ従来どおりクライアントの値にフォールバックする（既存ユーザーを締め出さないため）。
 *   `trusted` を見れば、その uid が信頼できるものかどうかを呼び出し側で判別できる。
 */
export function identify(
  request: Request,
  fallbackUid?: string,
): { uid: string; dataId: string; trusted: boolean; email?: string } {
  const s = verifySession(readCookie(request, SESSION_COOKIE));
  if (s) return { uid: s.uid, dataId: s.dataId, trusted: true, email: s.email };
  const u = fallbackUid || "anon";
  return { uid: u, dataId: u, trusted: false };
}
