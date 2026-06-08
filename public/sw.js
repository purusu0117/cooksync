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
