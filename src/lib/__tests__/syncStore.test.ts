// 「ユーザーのデータが静かに消える」の回帰テスト。
//
// ここが守っている事故は、全部 2026-08-01 の監査で**実際に再現した**もの。
// 当時この領域を守るテストは1件も無く、消えても誰も気づけなかった。
//
// ローカル開発サーバー（Redis無し）は .data/store.json 1ファイルに書き、**uid を無視する**。
// つまりローカルのブラウザ実機では「別ユーザーにデータが移った/消えた」は再現できない。
// そこで本番と同じ「uidで分割されたサーバー」を偽の fetch で用意して検証する。

import { describe, it, expect, beforeEach, vi } from "vitest";

const FRIDGE = "fridge-app:items:v2";
const RECIPES = "fridge-app:recipes:v1";

type Server = Map<string, Record<string, unknown[]>>;

let server: Server;
let store: Map<string, string>;
let netOk: boolean;
let putCount: number;
let getCount: number;
/** uidごとの版番号。本番の /api/store と同じ楽観ロックを偽サーバーでも再現する。 */
let revs: Map<string, number>;
/**
 * 「GETを返した直後に、別の端末が書いた」を差し込むための1回きりのフック。
 * GET→PUT の隙間（数百ms）を、テストから確実に再現するために使う。
 */
let afterGet: (() => void) | null;

/** 別端末からの書き込み（版番号も1つ進む＝こちらのPUTは版ずれになる） */
function otherDeviceWrite(uid: string, key: string, value: unknown[]): void {
  const cur = server.get(uid) ?? {};
  cur[key] = value;
  server.set(uid, cur);
  revs.set(uid, (revs.get(uid) ?? 0) + 1);
}

function headersWith(rev: number) {
  return {
    get: (k: string) => (k.toLowerCase() === "x-cooksync-rev" ? String(rev) : null),
  };
}

function makeLocalStorage(map: Map<string, string>) {
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function installEnv() {
  const g = globalThis as Record<string, unknown>;
  g.window = {
    localStorage: makeLocalStorage(store),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  g.fetch = vi.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      if (!netOk) throw new TypeError("Failed to fetch");
      if (!init || (init.method ?? "GET") === "GET") {
        getCount += 1;
        const u = new URL(url, "http://local").searchParams.get("u") ?? "anon";
        const snapshot = { ...(server.get(u) ?? {}) };
        const res = {
          ok: true,
          status: 200,
          headers: headersWith(revs.get(u) ?? 0),
          json: async () => snapshot,
        };
        // ★ここが「GETを返してからPUTが届くまでの隙間」
        const hook = afterGet;
        afterGet = null;
        hook?.();
        return res;
      }
      putCount += 1;
      const body = JSON.parse(init.body!) as {
        key: string;
        value: unknown[];
        u: string;
        rev?: number;
      };
      const cur = server.get(body.u) ?? {};
      const rev = revs.get(body.u) ?? 0;
      // 版番号つきで来たのに合わない＝別端末が先に書いた。**何も書かずに**409。
      if (typeof body.rev === "number" && body.rev !== rev) {
        return {
          ok: false,
          status: 409,
          headers: headersWith(rev),
          json: async () => ({ code: "revision_conflict", rev }),
        };
      }
      cur[body.key] = body.value;
      server.set(body.u, cur);
      revs.set(body.u, rev + 1);
      return {
        ok: true,
        status: 200,
        headers: headersWith(rev + 1),
        json: async () => ({ ok: true, rev: rev + 1 }),
      };
    },
  );
}

const settle = () => new Promise((r) => setTimeout(r, 40));

type Sync = typeof import("../syncStore");

// 開いたままの「ページ」（＝モジュール実体）。次を開くときに必ず閉じないと、
// 前のページの再送タイマーが後のテストのサーバーに書き込んでしまう。
const openPages: Sync[] = [];

async function newModule(): Promise<Sync> {
  for (const p of openPages.splice(0)) p.__stopForTest();
  vi.resetModules();
  const mod = (await import("../syncStore")) as Sync;
  openPages.push(mod);
  return mod;
}

