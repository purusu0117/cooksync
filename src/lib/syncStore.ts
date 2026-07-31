"use client";

// サーバー(/api/store)をデータ源にする外部ストア。端末間で同期される。
//
// ============================================================================
// 【2026-08-01 の書き直し】なぜ全部作り直したか
// ============================================================================
// 旧実装は「ページ読み込み時に1回だけ GET し、以後は二度と再取得せず、
// 書き込みは常にメモリ上の配列**全体**を PUT する」だった。これで実際に起きていたこと
// （uid分割サーバーを再現した実測。src/lib/__tests__/syncStore.test.ts に回帰テスト化済み）:
//
//  C-1 2台目/2つ目のタブが、もう片方のデータを丸ごと消す
//      朝iPhoneで開く(mem=1件) → 昼PCで20件追加(サーバー21件) → 夜iPhoneで1件追加
//      → PUTされるのは2件。**PCの追加分19件が消える**。
//  C-3 読込中・オフラインで「データが全部消えた」画面になり、編集は無言で捨てられる。
//  C-4 送信できなかった変更が消滅する（localStorageへ書く経路がもう無く、再送機構も無い）。
//  C-5 匿名で貯めたデータが、登録直後に何も操作せず閉じると**完全に消える**
//      （匿名uid配下に取り残されて二度と辿り着けない）。
//
// ----------------------------------------------------------------------------
// 【新しい設計】オフラインファースト＋3方向マージ
// ----------------------------------------------------------------------------
//  1. **localStorage が常に手元の正**（write-through）。書いた瞬間に端末へ残る。
//     起動時はまずこれを表示するので、圏外でもコールドスタートでも中身が消えない。
//  2. **未送信のキーは dirty として端末に記録**し、上限つきの指数バックオフで自動再送。
//     復帰(online/visibilitychange/focus)でも即再送する。
//     → 大翔の方針（.secretary/Preferences/system-reliability.md）
//        「もう一度送ってねはNG。自動再開＋上限つきリトライで完遂し、
//          エラーは『伝える＋自動でやり直し中』をセットで通知」。
//  3. **送信の直前に必ずサーバーの最新を GET し、3方向マージしてから PUT する**。
//     base(最後にサーバーと一致していた内容) / local(手元) / server(最新) を突き合わせ、
//     「こちらで消したものだけ消す・こちらで直したものだけ上書きする」ので、
//     別端末の追加を巻き込んで消すことがない。
//  4. **タブ間は storage イベントで同期**（write-through しているので自然に伝わる）。
//  5. **匿名→アカウントの引き継ぎは明示的に行う**（setUid が印を残し、次の同期で移行）。
//     ただし引き継ぐのは「匿名のまま貯めたキャッシュ」だけ。ログイン済みの誰かの
//     データが、別の人の新規アカウントに紛れ込まないようにしてある。
//  6. **PUT は版番号つき（compare-and-set）**。GET で受け取った版を添えて送り、
//     合わなければサーバーが409を返す＝**書かない**。こちらは GET からやり直して
//     マージし直す。これが無いと「GET→PUTの数百msの隙間に別端末が書いた分」を
//     こちらのPUTが踏み潰していた（2026-08-01 監査2周目の残リスク）。
//     版番号を持たない既存データは rev 0 として扱われるので、移行は不要。

import { useCallback, useSyncExternalStore } from "react";
import {
  fridgeStore,
  shoppingStore,
  recipeStore,
  mealStore,
  accountStore,
  ratingStore,
  usageStore,
} from "./storage";

const ALL_STORES = [
  fridgeStore,
  shoppingStore,
  recipeStore,
  mealStore,
  accountStore,
  ratingStore,
  usageStore,
];

const UID_KEY = "cooksync:uid";
const SESSION_KEY = "cooksync:session";
const META_KEY = "cooksync:sync-meta";
const BASE_PREFIX = "cooksync:base:";

