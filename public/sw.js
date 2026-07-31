// CookSync Service Worker — Web Push を受けて通知を表示（アプリを閉じていても動く）
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "CookSync", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "CookSync";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.jpg",
      badge: "/icon-192.jpg",
      data: { url: data.url || "/" },
      tag: data.tag || "cooksync",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const c of list) {
          if ("focus" in c) {
            c.navigate(url);
            return c.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

// ============================================================
// オフライン対応（2026-08-01 追加）
//
// ⚠️ これが無かったため、**圏外・電波が弱いとアプリが真っ白**になっていた。
//    CookSync のネイティブ版は WKWebView が Vercel を直接読む remote URL 方式なので、
//    通信が切れた瞬間に何も表示できなくなる。
//    - 実用上：キッチンは電波が弱いことがある。調理中に手順が消えるのは致命的。
//    - 審査：機内モードで真っ白＝「Webサイトを包んだだけ」の決定的な証拠になり、
//      ガイドライン 4.2（最低限の機能）で落ちる材料になる。
//
// 方針:
//   - `/_next/static/*` は内容が変わればURLも変わる（immutable）ので **キャッシュ優先**
//   - 画面遷移(navigate)は **ネットワーク優先＋失敗したらキャッシュ**。
//     常に最新を見せつつ、切れたら最後に見られた画面を出す。
//   - どちらも無ければオフライン用の静的ページを返す（真っ白にしない）
//   - APIは**キャッシュしない**（在庫や献立が古いまま出ると誤解を生む）
// ============================================================

const CACHE = "cooksync-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon-192.jpg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  // ⚠️ addAll は**1つでも404だと全部入らない**（監査 中-16）。
  //    オフライン用ページが入らないと、いざという時に真っ白になる単一障害点なので、
  //    1つずつ入れて失敗したものだけ諦める。
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        Promise.all(
          PRECACHE.map((u) =>
            fetch(u)
              .then((res) => (res.ok ? c.put(u, res) : null))
              .catch(() => null),
          ),
        ),
      )
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // APIは絶対にキャッシュしない（古い在庫・献立を見せない）
  if (url.pathname.startsWith("/api/")) return;

  // ビルド成果物はURLが内容で変わるのでキャッシュ優先で良い
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // 画面遷移：ネットワーク優先。切れていたら最後に見た画面 → それも無ければオフライン用ページ
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match(OFFLINE_URL)),
        ),
    );
    return;
  }

  // App Router のクライアント遷移(`?_rsc=`)はキャッシュしない。
  // 入れてしまうとデプロイ後に毎回 stale → buildId不一致で全画面リロードになる。
  if (url.searchParams.has("_rsc")) return;

  // 画像などのその他：キャッシュ優先で通信を減らす
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            // ⚠️ **ステータスを見ずに put してはいけない**（監査 高-3）。
            //    404/5xx をそのまま焼き込むと、キャッシュ名にバージョンが無いので
            //    **二度と消えない**。実際、参照されている画像を一時的に消したことがあり、
            //    その状態でアクセスされていたら「戻しても壊れたまま」になっていた。
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => hit),
    ),
  );
});
