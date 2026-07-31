// サーバー専用：プッシュ通知の送信口。アプリを閉じていても通知を届ける。
//  - Web（ブラウザ/PWA）… Web Push（VAPID）
//  - ネイティブアプリ（iOS）… APNs（apns.ts）。WKWebViewは Web Push を受け取れないため。
// 宛先は同じ uid で持ち、sendPush() が両方へ振り分ける（同じ人がWebとアプリを併用してもよい）。
//  - 公開（Vercel）：VAPID鍵は環境変数、購読/端末トークンはRedisにユーザー別保存。
//  - ローカル：.data/ のファイル（VAPID鍵は自動生成）。
// Route Handlerからのみ使用。

import webpush from "web-push";
import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/kv";
import { sendApns } from "@/lib/apns";
import { identify } from "@/lib/session";
import { isAccountDataId } from "@/lib/userStore";

interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// 保存先。COOKSYNC_DATA_DIR で差し替えられる（テストが大翔の実データを壊さないため）。
function DIR(): string {
  return process.env.COOKSYNC_DATA_DIR || path.join(process.cwd(), ".data");
}
const VAPID_FILE = () => path.join(DIR(), "vapid.json");
const SUBS_FILE = () => path.join(DIR(), "push-subs.json");
const DEVICES_FILE = () => path.join(DIR(), "push-devices.json");
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:daito150117@gmail.com";

let configured = false;

async function ensureVapid(): Promise<{ publicKey: string; privateKey: string }> {
  let keys: { publicKey: string; privateKey: string };
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    // 公開：環境変数
    keys = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
  } else {
    // ローカル：ファイル（無ければ生成）
    await fs.mkdir(DIR(), { recursive: true });
    try {
      keys = JSON.parse(await fs.readFile(VAPID_FILE(), "utf8"));
    } catch {
      keys = webpush.generateVAPIDKeys();
      await fs.writeFile(VAPID_FILE(), JSON.stringify(keys), "utf8");
    }
  }
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
    configured = true;
  }
  return keys;
}

export async function getPublicKey(): Promise<string> {
  return (await ensureVapid()).publicKey;
}

// ---- 購読の保存（ユーザー別）----
function safeUid(uid: string): string {
  return (uid || "anon").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anon";
}
function subsKey(uid: string): string {
  return `cooksync:push:${safeUid(uid)}`;
}

async function readSubs(uid: string): Promise<PushSub[]> {
  if (redis) {
    const v = await redis.get<unknown>(subsKey(uid));
    if (!v) return [];
    const arr = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(arr) ? (arr as PushSub[]) : [];
  }
  try {
    return JSON.parse(await fs.readFile(SUBS_FILE(), "utf8"));
  } catch {
    return [];
  }
}
async function writeSubs(uid: string, subs: PushSub[]): Promise<void> {
  if (redis) {
    await redis.set(subsKey(uid), JSON.stringify(subs));
    return;
  }
  await fs.mkdir(DIR(), { recursive: true });
  await fs.writeFile(SUBS_FILE(), JSON.stringify(subs), "utf8");
}

