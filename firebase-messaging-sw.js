// Recibe las notificaciones de fallas aunque la página esté cerrada
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyALzmDOa8K-xfFGbay8tpVCbhIdq6NaMTc",
  authDomain: "mantenimiento-la-josefina.firebaseapp.com",
  projectId: "mantenimiento-la-josefina",
  storageBucket: "mantenimiento-la-josefina.firebasestorage.app",
  messagingSenderId: "1024154810561",
  appId: "1:1024154810561:web:2273253427bfc622613c40"
});
firebase.messaging();
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var d = e.notification.data || {};
  var url = (d.FCM_MSG && d.FCM_MSG.data && d.FCM_MSG.data.url) || d.url || './#alertas';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ws) {
    for (var i = 0; i < ws.length; i++) { if ('focus' in ws[i]) { ws[i].navigate(url); return ws[i].focus(); } }
    return clients.openWindow(url);
  }));
});