const mem = new Map<string, unknown[]>();
/** 最後に「サーバーと一致している」と分かっている内容。3方向マージの base。 */
const baseline = new Map<string, unknown[]>();
/** まだサーバーに送れていないキー */
const dirty = new Set<string>();
/** マージせずそのまま上書きするキー（全消しリセットのみ） */
const forced = new Set<string>();

const listeners = new Set<() => void>();
const EMPTY: readonly never[] = [];

let hydrated = false;
let syncing = false;
let queued = false;
let offline = false;
// 401/403＝セッション切れ。待っても直らないので「オフライン」とは別物として扱う。
// これを分けないと画面に『接続が戻り次第、自動で送ります』と嘘が出る（監査 高-4）。
let authRequired = false;
let lastError: string | null = null;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** 端末に「匿名のあいだに貯めたキャッシュ」かどうか。引き継ぎの可否を決める。 */
let cacheIsAnonymous = true;
/**
 * setUid でIDが切り替わった直後かどうか（reload を挟んでも残るよう端末に記録する）。
 * true のあいだ、手元のキャッシュは「切り替え前の自分」のもの＝まだ行き先が未確定。
 */
let identitySwitched = false;

function ls(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJSON<T>(key: string): T | null {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  const s = ls();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    /* 容量超過等。メモリ上は保持され、送信は続く */
  }
}

