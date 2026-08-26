/* 执棋 · Service Worker —— 让 App 可安装、可离线（飞行模式）使用 */
const CACHE = 'zhiqi-v11';
const CORE = [
  './', './index.html',
  './assets/css/style.css',
  './assets/js/store.js', './assets/js/engine.js',
  './assets/js/undercover.js', './assets/js/ui.js', './assets/js/app.js',
  './assets/manifest.json', './assets/icon.svg'
];

self.addEventListener('install', e=>{
  // 安装阶段把核心文件写入「当前版本」缓存，再立即接管
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{}))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', e=>{
  // 关键修复：删除所有「非当前版本」的旧缓存，
  // 否则 caches.match 会跨缓存命中旧文件，导致永远看到旧版本。
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET') return;
  const url = new URL(e.request.url);
  // sw.js 自身交给浏览器默认处理，确保更新检查能拿到最新脚本
  if(url.pathname.endsWith('/sw.js')) return;
  e.respondWith(
    caches.match(e.request).then(r=> r || fetch(e.request).then(resp=>{
      const cp = resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request, cp));
      return resp;
    }).catch(()=> caches.match('./index.html')))
  );
});
