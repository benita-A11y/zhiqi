/* 执棋 · Service Worker —— 让 App 可安装、可离线（飞行模式）使用 */
const CACHE = 'zhiqi-v5';
const CORE = [
  './', './index.html',
  './assets/css/style.css',
  './assets/js/store.js', './assets/js/engine.js',
  './assets/js/undercover.js', './assets/js/ui.js', './assets/js/app.js',
  './assets/manifest.json', './assets/icon.svg'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{})).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(
    caches.match(e.request).then(r=> r || fetch(e.request).then(resp=>{
      const cp = resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request, cp));
      return resp;
    }).catch(()=> caches.match('./index.html')))
  );
});
