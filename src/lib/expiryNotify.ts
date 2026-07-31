// 賞味期限が近い食材を **1日1通にまとめて** 知らせる仕組み（サーバー専用）。
//
// なぜ要るか:
//   競合（pecco / リミッター / タベキル / AI冷蔵庫 / Rezo）は全社が期限通知を持っている。
//   CookSync だけ未実装で、「無いと土俵に上がれない」機能だった。
//   通知の土台（Web Push + APNs）はタイマー用に出来ているので、足りないのは
//   ①定期実行 ②期限の判定 ③ユーザーごとの設定 の3つだけ。
//
// 設計の要点:
//   ・**AIを一切呼ばない**。判定は food.ts の既存の期限区分（🔴超優先/🟡優先/🟢余裕）の再利用だけ。
//   ・冷蔵庫のデータはサーバー（Redis / ローカルは .data/store.json）にあるので、
//     端末が起動していなくてもサーバー側だけで判定できる。
//   ・**1日1通**。食材ごとに何通も送らない（body に「ほか2件」とまとめる）。
//   ・**同じ食材で毎日鳴らし続けない**。「どの食材を・どの段階で知らせたか」を記録し、
//     3日前→1日前→当日 のように段階が進んだときだけ鳴らす（1つの食材につき最大でも数回）。
//   ・宛先 uid は **設定を保存する時点で resolvePushTarget() が確定させたもの**しか登録しない。
//     ここ（定期実行）はリクエストが無いので、名乗りを信じる余地がそもそも無い。
//
// 保存先:
//   公開(Redis)  cooksync:expiry:uids（通知ONの人の集合）
//                cooksync:expiry:cfg:<uid>（設定）
//                cooksync:expiry:sent:<uid>（知らせ済みの記録）
//   ローカル     .data/expiry-notify.json

import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/kv";
import { localReadAll } from "@/lib/storeLocal";
import { sendPush } from "@/lib/pushServer";
import { bucketOf, daysUntil, type FridgeItem } from "@/lib/food";

/** 冷蔵庫の保存キー。storage.ts の `fridgeStore.key` と同じ値でなければならない
 *  （ズレると通知が永遠に0件になる）。テストで一致を固定している。 */
export const FRIDGE_STORE_KEY = "fridge-app:items:v2";

// ---------------------------------------------------------------- 設定

export interface ExpirySettings {
  /** 通知を受け取るか */
  enabled: boolean;
  /** 何日前に知らせるか（当日・期限切れは選択に関わらず常に対象） */
  leadDays: number[];
  /** 送る時刻（0-23・その人の現地時刻） */
  hour: number;
  /** その端末の getTimezoneOffset() の値。日本は -540 */
  tzOffsetMinutes: number;
  /** 最後に送った日（現地時刻の yyyy-mm-dd）。1日1通を守るための印 */
  lastSentOn?: string;
  /** 送ろうとしたのに宛先が1つも無かった回数。続くと自動でOFFにする */
  misses?: number;
}

/** 既定：夕方18時に「1日前・3日前」。
 *  帰宅途中（18時前後）が最も価値が出る＝働く主婦が献立を考えるのは
 *  「帰宅途中50.4%」「買い物中50.1%」という調査に合わせている。 */
export const DEFAULT_EXPIRY_SETTINGS: ExpirySettings = {
  enabled: false,
  leadDays: [1, 3],
  hour: 18,
  tzOffsetMinutes: -540,
};

/** 画面に出す選択肢（UIとサーバーでズレないよう1か所に置く） */
export const LEAD_DAY_CHOICES = [1, 2, 3, 5, 7];
export const HOUR_CHOICES = [7, 8, 9, 12, 15, 17, 18, 19, 20, 21];

/** 宛先が1つも無い状態がこの回数続いたら自動でOFF（消えた端末を永遠に見に行かない） */
const MAX_MISSES = 7;
/** 知らせ済みの記録を持っておく日数 */
const SENT_TTL_DAYS = 45;

