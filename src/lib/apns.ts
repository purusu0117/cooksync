// サーバー専用：iOSネイティブアプリへのプッシュ通知（APNs）。
//
// なぜ必要か: ネイティブアプリ（WKWebView）は Web Push を受け取れない（Appleの公式回答）。
// 「タイマー完了」「レシピが見つかりました」をアプリを閉じた状態で届けるには APNs で送る。
//
// 実装: Node組み込みの http2 で APNs の HTTP/2 API を直接叩く。
//   CashSync では @parse/node-apn が Vercel のサーバーレス環境で無言失敗したため、
//   生http2に置き換えた実績がある。同じ方式をそのまま使う。認証はトークン方式(.p8)。
//
// 必要な環境変数（未設定なら送信をスキップするだけ＝アプリは落ちない）:
//   APNS_KEY_BASE64 … APNs認証キー(.p8)を base64 にしたもの
//   APNS_KEY_ID     … そのキーのID（10桁）
//   APNS_TEAM_ID    … チームID（10桁）
//   APNS_BUNDLE_ID  … 省略時 com.daito.cooksync
//   APNS_PRODUCTION … "0" でサンドボックス。既定は本番（TestFlight/App Store配布は本番）
import crypto from "crypto";
import http2 from "http2";

function apnsHost(): string {
  return process.env.APNS_PRODUCTION !== "0"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
}

function bundleId(): string {
  return process.env.APNS_BUNDLE_ID || "com.daito.cooksync";
}

/** APNsの鍵が揃っているか（未設定なら送信そのものを行わない） */
export function apnsConfigured(): boolean {
  return (
    !!process.env.APNS_KEY_BASE64 && !!process.env.APNS_KEY_ID && !!process.env.APNS_TEAM_ID
  );
}

// APNsのプロバイダトークン(JWT)。Appleは20分〜60分での再利用を要求するのでキャッシュする。
let cachedJwt: { token: string; at: number } | null = null;
function providerToken(): string | null {
  const keyB64 = process.env.APNS_KEY_BASE64;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  if (!keyB64 || !keyId || !teamId) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.at < 2700) return cachedJwt.token; // 45分キャッシュ
  const key = Buffer.from(keyB64, "base64").toString("utf8");
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = enc({ alg: "ES256", kid: keyId });
  const payload = enc({ iss: teamId, iat: now });
  const signer = crypto.createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const sig = signer.sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const token = `${header}.${payload}.${sig}`;
  cachedJwt = { token, at: now };
  return token;
}

export interface ApnsResult {
  token: string; // 先頭のみ（診断表示用）
  status: number;
  reason?: string;
}

export interface ApnsPayload {
  title: string;
  body: string;
  url?: string; // 通知タップ時に開くページ（Web版のSWと同じキー名）
}

/** 1回の接続で複数トークンへ送る。各トークンの APNs 応答(status/reason)を返す */
async function deliver(tokens: string[], payload: ApnsPayload): Promise<ApnsResult[]> {
  const jwt = providerToken();
  if (!jwt || tokens.length === 0) return [];
  const body = JSON.stringify({
    aps: { alert: { title: payload.title, body: payload.body }, sound: "default" },
    url: payload.url || "/",
  });
  const topic = bundleId();
  const expiry = String(Math.floor(Date.now() / 1000) + 3600);
  return await new Promise<ApnsResult[]>((resolve) => {
    const client = http2.connect(apnsHost());
    const results: ApnsResult[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {
        /* noop */
      }
      resolve(results);
    };
    // 接続自体が張れない場合（サーバーレスでの失敗はここに出る）
    client.on("error", () => finish());
    const timer = setTimeout(finish, 15_000); // 全体タイムアウト
    let pending = tokens.length;
    const one = () => {
      if (--pending <= 0) {
        clearTimeout(timer);
        finish();
      }
    };
    for (const token of tokens) {
      const req = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": expiry,
      });
      let status = 0;
      let data = "";
      req.on("response", (h) => {
        status = Number(h[":status"]) || 0;
      });
      req.setEncoding("utf8");
      req.on("data", (d) => (data += d));
      req.on("end", () => {
        let reason: string | undefined;
        if (data) {
          try {
            reason = JSON.parse(data).reason;
          } catch {
            /* noop */
          }
        }
        results.push({ token: token.slice(0, 8), status, reason });
        one();
      });
      req.on("error", (e) => {
        results.push({
          token: token.slice(0, 8),
          status: 0,
          reason: `req_error:${(e as Error).message}`,
        });
        one();
      });
      req.end(body);
    }
  });
}

/**
 * iOSネイティブアプリへ通知を送る。
 * 戻り値の dead は「もう存在しない端末トークン」＝保存側で消してよいもの。
 * 鍵が未設定なら何もせず 0件で返す（アプリは落ちない）。
 */
export async function sendApns(
  tokens: string[],
  payload: ApnsPayload,
): Promise<{ sent: number; dead: string[]; results: ApnsResult[] }> {
  if (!apnsConfigured() || tokens.length === 0) return { sent: 0, dead: [], results: [] };
  try {
    const results = await deliver(tokens, payload);
    const dead: string[] = [];
    for (const r of results) {
      const bad = r.status === 410 || r.reason === "BadDeviceToken" || r.reason === "Unregistered";
      // results は完了順なので、先頭8文字で元のトークンを引き当てる
      if (bad) {
        const full = tokens.find((t) => t.startsWith(r.token));
        if (full) dead.push(full);
      }
    }
    const sent = results.filter((r) => r.status === 200).length;
    if (sent < results.length) {
      console.error(
        "[apns] 送信失敗あり:",
        results
          .filter((r) => r.status !== 200)
          .map((r) => `${r.status}:${r.reason ?? ""}`)
          .join(", ") || "(応答なし)",
      );
    }
    return { sent, dead, results };
  } catch (e) {
    console.error("[apns] 送信エラー:", e);
    return { sent: 0, dead: [], results: [] };
  }
}
