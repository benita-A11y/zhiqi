/* ============================================================
   执棋 · 图案解锁 (lock.js)
   ————————————————————————————————————————————————————
   画一个图案 → 进入属于这个图案的数据空间。

   图案做什么用：
     · 决定「云端哪个文件」  —— 不同图案 = 不同文件 = 互不干扰的两份数据
     · 决定「能不能解开内容」 —— 图案在本地派生密钥，密文只有它能开

   设计取舍（诚实写在界面上）：
     3×3 图案的组合约百万级，能挡住随手试探，但挡不住拿到密文后
     的离线暴力破解 —— 所以提供「暗号」叠加，加了暗号才是真安全。
   ============================================================ */
(function(){
  const $  = s => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';

  const GRID = 3, CELL = 100, PAD = 50, SIZE = 300;
  const HIT  = 36;      // 命中半径（300 坐标系下）
  const MIN  = 4;       // 最少连 4 个点
  const REMEMBER_KEY = 'zhiqi_pattern_v1';

  const pts = [];
  for(let r=0;r<GRID;r++) for(let c=0;c<GRID;c++) pts.push({ x: PAD + c*CELL, y: PAD + r*CELL });

  let seq = [], drawing = false, cur = null, busy = false;
  let onUnlocked = null;

  /* ---------- 构建九宫格 ---------- */
  function buildPad(){
    const wrap = $('#pattern-dots');
    if(!wrap || wrap.childElementCount) return;
    wrap.innerHTML = pts.map((p,i)=>
      `<span class="pdot" data-i="${i}" style="left:${(p.x/SIZE*100)}%;top:${(p.y/SIZE*100)}%"></span>`
    ).join('');
  }

  /* ---------- 坐标换算：屏幕 → 300 坐标系 ---------- */
  function toLocal(e){
    const pad = $('#pattern-pad');
    const r = pad.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width  * SIZE,
      y: (e.clientY - r.top)  / r.height * SIZE
    };
  }
  function nearest(p){
    let best = -1, bd = HIT;
    pts.forEach((q,i)=>{
      const d = Math.hypot(q.x-p.x, q.y-p.y);
      if(d < bd){ bd = d; best = i; }
    });
    return best;
  }

  /* ---------- 绘制连线 ---------- */
  function render(){
    const svg = $('#pattern-svg');
    const wrap = $('#pattern-dots');
    if(!svg || !wrap) return;
    while(svg.firstChild) svg.removeChild(svg.firstChild);
    wrap.querySelectorAll('.pdot').forEach(d=>d.classList.remove('on'));
    if(!seq.length) return;

    const path = seq.map(i=>pts[i]);
    if(drawing && cur) path.push(cur);
    const line = document.createElementNS(NS,'polyline');
    line.setAttribute('points', path.map(p=>p.x+','+p.y).join(' '));
    line.setAttribute('class','pline');
    svg.appendChild(line);
    seq.forEach(i=>{
      const el = wrap.querySelector('.pdot[data-i="'+i+'"]');
      if(el) el.classList.add('on');
    });
  }

  /* ---------- 强度提示 ---------- */
  function strength(){
    const n = seq.length;
    const pass = ($('#lock-passphrase') ? $('#lock-passphrase').value.trim() : '');
    if(pass.length >= 8) return { text:'很强 · 图案 + 暗号', cls:'s4' };
    if(pass.length >= 4) return { text:'强 · 图案 + 暗号',   cls:'s3' };
    if(n >= 8)           return { text:'较好 · 建议再加个暗号', cls:'s2' };
    if(n >= 6)           return { text:'中等 · 建议再加个暗号', cls:'s2' };
    if(n >= MIN)         return { text:'较弱 · 强烈建议加暗号', cls:'s1' };
    return { text:'', cls:'' };
  }
  function refreshHint(){
    const el = $('#pattern-hint'), s = strength();
    if(!el) return;
    if(!seq.length){ el.textContent = '至少连 '+MIN+' 个点'; el.className = 'pattern-hint'; return; }
    el.textContent = (seq.length < MIN)
      ? ('已连 '+seq.length+' 点，还差 '+(MIN-seq.length)+' 点')
      : s.text;
    el.className = 'pattern-hint ' + (seq.length < MIN ? '' : s.cls);
  }

  function clearPattern(){
    seq = []; drawing = false; cur = null; pending = null;
    render(); refreshHint();
    const err = $('#lock-error'); if(err) err.textContent = '';
    resetEnterBtn('进入');
  }

  /* ---------- 事件 ---------- */
  function bindPad(){
    const pad = $('#pattern-pad');
    if(!pad) return;
    const start = e=>{
      if(busy) return;
      e.preventDefault();
      const p = toLocal(e);
      const i = nearest(p);
      if(i < 0) return;
      drawing = true; seq = [i]; cur = p;
      try{ pad.setPointerCapture(e.pointerId); }catch(_){}
      render(); refreshHint();
    };
    const move = e=>{
      if(!drawing) return;
      e.preventDefault();
      cur = toLocal(e);
      const i = nearest(cur);
      if(i >= 0 && seq.indexOf(i) < 0) seq.push(i);
      render(); refreshHint();
    };
    const end = e=>{
      if(!drawing) return;
      drawing = false; cur = null;
      try{ pad.releasePointerCapture(e.pointerId); }catch(_){}
      render(); refreshHint(); afterDraw();
    };
    pad.addEventListener('pointerdown', start);
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('pointerleave', end);
  }

  /* ---------- 记住图案（仅本机） ---------- */
  function remember(pattern){
    try{ localStorage.setItem(REMEMBER_KEY, pattern); }catch(e){}
  }
  function remembered(){
    try{ return localStorage.getItem(REMEMBER_KEY) || ''; }catch(e){ return ''; }
  }
  function forget(){
    try{ localStorage.removeItem(REMEMBER_KEY); }catch(e){}
  }
  function restoreRemembered(){
    const p = remembered();
    if(!p) return false;
    const arr = p.split('-').map(Number).filter(n=>n>=0 && n<9);
    if(arr.length < MIN) return false;
    seq = arr; render(); refreshHint();
    const cb = $('#lock-remember'); if(cb) cb.checked = true;
    return true;
  }

  /* ---------- 用过的空间（只记 spaceId，不记图案；仅本机） ---------- */
  const SPACES_KEY = 'zhiqi_spaces_v1';
  function knownSpaces(){
    try{ return JSON.parse(localStorage.getItem(SPACES_KEY) || '[]'); }catch(e){ return []; }
  }
  function rememberSpace(spaceId){
    if(!spaceId) return;
    const list = knownSpaces().filter(x => x.spaceId !== spaceId);
    list.unshift({ spaceId, ts: Date.now() });
    try{ localStorage.setItem(SPACES_KEY, JSON.stringify(list.slice(0,20))); }catch(e){}
  }

  /* 画完就实时提示：这个图案指向的空间，是不是我以前用过的那个。
     画错图案会指向一个全新空间 —— 在按「进入」之前先告诉用户，避免误建空棋盘。 */
  async function afterDraw(){
    if(seq.length < MIN) return;
    const V = window.ZQ && window.ZQ.vault;
    if(!V || !V.spaceIdOf) return;
    try{
      const sid  = await V.spaceIdOf(seq.join('-'));
      const hit  = knownSpaces().some(x => x.spaceId === sid);
      const hint = $('#pattern-hint'), s = strength();
      if(hint){
        hint.textContent = (hit ? '✓ 这个图案有棋局' : '○ 新图案，会新建一份') + ' · ' + s.text;
        hint.className = 'pattern-hint ' + s.cls;
      }
    }catch(e){}
  }

  /* ---------- 解锁 ---------- */
  let pending = null;      // 待确认的新空间 { pattern, pass }
  function resetEnterBtn(text){
    const btn = $('#lock-enter');
    if(btn){ btn.textContent = text || '进入'; btn.disabled = false; delete btn.dataset.mode; }
    const cl = $('#lock-clear'); if(cl) cl.textContent = '重画';
    const fresh = $('#lock-fresh'); if(fresh) fresh.hidden = true;
  }
  async function enter(){
    const btn = $('#lock-enter');
    if(btn && btn.dataset.mode === 'create') return doCreate(true);
    if(busy) return;
    const errEl = $('#lock-error');
    const pass  = ($('#lock-passphrase') ? $('#lock-passphrase').value.trim() : '');
    if(seq.length < MIN){
      if(errEl) errEl.textContent = '至少连 '+MIN+' 个点';
      shake(); return;
    }
    busy = true;
    const old = btn ? btn.textContent : '';
    if(btn){ btn.textContent = '解锁中…'; btn.disabled = true; }
    if(errEl) errEl.textContent = '';
    try{
      const pattern = seq.join('-');
      const res = await window.ZQ.store.unlock(pattern, pass);
      if(!res || !res.ok){
        if(errEl) errEl.textContent = (res && res.error) || '进不去，再试一次';
        shake();
        return;
      }
      if(res.isNew){
        /* 这个图案还没有棋局 —— 先不建，等用户点头。
           否则画错图案就会得到一个空棋盘，还以为数据丢了。 */
        pending = { pattern, pass };
        const S = window.ZQ.store;
        const legacy = S.hasLegacyData && S.hasLegacyData();   // 本机还留着改造前的旧数据？
        const hint = $('#pattern-hint');
        if(hint){
          hint.textContent = legacy ? '这个图案还没有棋局 · 可把本机原有数据搬进来' : '这个图案还没有棋局';
          hint.className = 'pattern-hint';
        }
        if(btn){
          btn.textContent = legacy ? '把数据搬进来' : '在这里新建';
          btn.dataset.mode = 'create'; btn.disabled = false;
        }
        const cl = $('#lock-clear'); if(cl) cl.textContent = '换个图案';
        const fresh = $('#lock-fresh'); if(fresh) fresh.hidden = !legacy;
        return;
      }
      const cb = $('#lock-remember');
      if(cb && cb.checked) remember(pattern); else forget();
      rememberSpace(window.ZQ.store.currentSpace());
      if(res.degraded){
        window.ZQ.ui && window.ZQ.ui.toast && window.ZQ.ui.toast('云端连不上，已用本机数据');
      }
      hide();
      if(onUnlocked) await onUnlocked(res);
    }catch(e){
      if(errEl) errEl.textContent = '出了点问题：' + (e && e.message);
      shake();
    }finally{
      busy = false;
      resetEnterBtn(old);
    }
  }
  /* 用户确认后，才真正创建这个新空间 */
  async function doCreate(useLegacy){
    if(busy || !pending) return;
    busy = true;
    const btn = $('#lock-enter'), errEl = $('#lock-error');
    if(btn){ btn.textContent = '创建中…'; btn.disabled = true; }
    try{
      await window.ZQ.store.createSpace(useLegacy);
      const cb = $('#lock-remember');
      if(cb && cb.checked) remember(pending.pattern); else forget();
      rememberSpace(window.ZQ.store.currentSpace());
      window.ZQ.ui && window.ZQ.ui.toast && window.ZQ.ui.toast(
        useLegacy ? '已把本机原有数据搬进这个空间' : '新空间建好了，换图案就是另一份数据'
      );
      hide();
      if(onUnlocked) await onUnlocked({ ok:true, isNew:true });
    }catch(e){
      if(errEl) errEl.textContent = '创建失败：' + (e && e.message);
      shake();
    }finally{
      busy = false; pending = null;
      resetEnterBtn('进入');
    }
  }
  function shake(){
    const card = $('#lock-card');
    if(!card) return;
    card.classList.remove('shake');
    void card.offsetWidth;           // 强制重排，保证连续两次错误都能再抖一次
    card.classList.add('shake');
  }

  /* ---------- 显隐 ---------- */
  function show(cb){
    onUnlocked = cb || null;
    const scr = $('#lock-screen');
    if(!scr) return;
    scr.hidden = false;
    buildPad();
    bindPadOnce();
    restoreRemembered();
    refreshHint();
  }
  function hide(){
    const scr = $('#lock-screen');
    if(scr) scr.hidden = true;
  }
  let _bound = false;
  function bindPadOnce(){
    if(_bound) return; _bound = true;
    buildPad(); bindPad();
    const b1 = $('#lock-clear');   if(b1) b1.addEventListener('click', clearPattern);
    const b2 = $('#lock-enter');   if(b2) b2.addEventListener('click', enter);
    const t  = $('#lock-adv-toggle');
    const pi = $('#lock-passphrase');
    if(t && pi){
      t.addEventListener('click', ()=>{
        pi.hidden = !pi.hidden;
        t.textContent = pi.hidden ? '＋ 加一句暗号（更安全）' : '－ 收起暗号';
        if(!pi.hidden) pi.focus();
      });
      pi.addEventListener('input', refreshHint);
    }
    const b3 = $('#lock-local');
    if(b3) b3.addEventListener('click', async ()=>{
      // 仅用本机：不解锁、不上云，行为与改造前完全一致
      await window.ZQ.store.init();
      hide();
      if(onUnlocked) await onUnlocked({ ok:true, offline:true });
    });
    const b4 = $('#lock-forget');
    if(b4) b4.addEventListener('click', ()=>{ forget(); clearPattern(); });
    const b5 = $('#lock-fresh');   // 建空间时「从空白开始」（不搬旧数据）
    if(b5) b5.addEventListener('click', ()=>{ doCreate(false); });
  }

  window.ZQ = window.ZQ || {};
  window.ZQ.lock = { show, hide, clearPattern, forget, remembered };
})();