/** 外から来た値を安全な設定に正規化する（画面・APIどちらの入力も必ずここを通す） */
export function normalizeSettings(input: unknown): ExpirySettings {
  const o = (input ?? {}) as Partial<ExpirySettings>;
  const leadRaw = Array.isArray(o.leadDays) ? o.leadDays : DEFAULT_EXPIRY_SETTINGS.leadDays;
  const lead = Array.from(
    new Set(
      leadRaw
        .map((d) => Math.trunc(Number(d)))
        .filter((d) => Number.isFinite(d) && d >= 1 && d <= 14),
    ),
  ).sort((a, b) => a - b);
  const hour = Math.trunc(Number(o.hour));
  const tz = Math.trunc(Number(o.tzOffsetMinutes));
  return {
    enabled: !!o.enabled,
    leadDays: lead.length > 0 ? lead : DEFAULT_EXPIRY_SETTINGS.leadDays,
    hour: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_EXPIRY_SETTINGS.hour,
    // getTimezoneOffset() の取りうる範囲（±14時間）に収める
    tzOffsetMinutes:
      Number.isFinite(tz) && Math.abs(tz) <= 840 ? tz : DEFAULT_EXPIRY_SETTINGS.tzOffsetMinutes,
    ...(typeof o.lastSentOn === "string" ? { lastSentOn: o.lastSentOn } : {}),
    ...(Number.isFinite(Number(o.misses)) ? { misses: Math.max(0, Math.trunc(Number(o.misses))) } : {}),
  };
}

// ------------------------------------------------------- 現地時刻の計算

