// サーバー専用：Web Push（VAPID）。アプリを閉じていても通知を届ける。
//  - 公開（Vercel）：VAPID鍵は環境変数、購読はRedisにユーザー別保存。
//  - ローカル：.data/ のファイル（VAPID鍵は自動生成）。
// Route Handlerからのみ使用。

import webpush from "web-push";
import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/kv";

interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const DIR = path.join(process.cwd(), ".data");
const VAPID_FILE = path.join(DIR, "vapid.json");
const SUBS_FILE = path.join(DIR, "push-subs.json");
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
    await fs.mkdir(DIR, { recursive: true });
    try {
      keys = JSON.parse(await fs.readFile(VAPID_FILE, "utf8"));
    } catch {
      keys = webpush.generateVAPIDKeys();
      await fs.writeFile(VAPID_FILE, JSON.stringify(keys), "utf8");
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
function subsKey(uid: string): string {
  const safe = (uid || "anon").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anon";
  return `cooksync:push:${safe}`;
}

async function readSubs(uid: string): Promise<PushSub[]> {
  if (redis) {
    const v = await redis.get<unknown>(subsKey(uid));
    if (!v) return [];
    const arr = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(arr) ? (arr as PushSub[]) : [];
  }
  try {
    return JSON.parse(await fs.readFile(SUBS_FILE, "utf8"));
  } catch {
    return [];
  }
}
async function writeSubs(uid: string, subs: PushSub[]): Promise<void> {
  if (redis) {
    await redis.set(subsKey(uid), JSON.stringify(subs));
    return;
  }
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(SUBS_FILE, JSON.stringify(subs), "utf8");
}

export async function addSubscription(uid: string, sub: PushSub): Promise<void> {
  if (!sub?.endpoint) return;
  const subs = await readSubs(uid);
  if (!subs.some((s) => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    await writeSubs(uid, subs);
  }
}

export async function sendPush(
  uid: string,
  payload: { title: string; body: string; url?: string },
): Promise<void> {
  await ensureVapid();
  const subs = await readSubs(uid);
  if (subs.length === 0) return;
  const json = JSON.stringify(payload);
  const alive: PushSub[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s, json);
        alive.push(s);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // 404/410 = 失効した購読 → 破棄。それ以外は残す
        if (code !== 404 && code !== 410) alive.push(s);
      }
    }),
  );
  if (alive.length !== subs.length) await writeSubs(uid, alive);
}
