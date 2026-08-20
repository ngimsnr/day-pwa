'use strict';

/* オフライン対応: アプリ本体を全てキャッシュし、ネットワーク優先で配信する
   (オンラインなら常に最新、落ちているときだけキャッシュ)。デプロイ時は VERSION を上げる。 */
const VERSION = 'day-v29';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/store.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // HTTP キャッシュを迂回して必ずサーバーから最新を取る
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ネットワーク優先。オフラインのときだけキャッシュを使う。
   以前はキャッシュ優先だったため、データ形式を変えた更新で「古いコード + 新しいデータ」
   が成立し、集計が静かに NaN になる事故が起きた (2026-08-19)。
   古いコードが居座れない構造にして再発を防ぐ。 */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