/** その人の現地時刻での「今日」（yyyy-mm-dd） */
export function localDateISO(now: Date, tzOffsetMinutes: number): string {
  return new Date(now.getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** その人の現地時刻での「時」（0-23） */
export function localHour(now: Date, tzOffsetMinutes: number): number {
  return new Date(now.getTime() - tzOffsetMinutes * 60_000).getUTCHours();
}

// ------------------------------------------------------------- 期限判定

export interface ExpiryTarget {
  item: FridgeItem;
  /** 期限まであと何日（マイナスは過ぎている） */
  days: number;
  /** 「どの段階で知らせたか」の印。当日・期限切れはまとめて "0" */
  stage: string;
  /** 重複送信を防ぐ記録キー。期限を編集したら別物として扱われる */
  key: string;
}

function isValidDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * 今日知らせるべき食材を選ぶ。
 *  ・期限切れ / 今日まで … 常に対象（段階 "0"）
 *  ・あと N 日 … 設定した leadDays に N が**ちょうど一致**したときだけ対象
 * 「N日以下」ではなく「ちょうどN日」なのが肝で、これで毎日同じ食材が並ばない。
 */
export function pickExpiryTargets(
  items: FridgeItem[],
  settings: Pick<ExpirySettings, "leadDays">,
  today: string,
): ExpiryTarget[] {
  const out: ExpiryTarget[] = [];
  for (const item of items) {
    if (!item || !isValidDate(item.expiresOn) || !item.id) continue;
    const days = daysUntil(item.expiresOn, today);
    let stage: string | null = null;
    if (days <= 0) stage = "0";
    else if (settings.leadDays.includes(days)) stage = String(days);
    if (!stage) continue;
    out.push({ item, days, stage, key: `${item.id}:${item.expiresOn}:${stage}` });
  }
  return out.sort((a, b) => a.days - b.days);
}

/** 1件ぶんの言い回し。「動作＋対象＋結果」が分かるように、対象と期限を必ず入れる */
export function expiryPhrase(name: string, days: number): string {
  if (days < 0) return `${name}の期限が切れています`;
  if (days === 0) return `${name}が今日までです`;
  if (days === 1) return `${name}が明日までです`;
  return `${name}があと${days}日です`;
}

/** まとめて1通ぶんの文面を組み立てる（食材ごとに何通も送らない） */
export function buildExpiryPush(
  targets: ExpiryTarget[],
  today: string,
): { title: string; body: string; url: string } {
  const head = targets[0];
  // 絵文字は冷蔵庫画面と同じ区分（🔴超優先 / 🟡優先）を使う
  const emoji = bucketOf(head.item.expiresOn, today) === "priority" ? "🔴" : "🟡";
  const rest = targets.length - 1;
  const phrase = expiryPhrase(head.item.name, head.days);
  return {
    title: `${emoji} 期限が近い食材が${targets.length}件`,
    body:
      (rest > 0 ? `${phrase}。ほか${rest}件。` : `${phrase}。`) +
      "タップで期限順の冷蔵庫を開きます。",
    url: "/fridge",
  };
}

// --------------------------------------------------------------- 保存先

function safeUid(uid: string): string {
  return (uid || "anon").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anon";
}
const UIDS_KEY = "cooksync:expiry:uids";
const cfgKey = (uid: string) => `cooksync:expiry:cfg:${safeUid(uid)}`;
const sentKey = (uid: string) => `cooksync:expiry:sent:${safeUid(uid)}`;

function dir(): string {
  return process.env.COOKSYNC_DATA_DIR || path.join(process.cwd(), ".data");
}
function localFile(): string {
  return path.join(dir(), "expiry-notify.json");
}

interface LocalEntry {
  settings: ExpirySettings;
  sent?: Record<string, number>;
}
interface LocalShape {
  users: Record<string, LocalEntry>;
}

async function readLocal(): Promise<LocalShape> {
  try {
    const raw = JSON.parse(await fs.readFile(localFile(), "utf8")) as LocalShape;
    return raw && typeof raw === "object" && raw.users ? raw : { users: {} };
  } catch {
    return { users: {} };
  }
}
// 読み書きを直列化する（同じ分に複数の書き込みが重なっても記録を失わない）
let lock: Promise<unknown> = Promise.resolve();
function withLocal<T>(fn: (f: LocalShape) => Promise<T>): Promise<T> {
  const op = lock.catch(() => {}).then(async () => fn(await readLocal()));
  lock = op;
  return op;
}
async function writeLocal(f: LocalShape): Promise<void> {
  await fs.mkdir(dir(), { recursive: true });
  const target = localFile();
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(f), "utf8");
  await fs.rename(tmp, target);
}

/** 設定を読む（未設定なら null） */
export async function readSettings(uid: string): Promise<ExpirySettings | null> {
  if (redis) {
    const v = await redis.get<unknown>(cfgKey(uid));
    if (!v) return null;
    return normalizeSettings(typeof v === "string" ? JSON.parse(v) : v);
  }
  return withLocal(async (f) => {
    const e = f.users[safeUid(uid)];
    return e ? normalizeSettings(e.settings) : null;
  });
}

/**
 * 設定を保存する。**uid は呼び出し側が resolvePushTarget() で確定させたもの**であること。
 * enabled=false なら定期実行の巡回対象から外す（設定自体は次に開いたときのために残す）。
 */
export async function writeSettings(uid: string, settings: ExpirySettings): Promise<void> {
  const s = normalizeSettings(settings);
  if (redis) {
    await redis.set(cfgKey(uid), JSON.stringify(s));
    if (s.enabled) await redis.sadd(UIDS_KEY, safeUid(uid));
    else await redis.srem(UIDS_KEY, safeUid(uid));
    return;
  }
  await withLocal(async (f) => {
    const key = safeUid(uid);
    f.users[key] = { ...(f.users[key] ?? {}), settings: s };
    await writeLocal(f);
  });
}

/** 通知ONの人の uid 一覧（定期実行が巡回する対象） */
export async function listNotifyUids(): Promise<string[]> {
  if (redis) return (await redis.smembers(UIDS_KEY)) ?? [];
  return withLocal(async (f) =>
    Object.entries(f.users)
      .filter(([, e]) => e.settings?.enabled)
      .map(([uid]) => uid),
  );
}

async function readSent(uid: string): Promise<Record<string, number>> {
  if (redis) {
    const v = await redis.get<unknown>(sentKey(uid));
    if (!v) return {};
    const o = typeof v === "string" ? JSON.parse(v) : v;
    return o && typeof o === "object" ? (o as Record<string, number>) : {};
  }
  return withLocal(async (f) => f.users[safeUid(uid)]?.sent ?? {});
}

async function writeSent(uid: string, sent: Record<string, number>): Promise<void> {
  if (redis) {
    await redis.set(sentKey(uid), JSON.stringify(sent), { ex: SENT_TTL_DAYS * 86_400 });
    return;
  }
  await withLocal(async (f) => {
    const key = safeUid(uid);
    f.users[key] = {
      settings: f.users[key]?.settings ?? DEFAULT_EXPIRY_SETTINGS,
      sent,
    };
    await writeLocal(f);
  });
}

/** 古い記録を落とす（際限なく太らせない） */
function prune(sent: Record<string, number>, nowMs: number): Record<string, number> {
  const limit = nowMs - SENT_TTL_DAYS * 86_400_000;
  const out: Record<string, number> = {};
  for (const [k, at] of Object.entries(sent)) if (at >= limit) out[k] = at;
  return out;
}

/** アカウント削除・設定OFF時の後始末（残しておいても害はないが、掃除できるようにしておく） */
export async function purgeExpiryNotify(uid: string): Promise<void> {
  if (redis) {
    await redis.del(cfgKey(uid), sentKey(uid));
    await redis.srem(UIDS_KEY, safeUid(uid));
    return;
  }
  await withLocal(async (f) => {
    delete f.users[safeUid(uid)];
    await writeLocal(f);
  });
}

/** その人の冷蔵庫を**サーバー側だけで**読む（/api/store と同じ保存先を直接見る） */
export async function readFridgeItems(uid: string): Promise<FridgeItem[]> {
  let raw: unknown;
  if (redis) {
    raw = await redis.hget<unknown>(`cooksync:u:${safeUid(uid)}`, FRIDGE_STORE_KEY);
  } else {
    raw = (await localReadAll(uid))[FRIDGE_STORE_KEY];
  }
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? (raw as FridgeItem[]) : [];
}

// ------------------------------------------------------------- 定期実行

export type SendFn = (
  uid: string,
  payload: { title: string; body: string; url?: string },
) => Promise<{ web: number; native: number }>;

export interface RunResult {
  /** 巡回した人数（通知ONの人） */
  scanned: number;
  /** 実際に通知を送った人数 */
  notified: number;
  /** 通知に載せた食材の総数 */
  items: number;
}

/**
 * 通知ONの全員を1周して、送るべき人にだけ1通ずつ送る。1時間に1回叩かれる前提。
 *  ・その人の現地時刻が設定した時刻でなければ何もしない
 *  ・同じ日にすでに送っていれば何もしない（QStashの再送で二重に鳴らさない）
 *  ・対象が0件なら**送らない**（「今日は何もありません」は送らない）
 */
export async function runExpiryNotifications(
  opts: { now?: Date; send?: SendFn; force?: boolean; onlyUid?: string } = {},
): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? sendPush;
  const uids = opts.onlyUid ? [opts.onlyUid] : await listNotifyUids();
  const result: RunResult = { scanned: 0, notified: 0, items: 0 };

  for (const uid of uids) {
    const settings = await readSettings(uid);
    if (!settings || !settings.enabled) continue;
    result.scanned++;

    const today = localDateISO(now, settings.tzOffsetMinutes);
    // 送る時刻でなければ何もしない（force は管理者の手動確認用）
    if (!opts.force && localHour(now, settings.tzOffsetMinutes) !== settings.hour) continue;
    // 1日1通。二重配信でも鳴らない
    if (settings.lastSentOn === today) continue;

    const items = await readFridgeItems(uid);
    const targets = pickExpiryTargets(items, settings, today);
    const sent = await readSent(uid);
    const fresh = targets.filter((t) => !(t.key in sent));
    if (fresh.length === 0) continue; // 0件なら送らない

    const payload = buildExpiryPush(fresh, today);
    const delivered = await send(uid, payload).catch(() => ({ web: 0, native: 0 }));
    const reached = delivered.web + delivered.native;

    const next: ExpirySettings = { ...settings, lastSentOn: today };
    if (reached > 0) {
      // 届いたものだけ「知らせ済み」にする。届いていないのに記録すると、
      // 通知を許可し直した人が二度とその食材を知らされない。
      const nowMs = now.getTime();
      const updated = prune({ ...sent }, nowMs);
      for (const t of fresh) updated[t.key] = nowMs;
      await writeSent(uid, updated);
      next.misses = 0;
      result.notified++;
      result.items += fresh.length;
    } else {
      next.misses = (settings.misses ?? 0) + 1;
      // 宛先が消えた（アプリ削除・購読失効）人を永遠に巡回しない
      if (next.misses >= MAX_MISSES) next.enabled = false;
    }
    await writeSettings(uid, next);
  }
  return result;
}