export async function addSubscription(uid: string, sub: PushSub): Promise<void> {
  if (!sub?.endpoint) return;
  const subs = await readSubs(uid);
  if (!subs.some((s) => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    await writeSubs(uid, subs);
  }
}

// ---- ネイティブアプリの端末トークン（APNs用・ユーザー別）----
function devicesKey(uid: string): string {
  return `cooksync:apns:${safeUid(uid)}`;
}
// トークン→所有uid。同じiPhoneを別uidで使い回したとき、前の持ち主から外すために持つ
function ownerKey(token: string): string {
  return `cooksync:apnsowner:${token}`;
}

async function readDeviceFile(): Promise<Record<string, string[]>> {
  try {
    const v = JSON.parse(await fs.readFile(DEVICES_FILE(), "utf8"));
    return v && typeof v === "object" ? (v as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}
async function writeDeviceFile(map: Record<string, string[]>): Promise<void> {
  await fs.mkdir(DIR(), { recursive: true });
  await fs.writeFile(DEVICES_FILE(), JSON.stringify(map), "utf8");
}

async function readDevices(uid: string): Promise<string[]> {
  if (redis) {
    const v = await redis.get<unknown>(devicesKey(uid));
    if (!v) return [];
    const arr = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(arr) ? (arr as string[]) : [];
  }
  return (await readDeviceFile())[safeUid(uid)] || [];
}
async function writeDevices(uid: string, tokens: string[]): Promise<void> {
  if (redis) {
    await redis.set(devicesKey(uid), JSON.stringify(tokens));
    return;
  }
  const map = await readDeviceFile();
  map[safeUid(uid)] = tokens;
  await writeDeviceFile(map);
}

/** ネイティブアプリの端末トークンを登録（アプリ起動時に毎回呼ばれる＝冪等） */
export async function addDevice(uid: string, token: string): Promise<void> {
  if (!token) return;
  if (redis) {
    const prev = await redis.get<string>(ownerKey(token));
    if (prev && prev !== safeUid(uid)) {
      // 端末の持ち主が変わった → 前のuidの一覧から外す（他人に通知が飛ばないように）
      const old = await readDevices(prev);
      if (old.includes(token)) await writeDevices(prev, old.filter((t) => t !== token));
    }
    await redis.set(ownerKey(token), safeUid(uid));
  } else {
    const map = await readDeviceFile();
    let changed = false;
    for (const key of Object.keys(map)) {
      if (key !== safeUid(uid) && map[key]?.includes(token)) {
        map[key] = map[key].filter((t) => t !== token);
        changed = true;
      }
    }
    if (changed) await writeDeviceFile(map);
  }
  const list = await readDevices(uid);
  if (!list.includes(token)) await writeDevices(uid, [...list, token]);
}

/** 端末トークンの削除（token省略でそのuidの全端末） */
export async function removeDevice(uid: string, token?: string): Promise<void> {
  const list = await readDevices(uid);
  const next = token ? list.filter((t) => t !== token) : [];
  if (next.length !== list.length) await writeDevices(uid, next);
  if (redis) {
    for (const t of token ? [token] : list) await redis.del(ownerKey(t));
  }
}

/** Web Push（ブラウザ/PWA）へ送る。届いた件数を返す */
async function sendWebPush(
  uid: string,
  payload: { title: string; body: string; url?: string },
): Promise<number> {
  await ensureVapid();
  const subs = await readSubs(uid);
  if (subs.length === 0) return 0;
  const json = JSON.stringify(payload);
  const alive: PushSub[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s, json);
        alive.push(s);
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // 404/410 = 失効した購読 → 破棄。それ以外は残す
        if (code !== 404 && code !== 410) alive.push(s);
      }
    }),
  );
  if (alive.length !== subs.length) await writeSubs(uid, alive);
  return sent;
}

/** ネイティブアプリ（iOS）へ APNs で送る。届いた件数を返す */
async function sendNativePush(
  uid: string,
  payload: { title: string; body: string; url?: string },
): Promise<number> {
  const tokens = await readDevices(uid);
  if (tokens.length === 0) return 0;
  const { sent, dead } = await sendApns(tokens, payload);
  if (dead.length > 0) {
    await writeDevices(
      uid,
      tokens.filter((t) => !dead.includes(t)),
    );
    if (redis) for (const t of dead) await redis.del(ownerKey(t));
  }
  return sent;
}

/**
 * 通知を送る。宛先の種類で自動的に振り分ける。
 *  - ブラウザ/PWAの購読 → Web Push
 *  - ネイティブアプリの端末トークン → APNs
 * 片方しか無ければ片方だけ送る（どちらも無ければ何もしない）。
 */
export async function sendPush(
  uid: string,
  payload: { title: string; body: string; url?: string },
): Promise<{ web: number; native: number }> {
  const [web, native] = await Promise.all([
    sendWebPush(uid, payload).catch(() => 0),
    sendNativePush(uid, payload).catch(() => 0),
  ]);
  return { web, native };
}

/**
 * 通知の宛先uidを決める。**購読を登録・解除する経路は必ずここを通す。**
 *
 * ⚠️ /api/push/subscribe は body の `u` を**無検証**で購読キーにしていた
 *    （2026-08-01 監査 H-6）。攻撃者は自分のendpointを被害者のuidで登録でき、
 *    レシピ名や献立が載った通知をそのまま受け取れた。
 *
 * ルールは /api/store と同じ:
 *   ① セッションCookieがある → その人の dataId（申告値は無視）
 *   ② Cookieが無い          → 端末のUUIDのみ。**登録済みアカウントの dataId は名乗れない**
 */
export async function resolvePushTarget(
  request: Request,
  claimed?: string | null,
): Promise<{ uid: string; trusted: boolean } | null> {
  const q = (claimed || "anon").trim() || "anon";
  const id = identify(request, q);
  if (id.trusted) return { uid: id.dataId, trusted: true };
  if (q === "anon") return { uid: "anon", trusted: false };
  if (await isAccountDataId(q)) return null;
  return { uid: q, trusted: false };
}

/**
 * アカウント削除用：その uid の通知購読・端末トークンを**全部**消す。
 * これが漏れていたため、削除後も iPhone に通知が届き続ける状態だった（監査 H-10(c)）。
 */
export async function purgePushFor(uid: string): Promise<void> {
  const tokens = await readDevices(uid).catch(() => [] as string[]);
  if (redis) {
    await redis.del(subsKey(uid), devicesKey(uid));
    for (const t of tokens) await redis.del(ownerKey(t));
    return;
  }
  const map = await readDeviceFile();
  if (map[safeUid(uid)]) {
    delete map[safeUid(uid)];
    await writeDeviceFile(map);
  }
  await writeSubs(uid, []);
}
