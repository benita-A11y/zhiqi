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
  // 一级：每日核心，常驻主导航
  const NAV_PRIMARY = [
    {view:'today',  icon:'♟️', label:'今日棋局'},
    {view:'manual', icon:'📋', label:'棋谱'},
  ];
  // 二级：常用，收纳于「更多」抽屉的常用区
  const NAV_SECONDARY = [
    {view:'calendar', icon:'📅', label:'棋历'},
    {view:'notes',    icon:'📝', label:'随记'},
    {view:'power',    icon:'📊', label:'棋力'},
  ];
  // 三级：低频/附属，收敛于「工具箱」
  const NAV_TERTIARY = [
    {view:'undercover', icon:'🔐', label:'卧底档案'},
    {action:'backup',   icon:'💾', label:'数据备份'},
    {action:'about',    icon:'ℹ️', label:'关于执棋'},
  ];
  const ALL_VIEWS = [...NAV_PRIMARY, ...NAV_SECONDARY, ...NAV_TERTIARY].map(x=>x.view).filter(Boolean);

  function navBtnHTML(item, cls){
    const icon = item.icon?`<span>${item.icon}</span>`:'';
    if(item.action) return `<button class="${cls}" data-action="${item.action}">${icon}${item.label}</button>`;
    return `<button class="${cls}" data-view="${item.view}">${icon}${item.label}</button>`;
  }

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

  /* ---------- 底部「更多」抽屉（移动端） ---------- */
  function openMore(){ $('#more-sheet').hidden=false; }
  function closeMore(){ $('#more-sheet').hidden=true; }
  function bindMore(){
    // 底部标签：一级直接跳转，更多打开抽屉
    document.querySelectorAll('.tab').forEach(t=>{
      if(t.dataset.view==='more') return; // 单独处理
      t.addEventListener('click',()=>UI.navigate(t.dataset.view));
    });
    const tab=document.querySelector('.tab[data-view="more"]');
    if(tab) tab.addEventListener('click',openMore);
    $('#close-more').addEventListener('click',closeMore);
    $('#more-sheet').addEventListener('click',e=>{ if(e.target.id==='more-sheet') closeMore(); });
    $('#more-sheet').querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
      UI.navigate(b.dataset.view); closeMore();
    }));
    $('#open-backup').addEventListener('click',()=>{ closeMore(); openBackup(); });
    $('#open-about').addEventListener('click',()=>{ closeMore(); openAbout(); });
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
      if(confirm('确定要清空所有棋局、重新开始吗？建议先导出备份。')){ S.reset(); UI.toast('已重置'); UI.navigate('today'); $('#backup-sheet').hidden=true; }
    });
  }

  /* ---------- 关于 ---------- */
  function openAbout(){
    $('#about-sheet').hidden=false;
    const v=(window.ZQ && window.ZQ.__VER) || '';
    $('#about-ver').textContent = v ? ('当前版本：'+v) : '离线版 · 数据本机保存';
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

  function init(){
    S.load();
    U.init();
    U.checkDateTransition();
    E.maybeWeeklyBigshot();
    E.weekendNudge();
    welcome();
    buildSidebar();
    bindStrategist();
    bindMore();

    const last=localStorage.getItem('zhiqi_lastview')||'today';
    UI.updateTopbar();
    UI.navigate(ALL_VIEWS.includes(last)?last:'today');

    // PWA：仅在 http/https 下注册，file:// 直接打开同样可用
    if('serviceWorker' in navigator && location.protocol.indexOf('http')===0){
      // 注册 URL 带版本号：每次部署版本号变化，浏览器无法命中旧缓存，实现「打开即更新」
      navigator.serviceWorker.register('sw.js?v=20').catch(()=>{});
      // 新版本 Service Worker 接管后，自动刷新一次页面，让用户立即看到新内容
      let _reloaded=false;
      navigator.serviceWorker.addEventListener('controllerchange', ()=>{
        if(_reloaded) return; _reloaded=true; window.location.reload();
      });
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