function notify() {
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// ユーザーID
// ---------------------------------------------------------------------------

/** ユーザーID（データ分離用）。未ログインの間は端末ごとのUUID。 */
export function getUid(): string {
  const s = ls();
  if (!s) return "anon";
  try {
    let id = s.getItem(UID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      s.setItem(UID_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

function isLoggedIn(): boolean {
  const s = ls();
  return !!s && s.getItem(SESSION_KEY) === "1";
}

/**
 * ログイン/登録時に本人のデータIDへ切り替える。
 *
 * 旧実装はここで localStorage の値を差し替えるだけだった。呼び出し側（MyPage）は
 * 「ログインは reload する／登録は reload しない」ので、**登録直後に何も操作せず
 * アプリを閉じると匿名データが行き場を失って消えた**（実測済み）。
 *
 * ここで「次の同期で引き継ぎを試みる」印を残し、reload の有無に関わらず
 * 同じ経路で移行されるようにする。
 */
export function setUid(id: string): void {
  const s = ls();
  if (!s) return;
  const prev = s.getItem(UID_KEY);
  if (prev === id) return;
  // 引き継いでよいのは「匿名のまま貯めたキャッシュ」だけ。
  // ログイン済みの人のデータが、次に登録した別人のアカウントへ混ざるのを防ぐ。
  //
  // ⚠️ `cacheIsAnonymous` は**同期が成功したときにしか更新されない**時期があり、
  //    圏外でログアウトすると `false` のまま端末に焼き付いた。その状態で匿名のまま
  //    貯めたデータは、次の登録で allow=false → resetLocalCache() され、
  //    **無言で全部消えた**（監査 中-11・実測）。
  //    いまは resetLocalCache() が「キャッシュは空＝匿名」を必ず立て直すので、
  //    ログアウト（＝uid振り直し＝リセット経路）を通った時点で真になる。
  const allow = cacheIsAnonymous && !isLoggedIn();
  s.setItem(UID_KEY, id);
  identitySwitched = allow;
  if (!allow) resetLocalCache();
  persistMeta();
  hydrated = false;
  attempts = 0;
  scheduleSync(0);
}

// ---------------------------------------------------------------------------
// 端末キャッシュ（localStorage）
// ---------------------------------------------------------------------------

interface Meta {
  v: 1;
  uid: string;
  anon: boolean;
  dirty: string[];
  /** マージせず空で上書きする＝「すべてリセット」がまだ送れていないキー（監査 中-14） */
  forced: string[];
  migrate: boolean;
}

function persistMeta(): void {
  writeJSON(META_KEY, {
    v: 1,
    uid: getUid(),
    anon: cacheIsAnonymous,
    dirty: [...dirty],
    forced: [...forced],
    migrate: identitySwitched,
  } satisfies Meta);
}

function saveCache(key: string, value: unknown[]): void {
  const store = ALL_STORES.find((s) => s.key === key);
  if (store) store.save(value as never[]);
  else writeJSON(key, value);
}

function resetLocalCache(): void {
  for (const store of ALL_STORES) {
    mem.set(store.key, []);
    baseline.delete(store.key);
    saveCache(store.key, []);
    ls()?.removeItem(BASE_PREFIX + store.key);
  }
  dirty.clear();
  forced.clear();
  // ★空にした以上、ここから先に貯まるのは「まだ誰のものでもない匿名のデータ」。
  //   これを立て忘れていたせいで、圏外ログアウト後に貯めた分が登録時に消えていた（中-11）。
  cacheIsAnonymous = true;
}

/**
 * 起動時：まず端末のキャッシュを表示に載せる。
 * これが「圏外でリロードしたら手順が全部消えた」を防ぐ本体。
 */
function primeFromCache(): void {
  const meta = readJSON<Meta>(META_KEY);
  const uid = getUid();
  cacheIsAnonymous = meta ? meta.anon : !isLoggedIn();
  identitySwitched = meta?.migrate ?? false;

  // 別のユーザーの残骸は使わない（引き継ぎ待ちの時だけ例外的に持ち越す）
  if (meta && meta.uid !== uid && !meta.migrate) {
    resetLocalCache();
    persistMeta();
    return;
  }

  // 「すべてリセット」が圏外で送れないまま落ちた場合、リロードを挟んでも
  // **同じ結果になる**ようにする。ここを覚えていなかったので、リロードすると
  // 全消しがただのマージに化けて中途半端な状態になっていた（監査 中-14）。
  for (const k of meta?.forced ?? []) forced.add(k);

  for (const store of ALL_STORES) {
    const cached = store.load();
    mem.set(store.key, cached);
    if (meta?.dirty.includes(store.key)) {
      dirty.add(store.key);
      const b = readJSON<unknown[]>(BASE_PREFIX + store.key);
      baseline.set(store.key, Array.isArray(b) ? b : []);
    } else {
      // 未送信が無いキャッシュ＝前回サーバーと一致していた内容なので base にできる
      baseline.set(store.key, cached);
    }
  }
}

// ---------------------------------------------------------------------------
// 3方向マージ
// ---------------------------------------------------------------------------

/** 要素の同一性キー。無いリスト（Accountなど）はマージ不可＝手元優先にする。 */
function idOf(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  for (const f of ["id", "recipeId", "month"]) {
    const v = o[f];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

function keyed(list: unknown[]): Map<string, unknown> | null {
  const m = new Map<string, unknown>();
  for (const it of list) {
    const id = idOf(it);
    if (id === null) return null;
    if (!m.has(id)) m.set(id, it);
  }
  return m;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * base(最後にサーバーと一致していた内容) / local(手元) / server(いまのサーバー) を突き合わせる。
 *
 *  - こちらで消した → 消えたまま（サーバーに残っていても復活させない）
 *  - こちらで直した → こちらが勝つ
 *  - 触っていない   → サーバーが勝つ（別端末の変更を取り込む）
 *  - こちらで足した → 残す
 *  - 別端末で消され、こちらも触っていない → 消えたまま
 *
 * 「別端末で消されたが、こちらでは編集した」は**残す**。静かに消えるより、
 * 見えている状態で消し直してもらう方が安全なため。
 */
export function mergeLists(
  base: unknown[],
  local: unknown[],
  server: unknown[],
): unknown[] {
  const b = keyed(base);
  const l = keyed(local);
  const s = keyed(server);
  // 同一性キーが無いリスト（アカウント情報＝0〜1件）は手元を採用する
  if (!b || !l || !s) return local;

  const removedLocally = new Set([...b.keys()].filter((k) => !l.has(k)));
  const changedLocally = new Set(
    [...l.keys()].filter((k) => !b.has(k) || !same(l.get(k), b.get(k))),
  );

  const out: unknown[] = [];
  const used = new Set<string>();
  for (const it of server) {
    const id = idOf(it) as string;
    if (used.has(id)) continue;
    used.add(id);
    if (removedLocally.has(id)) continue;
    out.push(changedLocally.has(id) ? l.get(id) : it);
  }
  for (const it of local) {
    const id = idOf(it) as string;
    if (used.has(id)) continue;
    used.add(id);
    // サーバーに無い＝「こちらで新規追加」か「別端末で削除された」
    if (changedLocally.has(id)) out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 通信
// ---------------------------------------------------------------------------

/** HTTPステータス付きのエラー。401/403 は「待っても直らない」ので再送を止める判断に使う。 */
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** 409＝別端末が先に書いた。**やり直せば必ず解決する**ので、他の失敗と区別する。 */
class ConflictError extends Error {
  constructor(readonly rev: number) {
    super("revision conflict");
  }
}

const REV_HEADER = "X-CookSync-Rev";

/**
 * レスポンスから版番号を取り出す。
 * 版番号を返さないサーバー（デプロイ途中の古い版）とも共存できるよう、
 * 取れなければ `null`＝「CASしない」に倒す。**動かなくなるより緩く動く**。
 */
function revOf(res: unknown): number | null {
  const h = (res as { headers?: { get?: (k: string) => string | null } }).headers;
  const raw = typeof h?.get === "function" ? h.get(REV_HEADER) : null;
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function fetchAll(): Promise<{ data: Record<string, unknown>; rev: number | null }> {
  const res = await fetch(`/api/store?u=${encodeURIComponent(getUid())}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new HttpError(res.status, `store GET ${res.status}`);
  return { data: (await res.json()) as Record<string, unknown>, rev: revOf(res) };
}

/**
 * 1キーを送る。`rev` を添えると、サーバーはその版と一致するときだけ書く。
 * 一致しなければ 409＝**何も書かれていない**ので、こちらは読み直してやり直す。
 * 戻り値は書き込み後の版番号（次のPUTで使う）。
 */
async function putKey(
  key: string,
  value: unknown[],
  rev: number | null,
): Promise<number | null> {
  const res = await fetch("/api/store", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, u: getUid(), ...(rev === null ? {} : { rev }) }),
  });
  if (res.status === 409) throw new ConflictError(revOf(res) ?? 0);
  // ★旧実装は res.ok を見ていなかったので、4xx/5xx が「成功」として捨てられていた
  if (!res.ok) throw new HttpError(res.status, `store PUT ${res.status}`);
  return revOf(res);
}

function markDirty(key: string): void {
  if (!dirty.has(key)) {
    // いま持っている base を「送信前の姿」として端末に固定しておく。
    // 送信できずにリロードされても、復帰後に正しくマージできる。
    writeJSON(BASE_PREFIX + key, baseline.get(key) ?? []);
    dirty.add(key);
  }
  persistMeta();
}

function clearDirty(key: string, confirmed: unknown[]): void {
  dirty.delete(key);
  baseline.set(key, confirmed);
  ls()?.removeItem(BASE_PREFIX + key);
  persistMeta();
}

/**
 * サーバーと1往復して手元とサーバーを一致させる。
 *  - 未送信キー：GETした最新と3方向マージ→PUT
 *  - それ以外  ：サーバーの内容を取り込む（別端末の変更が反映される）
 * 失敗すると例外を投げ、呼び出し元がバックオフ再送を組む。
 */
async function syncOnce(): Promise<void> {
  const { data: server, rev } = await fetchAll();
  // GET で見た版。PUTごとに1つ進むので、成功のたびに手元でも進める。
  let knownRev = rev;
  const serverBlank = Object.keys(server).length === 0;

  if (serverBlank) {
    // サーバーに**キーが1つも無い**＝このIDでまだ一度も保存していない。
    // 手元に中身があるなら、それを引き継ぐ（匿名→新規アカウント／旧localStorage時代の人）。
    //
    // ★「空配列が保存されている」は blank ではない。全消しリセットは空配列を書くので、
    //   消したデータが次回リロードで復活する事故（旧実装にあった）は起こらない。
    for (const store of ALL_STORES) {
      if ((mem.get(store.key) ?? []).length > 0) {
        baseline.set(store.key, []);
        markDirty(store.key);
      }
    }
  } else if (identitySwitched) {
    // ID を切り替えた先に、既にそのアカウントのデータがある＝ログイン。
    // 手元のキャッシュは切り替え前の自分のものなので、混ぜずに捨ててアカウント側を正とする。
    // （reload 直後の一瞬に操作されても、匿名データがアカウントへ紛れ込まない）
    for (const store of ALL_STORES) {
      dirty.delete(store.key);
      forced.delete(store.key);
      ls()?.removeItem(BASE_PREFIX + store.key);
    }
  }

  let failure: unknown = null;
  for (const store of ALL_STORES) {
    const key = store.key;
    const raw = server[key];
    const sv = Array.isArray(raw) ? (raw as unknown[]) : [];
    if (dirty.has(key)) {
      const merged = forced.has(key)
        ? (mem.get(key) ?? [])
        : mergeLists(baseline.get(key) ?? [], mem.get(key) ?? [], sv);
      try {
        knownRev = await putKey(key, merged, knownRev);
      } catch (e) {
        // 別端末が先に書いた＝手元のマージ結果は古い前提で作られている。
        // ここで他のキーを送り続けると同じ踏み潰しをやるので、**即座に打ち切って**
        // GET からやり直す。dirty は残したままなので、送り残しは失われない。
        if (e instanceof ConflictError) throw e;
        failure = failure ?? e;
        continue;
      }
      mem.set(key, merged);
      saveCache(key, merged);
      forced.delete(key);
      clearDirty(key, merged);
    } else if (!same(mem.get(key), sv)) {
      mem.set(key, sv);
      saveCache(key, sv);
      baseline.set(key, sv);
    }
  }

  if (failure) throw failure;

  identitySwitched = false;
  cacheIsAnonymous = !isLoggedIn();
  persistMeta();
  hydrated = true;
  offline = false;
  authRequired = false;
  lastError = null;
  notify();
}

/**
 * 409（版ずれ）は「別端末が先に書いた」だけなので、**その場で読み直してやり直す**。
 * ユーザーに再操作させない（[[system-reliability]]）。
 * 数回で収束しなければ通常の失敗として扱い、バックオフ再送に任せる。
 */
const CONFLICT_RETRIES = 3;

async function syncNow(): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await syncOnce();
      return;
    } catch (e) {
      if (e instanceof ConflictError && i < CONFLICT_RETRIES) continue;
      throw e;
    }
  }
}

// 上限つき指数バックオフ。上限に達しても、復帰イベント（online/表示復帰）で必ず再開する。
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000];
const MAX_ATTEMPTS = 12;

function scheduleSync(delay: number): void {
  if (typeof window === "undefined") return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void runSync();
  }, delay);
}

async function runSync(): Promise<void> {
  if (typeof window === "undefined") return;
  if (syncing) {
    queued = true;
    return;
  }
  syncing = true;
  try {
    await syncNow();
    attempts = 0;
    authRequired = false;
  } catch (e) {
    attempts += 1;
    offline = true;
    // 401/403＝セッションが切れている。待っても直らないので自動再送は止める。
    // ただし手元のデータと未送信の記録はそのまま残すので、ログインし直せば送られる。
    const auth = e instanceof HttpError && (e.status === 401 || e.status === 403);
    authRequired = auth;
    lastError = auth
      ? "ログインの有効期限が切れています。マイページからログインし直してください。"
      : e instanceof Error
        ? e.message
        : "同期に失敗しました";
    notify();
    if (!auth && attempts <= MAX_ATTEMPTS) {
      scheduleSync(BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]);
    }
  } finally {
    syncing = false;
    if (queued) {
      queued = false;
      scheduleSync(0);
    }
  }
}

/** 「いますぐ再試行」。エラー表示のボタンから呼ぶ。 */
export function retryNow(): void {
  attempts = 0;
  scheduleSync(0);
}

// ---------------------------------------------------------------------------
// 端末内のイベント（復帰・タブ間）
// ---------------------------------------------------------------------------

let wired = false;
function wireEvents(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;

  // 復帰したら即座に取り直す。
  // ★iPhoneのWKWebViewはバックグラウンドでもページを生かすので、
  //   これが無いと「朝に読んだ古い内容」のまま夜まで書き続けることになる（C-1の再現条件）。
  const resume = () => {
    attempts = 0;
    scheduleSync(0);
  };
  window.addEventListener("online", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("pageshow", resume);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") resume();
    });
  }

  // 両方の端末を開きっぱなしにしている時のための保険（表示中のときだけ）
  pollTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    // ⚠️ セッション切れ(401/403)のあとも叩き続けていた（監査 中-15）。
    //    待っても直らない相手に60秒ごとにリクエストを投げ、端末の電池とサーバーの
    //    枠を捨てるだけ。復帰はログインし直したとき（storage/focus イベント）に任せる。
    if (authRequired) return;
    // バックオフ中に割り込むと、指数バックオフが実質60秒の定期再送に化ける。
    if (retryTimer) return;
    if (!syncing) scheduleSync(0);
  }, 60_000);
  (pollTimer as unknown as { unref?: () => void }).unref?.();

  // 別タブの書き込みを取り込む（write-through しているので storage イベントで届く）
  window.addEventListener("storage", (ev: StorageEvent) => {
    if (!ev.key) return;
    if (ev.key === UID_KEY) {
      // 別タブでログイン/ログアウトされた。持っている内容は他人のものかもしれない。
      hydrated = false;
      scheduleSync(0);
      return;
    }
    const store = ALL_STORES.find((s) => s.key === ev.key);
    if (!store) return;
    mem.set(store.key, store.load());
    notify();
  });
}

// ---------------------------------------------------------------------------
// 読み書き
// ---------------------------------------------------------------------------

function applyWrite(key: string, next: unknown[]): void {
  mem.set(key, next);
  saveCache(key, next); // ★まず端末に確定させる（送れなくても消えない）
  markDirty(key);
  notify();
  scheduleSync(0);
}

function ensureStarted(): void {
  if (typeof window === "undefined") return;
  wireEvents();
  if (!hydrated && !syncing && !retryTimer) scheduleSync(0);
}

/**
 * useSyncExternalStore に渡す購読関数。**モジュールスコープに置くこと。**
 *
 * ⚠️ 以前はフックの中でインラインの arrow を渡していた。毎レンダーで関数の同一性が変わるので、
 *    React は**レンダーのたびに購読を解除して張り直していた**。RecipeDetail は1レンダーで
 *    このフックを5本使っているので、1レンダーあたり Set の add/delete が10回。
 *    さらに購読のたびに ensureStarted() が走っていた。
 */
const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  ensureStarted();
  return () => {
    listeners.delete(cb);
  };
};

export function useServerList<T>(
  key: string,
): [T[], (updater: T[] | ((prev: T[]) => T[])) => void] {
  const data = useSyncExternalStore(
    subscribe,
    () => (mem.get(key) as T[]) ?? (EMPTY as unknown as T[]),
    () => EMPTY as unknown as T[],
  );

  const setData = useCallback(
    (updater: T[] | ((prev: T[]) => T[])) => {
      setServerList<T>(key, updater);
    },
    [key],
  );

  return [data, setData];
}

/**
 * フック外からの更新。
 * ★旧実装は hydrate 前の書き込みを「読み込み完了を待ってから適用、失敗なら破棄」していた。
 *   機内モードでは永久に失敗するので、追加を押しても**エラーも出ず何も起きなかった**。
 *   いまは即座に手元へ確定させ、送信は再送キューに任せる。
 */
export function setServerList<T>(
  key: string,
  updater: T[] | ((prev: T[]) => T[]),
): void {
  const prev = (mem.get(key) as T[]) ?? [];
  const next =
    typeof updater === "function" ? (updater as (p: T[]) => T[])(prev) : updater;
  applyWrite(key, next as unknown[]);
}

/** 互換API（画像ジョブ完了の反映などで使用） */
export function updateServerList<T>(key: string, updater: (prev: T[]) => T[]): void {
  setServerList<T>(key, updater);
}

/**
 * 全データを消す（リセット用）。端末キャッシュも同時に空にする。
 * ここだけはマージせずに空で上書きする（「消したのに別端末の分が残る」を避ける）。
 */
export async function clearAllServer(): Promise<void> {
  for (const store of ALL_STORES) {
    forced.add(store.key);
    applyWrite(store.key, []);
  }
  persistMeta(); // ★圏外で送れないままリロードされても「全消し」は覚えている（中-14）
  await runSync();
}

// ---------------------------------------------------------------------------
// 同期の状態（画面に出す）
// ---------------------------------------------------------------------------

export interface SyncState {
  /** サーバーと一度でも一致できたか。false のあいだは「読み込み中」扱い */
  hydrated: boolean;
  /** 端末にキャッシュがあり、中身を表示できる状態か */
  hasCache: boolean;
  /** 直近の通信に失敗している */
  offline: boolean;
  /** セッション切れ。オフラインではないので「自動で送ります」と言ってはいけない */
  authRequired: boolean;
  /** まだ送れていない変更の数 */
  pending: number;
  /**
   * 「すべてリセット」がまだ送れていない。
   * これは普通の未送信と意味が違う（マージせず空で上書きする＝**別端末で
   * その間に追加された分も消える**）ので、送る前に必ず知らせる（監査 中-14）。
   */
  pendingReset: boolean;
  error: string | null;
}

let cachedState: SyncState = {
  hydrated: false,
  hasCache: false,
  offline: false,
  authRequired: false,
  pending: 0,
  pendingReset: false,
  error: null,
};

function currentState(): SyncState {
  const hasCache = ALL_STORES.some((s) => (mem.get(s.key) ?? []).length > 0);
  const pendingReset = forced.size > 0;
  if (
    cachedState.hydrated === hydrated &&
    cachedState.hasCache === hasCache &&
    cachedState.offline === offline &&
    cachedState.authRequired === authRequired &&
    cachedState.pending === dirty.size &&
    cachedState.pendingReset === pendingReset &&
    cachedState.error === lastError
  ) {
    return cachedState;
  }
  cachedState = {
    hydrated,
    hasCache,
    offline,
    authRequired,
    pending: dirty.size,
    pendingReset,
    error: lastError,
  };
  return cachedState;
}

const SERVER_STATE: SyncState = {
  hydrated: false,
  hasCache: false,
  offline: false,
  authRequired: false,
  pending: 0,
  pendingReset: false,
  error: null,
};

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, currentState, () => SERVER_STATE);
}

/** テスト用：モジュール状態を覗く（本番コードからは使わない） */
export function __debugState() {
  return {
    hydrated,
    offline,
    authRequired,
    anon: cacheIsAnonymous,
    dirty: [...dirty],
    forced: [...forced],
    mem,
    baseline,
  };
}

/**
 * テスト用：画面が1つでも表示された状態にする（＝復帰イベントと60秒ポーリングを配線する）。
 * 本番では useServerList / useSyncState の購読時に同じ経路を通る。
 */
export function __startForTest(): void {
  wireEvents();
}

/** テスト用：この「ページ」を閉じる。再送タイマーを止める（本番コードからは使わない） */
export function __stopForTest(): void {
  if (retryTimer) clearTimeout(retryTimer);
  if (pollTimer) clearInterval(pollTimer);
  retryTimer = null;
  pollTimer = null;
  syncing = true; // これ以上サーバーに触らない
}

// 端末のキャッシュはモジュール読み込み時点で載せる。
// getSnapshot が最初から正しい内容を返すので、一瞬「空」が描かれることがない。
if (typeof window !== "undefined") {
  primeFromCache();
}
