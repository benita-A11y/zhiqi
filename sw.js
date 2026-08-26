/* 执棋 · Service Worker —— 让 App 可安装、可离线，且「打开即更新」 */
const CACHE = 'zhiqi-v15';
const CORE = [
  './', './index.html',
  './assets/css/style.css',
  './assets/js/store.js', './assets/js/engine.js',
  './assets/js/undercover.js', './assets/js/ui.js', './assets/js/app.js',
  './assets/manifest.json', './assets/icon.svg'
];

self.addEventListener('install', e=>{
  // 安装阶段把核心文件写入「当前版本」缓存，再立即接管（不等旧页面关闭）
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{}))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', e=>{
  // 删除所有「非当前版本」的旧缓存，避免交叉命中旧文件
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

  // 导航/HTML 请求走 network-first：保证每次打开都拿到最新页面入口，
  // 不会困在旧 Service Worker 缓存里。失败再回退缓存（离线可用）。
  if(e.request.mode==='navigate' || url.pathname.endsWith('.html')){
    e.respondWith(
      fetch(e.request).then(resp=>{
        const cp = resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request, cp));
        return resp;
      }).catch(()=> caches.match(e.request).then(r=> r || caches.match('./index.html')))
    );
    return;
  }

  // 其余静态资源：缓存优先（离线友好），同时后台写入最新版本
  e.respondWith(
    caches.match(e.request).then(r=> r || fetch(e.request).then(resp=>{
      const cp = resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request, cp));
      return resp;
    }).catch(()=> caches.match('./index.html')))
  );
});
