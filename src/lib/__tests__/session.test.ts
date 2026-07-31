import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  identify,
  readCookie,
  sessionCookie,
  verifySession,
} from "../session";

const SECRET = "test-secret-value-1234567890";

beforeEach(() => {
  process.env.COOKSYNC_SESSION_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.COOKSYNC_SESSION_SECRET;
});

function reqWithCookie(cookie: string): Request {
  return new Request("http://localhost/api/research", { headers: { cookie } });
}

describe("createSession / verifySession", () => {
  it("発行したセッションを検証できる", () => {
    const t = createSession({ uid: "google:123", dataId: "d-1", email: "a@b.c", name: "大翔" });
    const s = verifySession(t);
    expect(s?.uid).toBe("google:123");
    expect(s?.dataId).toBe("d-1");
    expect(s?.email).toBe("a@b.c");
  });

  it("**中身を書き換えたら無効**（uidの偽装ができない＝これが枠の土台）", () => {
    const t = createSession({ uid: "google:123", dataId: "d-1" });
    const [body, sig] = t.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), uid: "google:999" }),
    ).toString("base64url");
    expect(verifySession(`${tampered}.${sig}`)).toBeNull();
  });

  it("署名だけ差し替えても無効", () => {
    const t = createSession({ uid: "u", dataId: "d" });
    expect(verifySession(`${t.split(".")[0]}.AAAA`)).toBeNull();
  });

  it("別の鍵で署名されたものは無効（鍵を変えれば全セッションが失効する）", () => {
    const t = createSession({ uid: "u", dataId: "d" });
    process.env.COOKSYNC_SESSION_SECRET = "another-secret-value-0987654321";
    expect(verifySession(t)).toBeNull();
  });

  it("期限切れは無効", () => {
    const t = createSession({ uid: "u", dataId: "d" }, -10); // 10秒前に失効
    expect(verifySession(t)).toBeNull();
  });

  it("壊れた値・空でも落ちない", () => {
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession("")).toBeNull();
    expect(verifySession("nodot")).toBeNull();
    expect(verifySession("...")).toBeNull();
    expect(verifySession("!!!.???")).toBeNull();
  });

  it("uid/dataIdが欠けた中身は受け付けない", () => {
    // 正しい鍵で署名されていても、必須フィールドが無ければ拒否する
    const body = Buffer.from(
      JSON.stringify({ iat: 0, exp: Math.floor(Date.now() / 1000) + 60 }),
    ).toString("base64url");
    const t = createSession({ uid: "x", dataId: "y" });
    expect(verifySession(`${body}.${t.split(".")[1]}`)).toBeNull();
  });
});

describe("readCookie", () => {
  it("複数あるCookieから目的のものを取れる", () => {
    const r = reqWithCookie("a=1; cooksync_session=abc; b=2");
    expect(readCookie(r, SESSION_COOKIE)).toBe("abc");
    expect(readCookie(r, "b")).toBe("2");
    expect(readCookie(r, "nope")).toBeUndefined();
  });

  it("Cookieヘッダが無くても落ちない", () => {
    expect(readCookie(new Request("http://localhost/"), SESSION_COOKIE)).toBeUndefined();
  });
});

describe("sessionCookie", () => {
  it("HttpOnly と SameSite を必ず付ける（JSから盗めないように）", () => {
    const c = sessionCookie("tok");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
  });
  it("ログアウトは Max-Age=0 で即時失効", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
});

describe("identify（移行期の切り分け）", () => {
  it("Cookieがあればそれを正とし、trusted になる", () => {
    const t = createSession({ uid: "google:abc", dataId: "d-9" });
    const r = reqWithCookie(`${SESSION_COOKIE}=${encodeURIComponent(t)}`);
    const id = identify(r, "clientClaimedUid");
    expect(id.uid).toBe("google:abc"); // クライアントの申告は無視される
    expect(id.trusted).toBe(true);
  });

  it("Cookieが無ければクライアントの値にフォールバックし、trusted=false", () => {
    const id = identify(new Request("http://localhost/"), "legacy-uuid");
    expect(id.uid).toBe("legacy-uuid");
    expect(id.trusted).toBe(false);
  });

  it("Cookieもクライアント値も無ければ anon", () => {
    expect(identify(new Request("http://localhost/")).uid).toBe("anon");
  });

  it("偽造Cookieはフォールバック扱いになる（信用しない）", () => {
    const r = reqWithCookie(`${SESSION_COOKIE}=forged.value`);
    const id = identify(r, "legacy-uuid");
    expect(id.uid).toBe("legacy-uuid");
    expect(id.trusted).toBe(false);
  });
});
