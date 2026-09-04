/* 执棋 · Service Worker —— 让 App 可安装、可离线，且「打开即更新」 */
const CACHE = 'zhiqi-v35';
const CORE = [
  './', './index.html',
  './assets/css/style.css',
  './assets/js/store.js', './assets/js/vault.js', './assets/js/brain.js', './assets/js/oracle.js',
  './assets/js/engine.js',
  './assets/js/undercover.js', './assets/js/ui.js', './assets/js/lock.js', './assets/js/app.js',
  './assets/manifest.json', './assets/icon.svg',
  './assets/img/strategist-avatar.png'
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

  // 导航 / HTML 请求：network-first —— 壳永远是最新的，满足「打开即更新」
  const isNav = e.request.mode === 'navigate'
    || url.pathname === '/' || url.pathname.endsWith('/index.html');
  if(isNav){
    e.respondWith(
      fetch(e.request).then(resp=>{
        if(resp && resp.ok && url.origin === self.location.origin){
          const cp = resp.clone();
          caches.open(CACHE).then(c=>c.put(e.request, cp));
        }
        return resp;
      }).catch(()=> caches.match(e.request).then(r=> r || caches.match('./index.html')))
    );
    return;
  }

  // 其余静态资源：cache-first + 后台静默更新（stale-while-revalidate）
  // 有缓存立即返回 → 秒开；同时在后台把最新内容写回缓存。
  // 资源 URL 带 ?v=N：新版本号对旧缓存是「未命中」，自动去网络取新文件，
  // 既秒开又不会锁死旧版本，离线时仍可回退缓存。
  e.respondWith((async()=>{
    const cached = await caches.match(e.request);
    if(cached){
      // 后台刷新缓存，不阻塞响应
      fetch(e.request).then(r=>{
        if(r && r.ok && url.origin === self.location.origin){
          caches.open(CACHE).then(c=>c.put(e.request, r.clone()));
        }
      }).catch(()=>{});
      return cached;
    }
    // 无缓存：走网络并写入
    try{
      const resp = await fetch(e.request);
      if(resp && resp.ok && url.origin === self.location.origin){
        const cp = resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request, cp));
      }
      return resp;
    }catch(err){
      return caches.match('./index.html') || Response.error();
    }
  })());
});
