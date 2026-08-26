/* =========================================================
   执棋 · 启动与路由 (app.js)
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

  function buildSidebar(){
    if($('.sidebar')) return;
    const el=document.createElement('aside');
    el.className='sidebar';
    el.innerHTML=`
      <div class="side-brand"><div class="brand-mark">♟</div><h1>执棋</h1></div>
      <nav class="side-nav">
        <button class="side-item" data-view="today"><span>♟️</span>今日棋局</button>
        <button class="side-item" data-view="calendar"><span>📅</span>棋历</button>
        <button class="side-item" data-view="manual"><span>📋</span>棋谱</button>
        <button class="side-item" data-view="notes"><span>📝</span>随记</button>
        <button class="side-item" data-view="power"><span>📊</span>棋力</button>
        <button class="side-item" data-view="undercover"><span>🔐</span>卧底</button>
      </nav>
      <div class="side-foot">每天落一子，十年成大局<br>你不是在打卡，是在卧底。</div>`;
    $('#app').appendChild(el);
    el.querySelectorAll('.side-item').forEach(b=>b.addEventListener('click',()=>UI.navigate(b.dataset.view)));
  }

  function renderStrategistLog(){
    const st=S.load();
    const box=$('#strategist-sheet')?$('#strategist-log'):null;
    if(!box) return;
    if(!st.log.length){ box.innerHTML='<div class="muted small center" style="padding:20px">军师暂未派发指令。</div>'; return; }
    box.innerHTML=st.log.slice(0,40).map(l=>{
      const me = l.from==='我';
      return `<div class="s-msg ${me?'me':''}">
        <div class="av">${me?'🙂':'🎖️'}</div>
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

    $('#btn-new-goal-suggest').addEventListener('click',()=>{
      const recos=E.recommendGoals();
      const html=recos.map(r=>`
        <div class="reco-item">
          <h4>🎯 ${esc(r.title)} <span class="tag">${esc(r.cat)}</span></h4>
          <div class="why">${esc(r.why)}</div>
          <div class="analy">💡 ${esc(r.analyze)}（${esc(r.weekly)}）</div>
          <div class="reco-foot"><span class="muted small">军师为你布的新棋</span>
            <button class="btn primary sm" data-addreco="${esc(r.title)}">加入棋谱</button></div>
        </div>`).join('');
      UI.modal('🎖️ 军师布下的新棋',`<div>${html}</div>`,body=>{
        body.querySelectorAll('[data-addreco]').forEach(b=>b.addEventListener('click',()=>{
          S.addGoal({title:b.dataset.addreco,category:'推荐目标',type:'generic',color:'#C5B4E3',
            current:'新棋局',target:'由军师陪你达成',dailyTime:20,weeklyDays:5,resources:'—',
            stages:[{name:'起步',weeks:'第1-2周',core:'建立节奏'},{name:'积累',weeks:'第3-6周',core:'持续投入'},
              {name:'突破',weeks:'第7-10周',core:'质变'},{name:'收官',weeks:'第11-12周',core:'成果'}]});
          UI.closeModal(); UI.toast('已加入棋谱'); UI.navigate('manual');
        }));
      });
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

    document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>UI.navigate(t.dataset.view)));

    const last=localStorage.getItem('zhiqi_lastview')||'today';
    UI.updateTopbar();
    UI.navigate(last);

    // PWA：仅在 http/https 下注册，file:// 直接打开同样可用
    if('serviceWorker' in navigator && location.protocol.indexOf('http')===0){
      // 注册 URL 带版本号：每次部署版本号变化，浏览器无法命中旧缓存，实现「打开即更新」
      navigator.serviceWorker.register('sw.js?v=17').catch(()=>{});
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
