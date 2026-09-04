/* =========================================================
   执棋 · 启动与路由 (app.js)
   —— 导航按优先级分层：一级常驻 / 二级折叠 / 三级深层抽屉
   ========================================================= */
(function(){
  // 逃生舱：网址加 ?force=1 打开一次，强制注销旧 Service Worker 并清空缓存后重载，
  // 彻底解决「部署了却死活看不到更新」的问题（只需一次，之后全自动更新）。
  if(location.search.indexOf('force')>=0 && 'serviceWorker' in navigator){
    Promise.all([
      caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k)))),
      navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister())))
    ]).then(()=>{ window.location.href = location.pathname + location.hash; });
    return;
  }

  const S = window.ZQ.store;
  const E = window.ZQ.engine;
  const U = window.ZQ.undercover;
  const UI = window.ZQ.ui;
  const $ = s=>document.querySelector(s);

  /* ---------- 导航分层配置（权重分级的唯一真相源） ---------- */
  // 排序即体现使用频率与「计划 → 执行 → 目标 → 复盘」的真实流程。
  // 一级：每日核心循环，常驻底部栏 / 桌面侧边栏
  const NAV_PRIMARY = [
    {view:'today',   icon:'♟️', label:'今日'},
    {view:'calendar',icon:'📅', label:'棋历'},
    {view:'manual',  icon:'📋', label:'谋局'},
    {view:'notes',   icon:'📝', label:'随记'},
  ];
  // 二级：常用，收纳于「更多」抽屉的「常用」区
  const NAV_SECONDARY = [
    {view:'power',  icon:'📊', label:'战绩',   desc:'完成率与进度'},
    {view:'report', icon:'📈', label:'周报',   desc:'每周深度复盘'},
  ];
  // 三级：低频 / 附属，收敛于「工具箱」
  const NAV_TERTIARY = [
    {view:'undercover', icon:'🔐', label:'卧底档案', desc:'代号与情报'},
    {view:'timeline',   icon:'🗺️', label:'十年棋局', desc:'成长长图'},
    {view:'tips',       icon:'💡', label:'锦囊',   desc:'大人物习惯'},
    {action:'backup',   icon:'💾', label:'数据备份', desc:'导出 / 导入 / 重置'},
    {action:'about',    icon:'ℹ️', label:'关于执棋', desc:'版本与说明'},
  ];
  const ALL_VIEWS = [...NAV_PRIMARY, ...NAV_SECONDARY, ...NAV_TERTIARY].map(x=>x.view).filter(Boolean);

  // 图标+文字包进 .t-in，选中态才能只把「图标+文字」罩在柔和药丸底色里（而非整条拉通）
  function navBtnHTML(item, cls){
    const icon = item.icon?`<span class="t-ic">${item.icon}</span>`:'';
    const inner = `<span class="t-in">${icon}<em>${item.label}</em></span>`;
    if(item.action) return `<button class="${cls}" data-action="${item.action}">${inner}</button>`;
    return `<button class="${cls}" data-view="${item.view}">${inner}</button>`;
  }
  // 「更多」抽屉项带描述，比纯按钮信息密度更合适
  function moreItemHTML(it){
    const icon = `<span class="mi">${it.icon}</span>`;
    const label = `<span class="ml">${it.label}</span>`;
    const desc = it.desc?`<span class="md">${it.desc}</span>`:'';
    if(it.action) return `<button class="more-item" data-action="${it.action}">${icon}${label}${desc}</button>`;
    return `<button class="more-item" data-view="${it.view}">${icon}${label}${desc}</button>`;
  }
  function escHTML(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  /* ---------- 侧边栏（桌面端）：一级常驻 + 更多折叠组 ---------- */
  function buildSidebar(){
    if($('.sidebar')) return;
    const el=document.createElement('aside');
    el.className='sidebar';
    const primaryHTML = NAV_PRIMARY.map(x=>navBtnHTML(x,'side-item')).join('');
    const secHTML = NAV_SECONDARY.map(x=>navBtnHTML(x,'side-sub')).join('');
    const terHTML = NAV_TERTIARY.map(x=>navBtnHTML(x,'side-sub')).join('');
    el.innerHTML=`
      <div class="side-brand"><div class="brand-mark">♟</div><h1>执棋</h1></div>
      <nav class="side-nav">${primaryHTML}</nav>
      <div class="side-collapse">
        <button class="side-collapse-btn" id="side-more-toggle">
          <span>更多功能</span><span class="caret">›</span>
        </button>
        <div class="side-collapse-body" id="side-more-body" hidden>
          <div class="side-sub-title">常用</div>
          ${secHTML}
          <div class="side-sub-title muted">工具箱</div>
          ${terHTML}
        </div>
      </div>
      <div class="side-foot">每天落一子，十年成大局<br>你不是在打卡，是在卧底。</div>`;
    $('#app').appendChild(el);

    el.querySelectorAll('.side-item,.side-sub').forEach(b=>{
      b.addEventListener('click',()=>{
        if(b.dataset.view) UI.navigate(b.dataset.view);
        else if(b.dataset.action==='backup') openBackup();
        else if(b.dataset.action==='about') openAbout();
      });
    });
    $('#side-more-toggle').addEventListener('click',()=>{
      const body=$('#side-more-body'); const open=body.hidden;
      body.hidden=!open;
      $('#side-more-toggle').classList.toggle('open', open);
    });
  }

  /* ---------- 底部标签栏：由 NAV_PRIMARY 统一生成（单一真相源） ---------- */
  function buildTabbar(){
    const bar=$('#tabbar'); if(!bar) return;
    const items=NAV_PRIMARY.slice(0,4).map(x=>navBtnHTML(x,'tab'));
    items.push(`<button class="tab" data-view="more"><span class="t-in"><span class="t-ic">⋯</span><em>更多</em></span></button>`);
    bar.innerHTML=items.join('');
  }

  /* ---------- 底部「更多」抽屉（移动端） ---------- */
  function openMore(){ buildMore(); $('#more-sheet').hidden=false; }
  function closeMore(){ $('#more-sheet').hidden=true; }
  // 更多抽屉内容按配置生成一次，避免与底部栏 / 侧边栏定义漂移
  function buildMore(){
    const body=$('#more-body'); if(!body || body.dataset.built) return;
    const sec=NAV_SECONDARY.map(x=>moreItemHTML(x)).join('');
    const ter=NAV_TERTIARY.map(x=>moreItemHTML(x)).join('');
    const spaceSec = S.needUnlock() ? `
      <div class="more-sec">
        <div class="more-sec-title muted">数据空间</div>
        <button class="more-item" data-action="lock"><span class="mi">🔐</span><span class="ml">锁定 / 换一个图案</span></button>
      </div>` : '';
    body.innerHTML=`
      <div class="more-sec">
        <div class="more-sec-title">常用</div>${sec}
      </div>
      <div class="more-sec">
        <div class="more-sec-title muted">工具箱</div>${ter}
      </div>${spaceSec}`;
    body.dataset.built='1';
    body.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{ UI.navigate(b.dataset.view); closeMore(); }));
    body.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>{
      closeMore();
      if(b.dataset.action==='backup') openBackup();
      else if(b.dataset.action==='about') openAbout();
      else if(b.dataset.action==='lock') relock();
    }));
  }
  /* 锁定 / 换图案：丢掉内存里的密钥，回到解锁页。
     换一个图案 = 进入另一个数据空间（不同图案对应不同文件，互不相通）。
     这里用 reload 而不是原地重渲染，避免事件被重复绑定。 */
  function relock(){
    S.lock();
    location.reload();
  }
  function bindMore(){
    buildTabbar();
    document.querySelectorAll('#tabbar .tab').forEach(t=>{
      if(t.dataset.view==='more') t.addEventListener('click',openMore);
      else t.addEventListener('click',()=>UI.navigate(t.dataset.view));
    });
    $('#close-more').addEventListener('click',closeMore);
    $('#more-sheet').addEventListener('click',e=>{ if(e.target.id==='more-sheet') closeMore(); });
  }

  /* ---------- 数据备份（三级 · 原混在棋力） ---------- */
  function openBackup(){ $('#backup-sheet').hidden=false; bindBackupOnce(); }
  let _backupBound=false;
  function bindBackupOnce(){
    if(_backupBound) return; _backupBound=true;
    $('#close-backup').addEventListener('click',()=>{ $('#backup-sheet').hidden=true; });
    $('#backup-sheet').addEventListener('click',e=>{ if(e.target.id==='backup-sheet') $('#backup-sheet').hidden=true; });
    $('#export-btn').addEventListener('click',()=>{
      const data=S.exportJSON();
      const blob=new Blob([data],{type:'application/json'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
      a.download='执棋备份_'+S.fmtDate(S.today())+'.json'; a.click(); UI.toast('已导出备份');
    });
    $('#import-btn').addEventListener('click',()=>$('#import-file').click());
    $('#import-file').addEventListener('change',e=>{
      const f=e.target.files[0]; if(!f) return;
      const r=new FileReader();
      r.onload=()=>{ try{ S.importJSON(r.result); UI.toast('导入成功'); UI.navigate(UI.current||'today'); $('#backup-sheet').hidden=true; }catch(err){ UI.toast('文件格式不对'); } };
      r.readAsText(f);
    });
    $('#reset-btn').addEventListener('click',()=>{
      UI.confirm('重置棋局','确定要清空所有棋局、重新开始吗？\n建议先导出备份，换设备时再导入恢复。',()=>{
        S.reset(); UI.toast('已重置'); UI.navigate('today'); $('#backup-sheet').hidden=true;
      }, true);
    });
  }

  /* ---------- 关于 ---------- */
  function openAbout(){
    $('#about-sheet').hidden=false;
    const v=(window.ZQ && window.ZQ.__VER) || '';
    $('#about-ver').textContent = v ? ('当前版本：'+v) : '离线版 · 数据本机保存';
  }
  let _aboutBound=false;
  function bindAboutOnce(){
    if(_aboutBound) return; _aboutBound=true;
    // 关闭：X 按钮 + 点遮罩空白处（之前漏绑，导致点叉号无反应）
    $('#close-about').addEventListener('click',()=>{ $('#about-sheet').hidden=true; });
    $('#about-sheet').addEventListener('click',e=>{ if(e.target.id==='about-sheet') $('#about-sheet').hidden=true; });
  }

  /* ---------- 军师浮层（保留大脑入口，去除重复的「推荐新棋」） ---------- */
  function renderStrategistLog(){
    const st=S.load();
    const box=$('#strategist-log');
    if(!box) return;
    if(!st.log.length){ box.innerHTML='<div class="muted small center" style="padding:20px">军师暂未派发指令。</div>'; return; }
    box.innerHTML=st.log.slice(0,40).map(l=>{
      const me = l.from==='我';
      return `<div class="s-msg ${me?'me':''}">
        <div class="av">${me?'🙂':`<img src="assets/img/strategist-avatar.png" alt="军师" class="av-img">`}</div>
        <div class="bubble"><div class="who">${me?'我':esc(l.from)}</div>${esc(l.text)}</div>
      </div>`;
    }).join('');
    box.scrollTop=box.scrollHeight;
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function bindStrategist(){
    $('#open-strategist').addEventListener('click',()=>{ $('#strategist-sheet').hidden=false; renderStrategistLog(); });
    $('#close-strategist').addEventListener('click',UI.closeStrategist);
    $('#strategist-sheet').addEventListener('click',e=>{ if(e.target.id==='strategist-sheet') UI.closeStrategist(); });
    $('#close-modal').addEventListener('click',UI.closeModal);
    $('#modal-sheet').addEventListener('click',e=>{ if(e.target.id==='modal-sheet') UI.closeModal(); });

    $('#btn-tomorrow-preview').addEventListener('click',()=>{
      const tm=S.fmtDate(S.shiftDay(S.today(),1)); E.ensureDailyPlan(tm);
      const tasks=S.tasksOf(tm).slice().sort((a,b)=>a.order-b.order);
      const rows=tasks.map(t=>{
        const g=t.goalId?S.getGoal(t.goalId):null;
        return `<div class="row between" style="padding:9px 0;border-bottom:1px solid var(--line)">
          <span>${esc(t.title)}</span>
          <span class="muted small">${t.duration}′ · ${t.type==='fragment'?'碎片':t.type==='evening'?'晚间':t.type==='byway'?'顺路':'习惯'}${g?' · '+esc(g.title):''}</span>
        </div>`;
      }).join('');
      UI.modal('📅 明日棋局预览（'+tm+'）',`<div>${rows||'<p class="muted">暂无自动任务</p>'}</div>
        <p class="small muted mt12">明早打开「今日棋局」，这些任务会自动就位。你也可以现在用一句话加任务。</p>`);
    });

    $('#btn-strategist-dispatch').addEventListener('click',()=>{
      const todayStr=S.fmtDate(S.today());
      E.ensureDailyPlan(todayStr);
      const cmd=E.strategistCommand(todayStr);
      S.pushLog('军师',cmd.msg,'dispatch');
      renderStrategistLog();
      UI.toast('军师已派发今日指令');
    });
  }

  function welcome(){
    const st=S.load();
    if(st.log.length===0){
      S.pushLog('军师','你来了。我是你的军师，代号「摆渡人」。你不用自己想明天做什么——六级、计算机二级、减重、考公，我替你拆成每天的小任务。你只管打开「今日棋局」，照做，打勾。十年后回头看，今天就是你入局的第一天。','welcome');
    }
  }

  /* 解锁之后才做的初始化：渲染界面、绑定交互、注册 Service Worker */
  async function boot(){
    U.init();
    U.checkDateTransition();
    E.maybeWeeklyBigshot();
    E.weekendNudge();
    E.pushPredictions();   // 启动即预判并主动推送
    welcome();
    buildSidebar();
    bindStrategist();
    bindMore();
    bindAboutOnce();
    // 顶部「连续落子」徽章本就是信息入口：点它直接进棋力看数据
    const streakChip=$('#streak-chip');
    if(streakChip) streakChip.addEventListener('click',()=>UI.navigate('power'));

    const last=localStorage.getItem('zhiqi_lastview')||'today';
    UI.updateTopbar();
    UI.navigate(ALL_VIEWS.includes(last)?last:'today');

    // PWA：仅在 http/https 下注册，file:// 直接打开同样可用
    if('serviceWorker' in navigator && location.protocol.indexOf('http')===0){
      // 注册 URL 带版本号：每次部署版本号变化，浏览器无法命中旧缓存，实现「打开即更新」
      navigator.serviceWorker.register('sw.js?v=35').catch(()=>{});
      // 新版本 Service Worker 接管后，自动刷新一次页面，让用户立即看到新内容
      // 若首屏仍在加载，等 load 完成再刷新，避免「先白屏硬刷」的卡顿感
      let _reloaded=false;
      navigator.serviceWorker.addEventListener('controllerchange', ()=>{
        if(_reloaded) return; _reloaded=true;
        if(document.readyState==='complete') window.location.reload();
        else window.addEventListener('load', ()=>window.location.reload(), {once:true});
      });
    }
  }

  /* 启动分流：
     - 配了云同步 → 先弹图案解锁，图案决定进哪个数据空间，解锁成功才 boot()
     - 没配云同步 / 用户在解锁页点了「仅用本机」→ 直接走本地模式 */
  async function init(){
    window.ZQ.__VER='v34';
    S.onCloudStatus(function(s){
      if(s==='fail') UI.toast('云端同步失败，已用本机数据');
    });
    if(S.needUnlock() && !S.isUnlocked() && window.ZQ && window.ZQ.lock){
      window.ZQ.lock.show(async function(){ await boot(); });
      return;
    }
    await S.init();
    await boot();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
