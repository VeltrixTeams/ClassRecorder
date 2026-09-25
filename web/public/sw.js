self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "LectureNote", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "LectureNote";
  const options = {
    body: data.body || "",
    icon: "/icon.png",
    data: { lectureId: data.lecture_id || data.lectureId },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const lectureId = event.notification.data && event.notification.data.lectureId;
  const url = lectureId ? `/lectures/${lectureId}` : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
