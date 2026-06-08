// サーバー専用：Web Push（VAPID）。アプリを閉じていても通知を届ける。
// VAPID鍵と購読情報は .data/ に保存（gitignore）。Route Handlerからのみ使用。

import webpush from "web-push";
import { promises as fs } from "fs";
import path from "path";

interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const DIR = path.join(process.cwd(), ".data");
const VAPID_FILE = path.join(DIR, "vapid.json");
const SUBS_FILE = path.join(DIR, "push-subs.json");

let configured = false;

async function ensureVapid(): Promise<{ publicKey: string; privateKey: string }> {
  await fs.mkdir(DIR, { recursive: true });
  let keys: { publicKey: string; privateKey: string };
  try {
    keys = JSON.parse(await fs.readFile(VAPID_FILE, "utf8"));
  } catch {
    keys = webpush.generateVAPIDKeys();
    await fs.writeFile(VAPID_FILE, JSON.stringify(keys), "utf8");
  }
  if (!configured) {
    webpush.setVapidDetails(
      "mailto:daito150117@gmail.com",
      keys.publicKey,
      keys.privateKey,
    );
    configured = true;
  }
  return keys;
}

export async function getPublicKey(): Promise<string> {
  return (await ensureVapid()).publicKey;
}

async function readSubs(): Promise<PushSub[]> {
  try {
    return JSON.parse(await fs.readFile(SUBS_FILE, "utf8"));
  } catch {
    return [];
  }
}
async function writeSubs(subs: PushSub[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(SUBS_FILE, JSON.stringify(subs), "utf8");
}

export async function addSubscription(sub: PushSub): Promise<void> {
  if (!sub?.endpoint) return;
  const subs = await readSubs();
  if (!subs.some((s) => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    await writeSubs(subs);
  }
}

export async function sendPush(payload: {
  title: string;
  body: string;
  url?: string;
}): Promise<void> {
  await ensureVapid();
  const subs = await readSubs();
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
  if (alive.length !== subs.length) await writeSubs(alive);
}