/** ページを新しく開き直して、最初の同期が終わるまで待つ */
async function openPage(): Promise<Sync> {
  const mod = await newModule();
  mod.retryNow();
  await settle();
  return mod;
}

/** 画面に出ている内容（＝mem） */
function shown(mod: Sync, key = FRIDGE): unknown[] {
  return (mod.__debugState().mem.get(key) as unknown[]) ?? [];
}

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  ...extra,
});

beforeEach(() => {
  server = new Map();
  store = new Map();
  revs = new Map();
  afterGet = null;
  netOk = true;
  putCount = 0;
  getCount = 0;
  installEnv();
});

// ---------------------------------------------------------------------------

describe("mergeLists（3方向マージ）", () => {
  it("別端末の追加を巻き込んで消さない", async () => {
    const { mergeLists } = await import("../syncStore");
    const base = [item("a")];
    const local = [item("a"), item("mine")];
    const srv = [item("a"), item("pc1"), item("pc2")];
    expect(mergeLists(base, local, srv).map((x) => (x as { id: string }).id)).toEqual([
      "a",
      "pc1",
      "pc2",
      "mine",
    ]);
  });

  it("こちらで消したものは、サーバーに残っていても復活しない", async () => {
    const { mergeLists } = await import("../syncStore");
    const out = mergeLists([item("a"), item("b")], [item("a")], [item("a"), item("b")]);
    expect(out.map((x) => (x as { id: string }).id)).toEqual(["a"]);
  });

  it("こちらで編集したものは、こちらが勝つ", async () => {
    const { mergeLists } = await import("../syncStore");
    const out = mergeLists(
      [item("a", { qty: 1 })],
      [item("a", { qty: 9 })],
      [item("a", { qty: 1 })],
    );
    expect((out[0] as { qty: number }).qty).toBe(9);
  });

  it("触っていないものは、別端末の編集が反映される", async () => {
    const { mergeLists } = await import("../syncStore");
    const out = mergeLists(
      [item("a", { qty: 1 })],
      [item("a", { qty: 1 })],
      [item("a", { qty: 5 })],
    );
    expect((out[0] as { qty: number }).qty).toBe(5);
  });

  it("別端末で消され、こちらも触っていないものは消えたまま", async () => {
    const { mergeLists } = await import("../syncStore");
    expect(mergeLists([item("a")], [item("a")], [])).toEqual([]);
  });

  it("識別子を持たないリスト（アカウント）は手元を採用する", async () => {
    const { mergeLists } = await import("../syncStore");
    const local = [{ email: "me@example.com" }];
    expect(mergeLists([], local, [{ email: "old@example.com" }])).toEqual(local);
  });
});

// ---------------------------------------------------------------------------

describe("C-1 2台目・2つ目のタブが、もう片方のデータを消さない", () => {
  it("古いメモリのまま1件足しても、別端末の20件が消えない", async () => {
    store.set("cooksync:uid", "u1");
    const phone = await openPage();
    phone.setServerList(FRIDGE, () => [item("morning")]);
    await settle();

    // 昼、PCが20件足した（＝サーバーだけが進む）
    server.set("u1", {
      [FRIDGE]: [item("morning"), ...Array.from({ length: 20 }, (_, i) => item(`pc${i}`))],
    });

    // 夜、バックグラウンドで生きていたiPhoneが1件足す
    phone.setServerList(FRIDGE, (prev: unknown[]) => [...prev, item("night")]);
    await settle();

    const ids = (server.get("u1")![FRIDGE] as { id: string }[]).map((x) => x.id);
    expect(ids).toContain("night");
    expect(ids).toContain("pc19");
    expect(ids).toHaveLength(22);
  });

  it("片方で削除したものは、もう片方の書き込みで復活しない", async () => {
    store.set("cooksync:uid", "u1");
    const phone = await openPage();
    phone.setServerList(FRIDGE, () => [item("a"), item("b")]);
    await settle();
    // PCが a を消した
    server.set("u1", { [FRIDGE]: [item("b")] });
    // iPhoneは c を足しただけ
    phone.setServerList(FRIDGE, (prev: unknown[]) => [...prev, item("c")]);
    await settle();
    const ids = (server.get("u1")![FRIDGE] as { id: string }[]).map((x) => x.id);
    expect(ids).toEqual(["b", "c"]);
  });
});

