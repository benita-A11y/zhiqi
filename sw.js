/* 执棋 · Service Worker —— 让 App 可安装、可离线，且「打开即更新」 */
const CACHE = 'zhiqi-v16';
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

  // 全部静态资源走 network-first：每次打开都优先拉取最新文件。
  // 配合 index.html 里带 ?v=N 的资源引用——新版本号对老 Service Worker 是
  // 缓存「未命中」，必然会去网络取新文件；老用户无需手动清缓存即可自动升级。
  // 仅在「在线取数成功」时把最新内容写入缓存，网络失败时再回退缓存（离线可用）。
  e.respondWith(
    fetch(e.request).then(resp=>{
      if(resp && resp.ok && url.origin === self.location.origin){
        const cp = resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request, cp));
      }
      return resp;
    }).catch(()=> caches.match(e.request).then(r=> r || caches.match('./index.html')))
  );
});