// ---------------------------------------------------------------------------

describe("C-3 読込中・オフラインで「全部消えた」画面にしない", () => {
  it("2回目以降の起動は、通信を待たずに前回の内容が出ている", async () => {
    store.set("cooksync:uid", "u1");
    const first = await openPage();
    first.setServerList(FRIDGE, () => [item("a"), item("b")]);
    await settle();

    // 圏外でリロード
    netOk = false;
    const again = await newModule();
    // ★通信を1回も待たずに（await 前に）中身が出ていること
    expect(shown(again)).toHaveLength(2);
    expect(again.__debugState().hydrated).toBe(false);
  });

  it("保存レシピは圏外リロードでも消えない（調理中に手順が飛ばない）", async () => {
    store.set("cooksync:uid", "u1");
    const first = await openPage();
    first.setServerList(RECIPES, () => [item("my-recipe", { steps: ["切る"] })]);
    await settle();

    netOk = false;
    const again = await newModule();
    expect(shown(again, RECIPES)).toHaveLength(1);
  });

  it("オフラインで追加しても無言で捨てられない（画面に出て、未送信として数えられる）", async () => {
    store.set("cooksync:uid", "u1");
    const mod = await openPage();
    netOk = false;
    mod.setServerList(FRIDGE, () => [item("offline-add")]);
    await settle();
    expect(shown(mod)).toHaveLength(1);
    expect(mod.__debugState().dirty).toContain(FRIDGE);
    expect(mod.__debugState().offline).toBe(true);
  });

  it("hydrate 前の書き込みも捨てられない（旧実装は失敗すると破棄していた）", async () => {
    store.set("cooksync:uid", "u1");
    netOk = false;
    const mod = await newModule();
    mod.setServerList(FRIDGE, () => [item("early")]);
    await settle();
    expect(shown(mod)).toHaveLength(1);
    netOk = true;
    mod.retryNow();
    await settle();
    expect(server.get("u1")![FRIDGE]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("C-4 送信できなかった変更が消滅しない", () => {
  it("オフライン中の変更は端末に残り、復帰後に自動で送られる", async () => {
    store.set("cooksync:uid", "u1");
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("a")]);
    await settle();

    netOk = false;
    mod.setServerList(FRIDGE, (p: unknown[]) => [...p, item("offline")]);
    await settle();
    expect(JSON.parse(store.get(FRIDGE)!)).toHaveLength(2); // ★端末に書かれている

    netOk = true;
    mod.retryNow();
    await settle();
    expect(server.get("u1")![FRIDGE]).toHaveLength(2);
    expect(mod.__debugState().dirty).toHaveLength(0);
  });

  it("オフラインのままリロードしても、未送信の変更は生き残って後で送られる", async () => {
    store.set("cooksync:uid", "u1");
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("a")]);
    await settle();

    netOk = false;
    mod.setServerList(FRIDGE, (p: unknown[]) => [...p, item("offline")]);
    await settle();

    // 圏外のまま落ちて、圏内で開き直す
    netOk = true;
    const reopened = await openPage();
    expect(shown(reopened)).toHaveLength(2);
    expect(server.get("u1")![FRIDGE]).toHaveLength(2);
  });

  it("HTTPエラー（4xx/5xx）を成功として握りつぶさない", async () => {
    store.set("cooksync:uid", "u1");
    const mod = await openPage();
    (globalThis as Record<string, unknown>).fetch = vi.fn(async (
      _url: string,
      init?: { method?: string },
    ) => {
      if (!init || (init.method ?? "GET") === "GET") {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
    });
    mod.setServerList(FRIDGE, () => [item("a")]);
    await settle();
    expect(mod.__debugState().dirty).toContain(FRIDGE);
    expect(mod.__debugState().offline).toBe(true);
  });

  it("セッション切れ(403)でも手元のデータと未送信の記録は失わない", async () => {
    store.set("cooksync:uid", "u1");
    const mod = await openPage();
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden" }),
    }));
    mod.setServerList(FRIDGE, () => [item("a")]);
    await settle();
    expect(shown(mod)).toHaveLength(1);
    expect(mod.__debugState().dirty).toContain(FRIDGE);
    expect(JSON.parse(store.get(FRIDGE)!)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("C-5 未ログインで貯めたデータが、登録・ログインで消えない", () => {
  it("登録：何も操作せず閉じても引き継がれる（旧実装は完全に消えていた）", async () => {
    store.set("cooksync:uid", "anon-1");
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("a"), item("b"), item("c")]);
    await settle();

    mod.setUid("acct-1"); // handleRegister は reload しない
    await settle();
    expect(server.get("acct-1")![FRIDGE]).toHaveLength(3);

    const reopened = await openPage(); // ここで初めてリロード
    expect(shown(reopened)).toHaveLength(3);
  });

  it("ログイン：reload を挟んでも、アカウント側が空なら引き継がれる", async () => {
    store.set("cooksync:uid", "anon-2");
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("a"), item("b")]);
    await settle();

    mod.setUid("acct-2");
    const reloaded = await openPage(); // handleLogin は直後に reload する
    expect(shown(reloaded)).toHaveLength(2);
    expect(server.get("acct-2")![FRIDGE]).toHaveLength(2);
  });

  it("既にデータのあるアカウントにログインしたら、そのアカウント側が正", async () => {
    server.set("acct-3", { [FRIDGE]: [item("account-side")] });
    store.set("cooksync:uid", "anon-3");
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("a"), item("b")]);
    await settle();

    mod.setUid("acct-3");
    const reloaded = await openPage();
    expect((shown(reloaded) as { id: string }[]).map((x) => x.id)).toEqual([
      "account-side",
    ]);
  });

  it("ログイン直後の一瞬に操作しても、匿名データがアカウント側へ紛れ込まない", async () => {
    server.set("acct-4", { [FRIDGE]: [item("account-side")] });
    store.set("cooksync:uid", "anon-4");
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("anon-only")]);
    await settle();

    mod.setUid("acct-4");
    const reloaded = await newModule();
    // まだ1回目の通信が終わる前に、ユーザーが1件足してしまった
    reloaded.setServerList(FRIDGE, (p: unknown[]) => [...p, item("hasty")]);
    await settle();

    const ids = (server.get("acct-4")![FRIDGE] as { id: string }[]).map((x) => x.id);
    expect(ids).not.toContain("anon-only");
  });

  it("ログイン済みの人のデータが、次に登録した別人のアカウントへ混ざらない", async () => {
    store.set("cooksync:uid", "acct-A");
    store.set("cooksync:session", "1"); // A はログイン済み
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("A-secret")]);
    await settle();

    // A がログアウトして、同じ端末で B が新規登録した
    store.delete("cooksync:session");
    mod.setUid("acct-B");
    await settle();
    const b = await openPage();
    expect(shown(b)).toEqual([]);
    expect(server.get("acct-B")?.[FRIDGE] ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("C-5逆 消したデータが次回リロードで復活しない", () => {
  it("全消しリセットのあと開き直しても、旧 localStorage の内容が蘇らない", async () => {
    store.set("cooksync:uid", "u9");
    // 旧実装時代に localStorage へ残っていたデータ
    store.set(FRIDGE, JSON.stringify([item("old1"), item("old2")]));
    const mod = await openPage();
    await mod.clearAllServer();
    await settle();

    const reopened = await openPage();
    expect(shown(reopened)).toEqual([]);
  });

  it("旧 localStorage だけにデータがある人は、初回だけサーバーへ移行される", async () => {
    store.set("cooksync:uid", "u10");
    store.set(FRIDGE, JSON.stringify([item("legacy")]));
    const mod = await openPage();
    expect(server.get("u10")![FRIDGE]).toHaveLength(1);
    expect(shown(mod)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("同期の状態表示", () => {
  it("オフラインになると offline / 未送信件数が立ち、復帰すると消える", async () => {
    store.set("cooksync:uid", "u1");
    const mod = await openPage();
    expect(mod.__debugState().hydrated).toBe(true);

    netOk = false;
    mod.setServerList(FRIDGE, () => [item("a")]);
    await settle();
    expect(mod.__debugState().offline).toBe(true);
    expect(mod.__debugState().dirty).toHaveLength(1);

    netOk = true;
    mod.retryNow();
    await settle();
    expect(mod.__debugState().offline).toBe(false);
    expect(mod.__debugState().dirty).toHaveLength(0);
  });

  it("変更していないキーを無駄にPUTしない（他端末の内容を上書きしない）", async () => {
    store.set("cooksync:uid", "u1");
    server.set("u1", { [FRIDGE]: [item("a")] });
    await openPage();
    expect(putCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 監査2周目（2026-08-01）で残っていたデータ消失経路
// ---------------------------------------------------------------------------

describe("中-11 圏外でログアウトしたあとに貯めたデータが、登録で消えない", () => {
  /** MyPage.logout と同じ手順（端末のキャッシュを消して uid を振り直す） */
  function logout(mod: Sync) {
    for (const k of [...store.keys()]) {
      if (k.startsWith("cooksync:") || k.startsWith("fridge-app:")) store.delete(k);
    }
    mod.setUid("anon-after-logout");
  }

  it("ログアウト直後に端末へ焼き付く印が「匿名」になっている", async () => {
    store.set("cooksync:uid", "acct-A");
    store.set("cooksync:session", "1");
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("A-data")]);
    await settle();

    netOk = false; // ★圏外。同期は一度も成功しない
    logout(mod);
    await settle();

    // 旧実装はここが false のまま焼き付き、次の登録で全部消していた
    expect(JSON.parse(store.get("cooksync:sync-meta")!).anon).toBe(true);
    expect(mod.__debugState().anon).toBe(true);
  });

  it("圏外ログアウト→リロード→匿名で3件追加→登録 で、3件とも残る（実測した消失）", async () => {
    store.set("cooksync:uid", "acct-A");
    store.set("cooksync:session", "1");
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("A-data")]);
    await settle();

    netOk = false;
    logout(mod);
    await settle();

    // 圏外のままリロードして、匿名で3件貯める
    const anon = await newModule();
    anon.setServerList(FRIDGE, () => [item("x"), item("y"), item("z")]);
    await settle();
    expect(shown(anon)).toHaveLength(3);

    // 電波が戻って、そのまま新規登録
    netOk = true;
    anon.setUid("acct-new");
    await settle();

    expect(shown(anon)).toHaveLength(3);
    expect(server.get("acct-new")![FRIDGE]).toHaveLength(3);
  });

  it("それでも、ログイン済みの人のデータは別人の新規登録へ流れない", async () => {
    // セッション切れ（sessionだけ消える）＝キャッシュはまだアカウントのもの。
    // ここで別人が登録しても、前の人のデータは渡らない。
    store.set("cooksync:uid", "acct-A");
    store.set("cooksync:session", "1");
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("A-secret")]);
    await settle();

    store.delete("cooksync:session"); // 期限切れ。キャッシュは消えない
    mod.setUid("acct-B");
    await settle();

    expect(shown(mod)).toEqual([]);
    expect(server.get("acct-B")?.[FRIDGE] ?? []).toEqual([]);
  });
});

describe("中-14 圏外の「すべてリセット」がリロードで中途半端にならない", () => {
  it("リロードを跨いでも全消しのまま実行される", async () => {
    store.set("cooksync:uid", "u1");
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("a"), item("b")]);
    await settle();

    netOk = false;
    await mod.clearAllServer(); // 送れない
    await settle();
    expect(mod.__debugState().forced).toContain(FRIDGE);

    // 圏外のままリロード（旧実装はここで forced を忘れていた）
    const reopened = await newModule();
    expect(reopened.__debugState().forced).toContain(FRIDGE);

    // その間に別端末が追加していた
    otherDeviceWrite("u1", FRIDGE, [item("a"), item("b"), item("from-pc")]);
    netOk = true;
    reopened.retryNow();
    await settle();

    expect(server.get("u1")![FRIDGE]).toEqual([]);
    expect(shown(reopened)).toEqual([]);
  });

  it("送れていない全消しは、普通の未送信と区別して警告できる", async () => {
    store.set("cooksync:uid", "u1");
    const mod = await openPage();
    mod.setServerList(FRIDGE, () => [item("a")]);
    await settle();

    netOk = false;
    await mod.clearAllServer();
    await settle();
    const reopened = await newModule();
    expect(reopened.__debugState().forced.length).toBeGreaterThan(0);
  });
});

describe("中-15 セッション切れのあと、60秒ごとに叩き続けない", () => {
  it("403のあとはポーリングが1回もリクエストを出さない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      store.set("cooksync:uid", "u1");
      const mod = await newModule();
      mod.__startForTest(); // 画面が表示された＝ポーリング開始
      mod.retryNow();
      await vi.advanceTimersByTimeAsync(50);

      (globalThis as Record<string, unknown>).fetch = vi.fn(async () => {
        getCount += 1;
        return { ok: false, status: 403, json: async () => ({ error: "forbidden" }) };
      });
      mod.setServerList(FRIDGE, () => [item("a")]);
      await vi.advanceTimersByTimeAsync(50);
      expect(mod.__debugState().authRequired).toBe(true);

      const before = getCount;
      await vi.advanceTimersByTimeAsync(5 * 60_000); // 5分放置＝ポーリング5回ぶん
      expect(getCount).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GET→PUT の隙間に別端末が書いても踏み潰さない（版番号／CAS）", () => {
  it("こちらのPUTが、その隙間の追加を消さない", async () => {
    store.set("cooksync:uid", "u1");
    server.set("u1", { [FRIDGE]: [item("shared")] });
    const mod = await openPage();

    // これから送る。その GET を返した直後に、PCが1件足す。
    afterGet = () =>
      otherDeviceWrite("u1", FRIDGE, [item("shared"), item("from-pc")]);
    mod.setServerList(FRIDGE, (p: unknown[]) => [...p, item("from-phone")]);
    await settle();

    const ids = (server.get("u1")![FRIDGE] as { id: string }[]).map((x) => x.id);
    expect(ids).toContain("from-pc"); // ★これが消えていたのが残リスクの正体
    expect(ids).toContain("from-phone");
    expect(mod.__debugState().dirty).toHaveLength(0);
  });

  it("409を受けても、手元の未送信は失われず自動でやり直す", async () => {
    store.set("cooksync:uid", "u1");
    server.set("u1", { [FRIDGE]: [item("shared")] });
    const mod = await openPage();

    afterGet = () => otherDeviceWrite("u1", FRIDGE, [item("shared"), item("pc")]);
    mod.setServerList(FRIDGE, (p: unknown[]) => [...p, item("phone")]);
    await settle();

    // 「もう一度送ってね」を出さずに完遂している
    expect(mod.__debugState().offline).toBe(false);
    expect(shown(mod)).toHaveLength(3);
  });

  it("版番号を返さないサーバー相手でも今までどおり動く（後方互換）", async () => {
    store.set("cooksync:uid", "u1");
    (globalThis as Record<string, unknown>).fetch = vi.fn(
      async (url: string, init?: { method?: string; body?: string }) => {
        if (!init || (init.method ?? "GET") === "GET") {
          return { ok: true, status: 200, json: async () => ({}) }; // headers 無し
        }
        const body = JSON.parse(init.body!) as { key: string; value: unknown[]; rev?: number };
        expect(body.rev).toBeUndefined(); // 版を知らないなら送らない
        const cur = server.get("u1") ?? {};
        cur[body.key] = body.value;
        server.set("u1", cur);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    );
    const mod = await newModule();
    mod.setServerList(FRIDGE, () => [item("a")]);
    await settle();
    expect(server.get("u1")![FRIDGE]).toHaveLength(1);
  });
});
