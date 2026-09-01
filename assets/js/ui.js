/* =========================================================
   执棋 · UI 渲染与交互 (ui.js)
   ========================================================= */
(function(){
  const S = window.ZQ.store;
  const E = window.ZQ.engine;
  const U = window.ZQ.undercover;
  const O = window.ZQ.oracle;

  const $ = sel => document.querySelector(sel);
  const view = $('#view');
  let current = 'today';

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  const TYPE_LABEL = {fragment:'⏳ 碎片任务',evening:'📖 晚间任务',byway:'🚶 顺路任务',habit:'🌙 习惯养成'};
  const TYPE_ICON = {fragment:'⏳',evening:'📖',byway:'🚶',habit:'🌙'};
  function typeTag(t){ return `<span class="tag t-${t}">${TYPE_ICON[t]||'•'} ${TYPE_LABEL[t].split(' ')[0]}</span>`; }
  function goalTag(goalId){
    if(!goalId) return '';
    const g=S.getGoal(goalId); if(!g) return '';
    return `<span class="tag goal" style="background:${g.color}"><span class="dot"></span>${esc(g.title)}</span>`;
  }

  /* ---------- Toast ---------- */
  let toastTimer=null;
  function toast(msg){
    const t=$('#toast'); t.textContent=msg; t.hidden=false;
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.hidden=true,2200);
  }

  /* ---------- 通用弹窗 ---------- */
  function modal(title, bodyHTML, after){
    $('#modal-title').textContent=title;
    $('#modal-body').innerHTML=bodyHTML||'<div class="muted small center" style="padding:24px">暂无内容，军师正在调集情报。</div>';
    $('#modal-sheet').hidden=false;
    if(after) after($('#modal-body'));
  }
  function closeModal(){ $('#modal-sheet').hidden=true; }
  function closeStrategist(){ $('#strategist-sheet').hidden=true; }

  /* ---------- 站内确认 / 输入弹窗（替代原生 confirm/prompt）
     原因：预览面板 / PWA 的 webview 常会拦截原生 confirm()/prompt()，导致「点了没反应」。
     站内弹窗风格与主题统一，且在任何环境都稳定可用。 ---------- */
  function dialog(opts){
    const mask=document.createElement('div'); mask.className='sheet-mask';
    const actions=(opts.actions||[]).map((a,i)=>
      `<button class="btn ${a.cls||'ghost'}" data-dlg="${i}">${esc(a.label)}</button>`).join('');
    mask.innerHTML=`<div class="sheet modal">
      <div class="sheet-head"><h2>${esc(opts.title||'提示')}</h2></div>
      <div class="sheet-body">${opts.bodyHTML||''}
        <div class="row wrap mt16" style="justify-content:flex-end">${actions}</div>
      </div></div>`;
    document.body.appendChild(mask);
    const close=()=>mask.remove();
    mask.addEventListener('click',e=>{ if(e.target===mask) close(); });
    mask.querySelectorAll('[data-dlg]').forEach(b=>b.addEventListener('click',()=>{
      const a=opts.actions[+b.dataset.dlg];
      const inp=mask.querySelector('#dlg-input');
      const val=inp?inp.value:null;
      close();
      if(a&&a.onClick) a.onClick(val);
    }));
    setTimeout(()=>{ const inp=mask.querySelector('#dlg-input'); if(inp) inp.focus(); },60);
    return mask;
  }
  // 确认框：danger=true 时确认键用红色实心，强调破坏性
  function confirm(title,msg,onYes,danger){
    dialog({
      title,
      bodyHTML:`<p class="small dlg-msg">${esc(msg)}</p>`,
      actions:[
        {label:'取消', cls:'ghost', onClick:()=>{}},
        {label:'确认', cls: danger?'danger':'primary', onClick:()=>{ if(onYes) onYes(); }}
      ]
    });
  }
  // 输入框：onOk 收到已 trim 的文本
  function prompt(title,msg,onOk,opts){
    opts=opts||{};
    dialog({
      title,
      bodyHTML:`${msg?`<p class="small dlg-msg" style="margin-bottom:10px">${esc(msg)}</p>`:''}
        <div class="field" style="margin:0"><input id="dlg-input" value="${esc(opts.value||'')}" placeholder="${esc(opts.placeholder||'')}"></div>`,
      actions:[
        {label:'取消', cls:'ghost', onClick:()=>{}},
        {label:'确定', cls:'primary', onClick:(val)=>{ if(onOk) onOk((val||'').trim()); }}
      ]
    });
  }

  /* 随时段变化的温柔问候——无红点、无 badge，只是轻轻铺垫今天的氛围 */
  function timeGreeting(){
    const h = new Date().getHours();
    if(h>=5  && h<11) return {icon:'🌤', text:'晨光正好，今天慢慢落子'};
    if(h>=11 && h<14) return {icon:'🌞', text:'日头正暖，先吃口饭再战'};
    if(h>=14 && h<18) return {icon:'🍃', text:'午后悠长，一件件来'};
    if(h>=18 && h<21) return {icon:'🌆', text:'暮色起了，收个尾就好好歇着'};
    return {icon:'🌙', text:'夜深了，轻一点，慢慢来'};
  }

  /* =========================================================
     视图：今日棋局
     ========================================================= */
  function renderToday(){
    const st=S.load();
    const todayStr=S.fmtDate(S.today());
    E.ensureDailyPlan(todayStr);
    const cmd=E.strategistCommand(todayStr);
    const tasks=S.tasksOf(todayStr).slice().sort((a,b)=>a.order-b.order);
    const allDone = tasks.length>0 && tasks.every(t=>t.done);
    const doneN = tasks.filter(t=>t.done).length;
    const donePct = tasks.length? Math.round(doneN/tasks.length*100):0;

    // 预判：主动比用户先想一步
    const preds=E.predict();
    const predictHTML = preds.length? `
      <div class="card predict-card fade-in" title="点此打开军师会客厅" data-open-strategist>
        <div class="who"><img class="who-avatar" src="assets/img/strategist-avatar.png" alt=""> 军师预判</div>
        <ul class="predict-list">
          ${preds.map(p=>`<li>${esc(p.text)}</li>`).join('')}
        </ul>
      </div>` : '';

    // 此刻状态：把「现在到底什么情况」摊开——精力 / 负荷 / 今日预测，都是实时算出来的
    const strat = cmd.energy, loadD = cmd.load, fcD = cmd.forecast;
    const stratHTML = (strat||loadD||fcD)? `
      <div class="card strat-card fade-in">
        <div class="who"><img class="who-avatar" src="assets/img/strategist-avatar.png" alt=""> 今日气象</div>
        <div class="strat-grid">
          ${strat?`<div class="strat-cell">
            <div class="sc-lab">精力</div>
            <div class="sc-num">${strat.energy}<i>/100</i></div>
            <div class="strat-bar"><i class="lv-${strat.level}" style="width:${strat.energy}%"></i></div>
            <div class="sc-sub">${esc(strat.slotCN)} · ${esc(strat.levelCN)}</div>
          </div>`:''}
          ${loadD?`<div class="strat-cell">
            <div class="sc-lab">今日负荷</div>
            <div class="sc-num">${loadD.minutes}<i>′</i></div>
            <div class="strat-bar"><i class="lv-${loadD.level}" style="width:${Math.min(100,Math.round(loadD.ratio*100))}%"></i></div>
            <div class="sc-sub">${esc(loadD.levelCN)} · 可用 ${loadD.capacity}′</div>
          </div>`:''}
          ${fcD?`<div class="strat-cell">
            <div class="sc-lab">今日预测</div>
            <div class="sc-num">${Math.round(fcD.rate*100)}<i>%</i></div>
            <div class="strat-bar"><i class="lv-${fcD.level==='high'?'high':fcD.level==='mid'?'mid':'low'}" style="width:${Math.round(fcD.rate*100)}%"></i></div>
            <div class="sc-sub">${fcD.expect!=null?('预计 '+fcD.expect+'/'+fcD.total+' 项'):'样本积累中'}</div>
          </div>`:''}
        </div>
        ${cmd.next?`<div class="strat-next">🎯 ${esc(cmd.next)}</div>`:''}
      </div>` : '';

    // 今日小贴士（每日轮换一位大人物的习惯）
    const bs=E.dailyTip();
    const tipHTML = bs? `
      <div class="card tip-card fade-in" id="tip-card">
        <div class="who"><img class="who-avatar" src="assets/img/strategist-avatar.png" alt=""> 今日锦囊</div>
        <div class="tip-who">${esc(bs.who)} <span class="tip-tag">${esc(bs.cat)}</span></div>
        <div class="tip-role">${esc(bs.tag)}</div>
        <div class="tip-habit">${esc(bs.habit)}</div>
        <div class="tip-txt">军师：${esc(bs.tip)}</div>
      </div>` : '';

    const g = timeGreeting();
    let html = `
      <div class="today-greet"><span class="ge">${g.icon}</span>${esc(g.text)}</div>

      <div class="card strategist-cmd fade-in" title="点此打开军师会客厅" data-open-strategist>
        <div class="who"><img class="who-avatar" src="assets/img/strategist-avatar.png" alt=""> ${esc(cmd.who)}</div>
        <div class="msg">${esc(cmd.msg)}</div>
      </div>

      <div class="strat-rail">
        ${predictHTML}
        ${stratHTML}
        ${tipHTML}
      </div>

      <div class="quick-add">
        <input id="quick-input" placeholder="一句话生成待办，如：明早去图书馆背30个单词顺便打印资料" />
        <button class="btn primary" id="quick-add-btn">落子</button>
      </div>

      <div class="route-add">
        <span class="route-ic">🚶</span>
        <input id="route-input" placeholder="今天要去哪？如：图书馆" />
        <button class="btn ghost sm" id="route-btn">顺路</button>
      </div>

      <div class="today-head">
        <div class="card-title">♟️ 今日落子</div>
        ${tasks.length?`<div class="today-prog" title="已完成 ${doneN}/${tasks.length}">
          <div class="today-prog-bar"><i style="width:${donePct}%"></i></div>
          <span class="today-prog-txt">${doneN}/${tasks.length}</span>
        </div>`:''}
      </div>
      <div id="task-list">${renderTaskList(tasks)}</div>
    `;

    if(allDone){
      const fb=E.completeFeedback();
      const nudge=E.undercoverNudge();
      html += `
      <div class="feedback-box fade-in">
        <div class="ttl"><img class="ttl-avatar" src="assets/img/strategist-avatar.png" alt=""> 军师回执</div>
        <div class="msg">${esc(fb.msg)}</div>
        <div class="intel">🕵️ 情报碎片 ${fb.intel} · ${esc(fb.next)}</div>
        ${fb.nba?`<div class="intel nba">🎯 ${esc(fb.nba)}</div>`:''}
        ${nudge?`<div class="intel">${esc(nudge)}</div>`:''}
      </div>`;
    }

    view.innerHTML = html;
    bindToday(tasks);
    // 「军师预判 / 军师指令」两张卡点开即唤起军师会客厅，
    // 把首页的军师信号与「摆渡人指令」归到同一入口，用户一眼知道军师在哪
    view.querySelectorAll('[data-open-strategist]').forEach(c=>{
      c.classList.add('clickable-strategist');
      c.addEventListener('click',()=>{ const o=$('#open-strategist'); if(o) o.click(); });
    });
  }

  let showDoneTasks=false;   // 任务多时：默认收起「已完成」，把视线留给还没做的事

  function renderTaskList(tasks){
    if(tasks.length===0) return `<div class="empty"><div class="em">♟️</div><p>今日棋局空空如也。<br>说一句话，或点开军师头像让军师派发任务。</p></div>`;

    // 长列表减负：已完成 ≥3 且总数 ≥6 时，把已完成的折叠成一行
    const doneN = tasks.filter(t=>t.done).length;
    const foldDone = (doneN>=3 && tasks.length>=6 && !showDoneTasks);
    const shown = foldDone ? tasks.filter(t=>!t.done) : tasks;

    let html=''; let lastType=null;
    shown.forEach(t=>{
      if(t.type!==lastType){
        const cnt=tasks.filter(x=>x.type===t.type).length;
        html += `<div class="group-label"><span class="bar"></span>${TYPE_LABEL[t.type]}<span class="cnt">${cnt}项</span></div>`;
        lastType=t.type;
      }
      const g = t.goalId?S.getGoal(t.goalId):null;
      const dur = t.duration || 15;
      const hasExtra = !!(t.location || t.time || g);

      /* 自适应档位：按「时长 + 信息量」决定卡片尺寸，不搞一刀切
         compact  ≤10分钟且无附加信息 → 一行搞定，省空间
         expanded ≥40分钟 或 需要整块时间的晚间任务 → 多给一行「怎么下手」
         其余     → 标准两行                                          */
      let size = 'normal';
      if(dur <= 10 && !hasExtra) size = 'compact';
      else if(dur >= 40 || t.type === 'evening') size = 'expanded';

      const actions = `
        <div class="task-actions">
          <button data-edit="${t.id}" title="编辑">✎</button>
          <button data-del="${t.id}" title="删除">🗑</button>
        </div>`;

      if(size === 'compact'){
        html += `
        <div class="task compact ${t.done?'done':''}" data-sortable data-id="${t.id}">
          <div class="task-handle">⠿</div>
          <div class="check ${t.done?'on':''}" data-check="${t.id}"></div>
          <div class="task-main"><div class="task-title">${esc(t.title)}</div></div>
          <span class="task-dur">${dur}′</span>
          ${actions}
        </div>`;
      } else if(size === 'expanded'){
        const d = E.decompose(t) || { steps:[] };
        const steps = (d.steps||[]).slice(0,3).map((s,i)=>
          `<div class="ts-row"><i>${i+1}</i><span>${esc(typeof s==='string'? s : s.text)}</span>${(s&&s.min)?`<b class="ts-min">${s.min}′</b>`:''}</div>`).join('');
        html += `
        <div class="task expanded ${t.done?'done':''}" data-sortable data-id="${t.id}">
          <div class="task-handle">⠿</div>
          <div class="check ${t.done?'on':''}" data-check="${t.id}"></div>
          <div class="task-main">
            <div class="task-title">${esc(t.title)}</div>
            <div class="task-meta">
              <span class="mini">⏱ ${dur}分钟</span>
              ${typeTag(t.type)}
              ${g?goalTag(t.goalId):''}
              ${t.location?`<span class="mini">📍 ${esc(t.location)}</span>`:''}
              ${t.time?`<span class="mini">🕒 ${esc(t.time)}</span>`:''}
            </div>
            ${steps?`<div class="task-steps">${steps}</div>`:''}
          </div>
          ${actions}
        </div>`;
      } else {
        html += `
        <div class="task ${t.done?'done':''}" data-sortable data-id="${t.id}">
          <div class="task-handle">⠿</div>
          <div class="check ${t.done?'on':''}" data-check="${t.id}"></div>
          <div class="task-main">
            <div class="task-title">${esc(t.title)}</div>
            <div class="task-meta">
              <span class="mini">⏱ ${dur}分钟</span>
              ${t.location?`<span class="mini">📍 ${esc(t.location)}</span>`:''}
              ${typeTag(t.type)}
              ${g?goalTag(t.goalId):''}
              ${t.time?`<span class="mini">🕒 ${esc(t.time)}</span>`:''}
            </div>
          </div>
          ${actions}
        </div>`;
      }
    });

    // 折叠/展开已完成的开关
    if(foldDone){
      html += `<button class="fold-done-btn" id="toggle-done">展开已完成的 ${doneN} 项 ▾</button>`;
    } else if(doneN>=3 && showDoneTasks){
      html += `<button class="fold-done-btn" id="toggle-done">收起已完成的 ${doneN} 项 ▴</button>`;
    }
    return html;
  }

  function bindToday(tasks){
    // 一句话落子
    const qin=$('#quick-input');
    const doAdd=()=>{
      const txt=qin.value.trim(); if(!txt){ toast('先说一句话～'); return; }
      const parsed=E.parseSentence(txt);
      let todayN=0, otherN=0;
      parsed.forEach(p=>{ S.addTask(p.date, p); if(p.date===S.fmtDate(S.today())) todayN++; else otherN++; });
      qin.value='';
      renderToday();
      toast(`已落子 ${parsed.length} 项${otherN?`（含明日 ${otherN} 项）`:''}`);
    };
    $('#quick-add-btn').addEventListener('click',doAdd);
    qin.addEventListener('keydown',e=>{ if(e.key==='Enter') doAdd(); });

    // 展开 / 收起「已完成」（把视线留给还没做的事）
    const td=$('#toggle-done');
    if(td) td.addEventListener('click',()=>{ showDoneTasks=!showDoneTasks; renderToday(); });

    // 顺路清单：地点 → 匹配任务 → 弹窗选择加入今日
    const routeInput=$('#route-input');
    const doRoute=()=>{
      const place=routeInput.value.trim(); if(!place){ toast('先说去哪～'); return; }
      const list=E.routeSuggestions(place);
      if(!list.length){ toast('暂未匹配到顺路任务，你可一句话添加'); return; }
      const bw = list._byway;
      const rows=list.map((r,i)=>`
        <label class="route-opt">
          <input type="checkbox" checked data-idx="${i}">
          <span class="ro-title">${esc(r.title)}${r.score?`<b class="ro-score" title="顺路度">${r.score}</b>`:''}</span>
          <span class="ro-meta">${r.duration}′ · ${TYPE_LABEL[r.type].split(' ')[0]}${r.goalId&&S.getGoal(r.goalId)?' · '+esc(S.getGoal(r.goalId).title):''}</span>
          ${r.reason?`<span class="ro-reason">${esc(r.reason)}</span>`:''}
        </label>`).join('');
      modal('🚶 顺路任务推荐：'+esc(place),`
        <p class="small muted">${bw&&bw.note?esc(bw.note):'军师按地点为你挑了这些，勾选后加入今日棋局。'}</p>
        ${bw&&bw.chainMin?`<div class="route-chain">🧭 打包办完前 ${bw.chain.length} 件约 ${bw.chainMin} 分钟，跑一趟就够</div>`:''}
        <div class="route-list mt12">${rows}</div>
        <button class="btn primary block mt12" id="route-add-all">加入今日棋局</button>
      `,body=>{
        body.querySelector('#route-add-all').addEventListener('click',()=>{
          const checks=[...body.querySelectorAll('.route-opt input')];
          let added=0;
          checks.forEach(c=>{
            if(!c.checked) return;
            const r=list[+c.dataset.idx];
            if(r.source==='route-inbox' && r._id){ S.setTaskDate(r._id, S.fmtDate(S.today())); }
            else S.addTask(S.fmtDate(S.today()), {title:r.title, duration:r.duration, type:r.type, location:r.location, goalId:r.goalId||null, source:'route'});
            added++;
          });
          closeModal(); renderToday();
          toast(`已加入 ${added} 项顺路任务`);
        });
      });
    };
    $('#route-btn').addEventListener('click',doRoute);
    routeInput.addEventListener('keydown',e=>{ if(e.key==='Enter') doRoute(); });

    // 小贴士卡 → 跳转小贴士库
    const tipCard=$('#tip-card');
    if(tipCard) tipCard.addEventListener('click',()=>UI.navigate('tips'));

    // 勾选完成
    view.querySelectorAll('[data-check]').forEach(c=>{
      c.addEventListener('click',()=>{
        const id=c.dataset.check; const t=S.tasksOf(S.fmtDate(S.today())).find(x=>x.id===id)||findTaskAny(id);
        if(!t) return;
        S.setDone(id, !t.done);
        updateTopbar();
        renderToday();
      });
    });

    // 编辑 / 删除
    view.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>editTask(b.dataset.edit)));
    view.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{
      S.deleteTask(b.dataset.del); toast('已删除'); renderToday();
    }));

    // 拖拽排序
    makeSortable($('#task-list'),'.task-handle',(ids)=>{
      S.reorder(S.fmtDate(S.today()),ids);
    });
  }

  function findTaskAny(id){
    const st=S.load();
    for(const d in st.tasks){ const f=st.tasks[d].find(t=>t.id===id); if(f) return f; }
    return null;
  }

  function editTask(id){
    const t=findTaskAny(id); if(!t) return;
    modal('编辑待办',`
      <div class="field"><label>内容</label><input id="e-title" value="${esc(t.title)}"></div>
      <div class="field-row">
        <div class="field"><label>时长(分钟)</label><input id="e-dur" type="number" value="${t.duration}"></div>
        <div class="field"><label>类型</label>
          <select id="e-type">
            ${['fragment','evening','byway','habit'].map(o=>`<option value="${o}" ${o===t.type?'selected':''}>${TYPE_LABEL[o]}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field"><label>地点(可选)</label><input id="e-loc" value="${esc(t.location||'')}"></div>
      <button class="btn primary block" id="e-save">保存</button>
    `,body=>{
      body.querySelector('#e-save').addEventListener('click',()=>{
        S.updateTask(id,{title:body.querySelector('#e-title').value.trim(),
          duration:+body.querySelector('#e-dur').value||15,
          type:body.querySelector('#e-type').value,
          location:body.querySelector('#e-loc').value.trim()});
        closeModal(); renderToday(); toast('已更新');
      });
    });
  }

  /* =========================================================
     视图：棋谱（目标）
     ========================================================= */
  function renderManual(){
    const st=S.load();
    let goalsHtml = st.goals.map(g=>{
      const plan=E.weeklyPlanFor(g);
      const weekRows=[1,2,3,4,5,6,0].map(wd=>{
        const items=(plan[wd]||[]).map(s=>`<div class="wt">${esc(s.title)} <span class="wd">${s.duration}′·${TYPE_LABEL[s.type].split(' ')[0]}</span></div>`).join('<br>');
        return `<tr><td>${S.weekdayCN[wd]}</td><td>${items||'<span class="wd">休息/轻量</span>'}</td></tr>`;
      }).join('');
      const stagePills=g.stages.map((s,i)=>`<span class="stage-pill ${i<g.stageIndex?'done':i===g.stageIndex?'active':''}">${esc(s.name)}</span>`).join('');
      const prog=Math.round(g.stageIndex/(g.stages.length)*100);
      return `
      <div class="card goal-card" style="border-left-color:${g.color}">
        <div class="goal-top">
          <div style="flex:1;min-width:0">
            <div class="goal-name">${esc(g.title)}</div>
            <div class="goal-cat">${esc(g.category)} · 现状：${esc(g.current)} → 目标：${esc(g.target)}</div>
          </div>
          <span class="stage-pill ${g.status==='done'?'done':''}">${g.status==='done'?'已完成':'进行中'}</span>
        </div>
        <div class="goal-prog"><i style="width:${g.status==='done'?100:prog}%"></i></div>
        <div class="goal-prog-txt"><span>阶段进度 ${g.stageIndex+1}/${g.stages.length}</span><span>第${S.weekOf(g.createdAt)}周</span></div>
        <div class="stage-flow">${stagePills}</div>
        <div class="card-title mt12" style="font-size:14px">🗓 本周任务</div>
        <table class="week-table"><tr><th>星期</th><th>任务</th></tr>${weekRows}</table>
        <div class="row wrap mt12">
          ${g.status!=='done'&&g.stageIndex<g.stages.length-1?`<button class="btn ghost sm" data-advance="${g.id}">推进到下一阶段</button>`:''}
          ${g.status!=='done'?`<button class="btn mint sm" data-complete="${g.id}">完成目标</button>`:''}
          <button class="btn ghost sm danger" data-delgoal="${g.id}">删除目标</button>
        </div>
      </div>`;
    }).join('');

    const recos=E.recommendGoals();
    const recoHtml=recos.map(r=>`
      <div class="reco-item">
        <h4>🎯 ${esc(r.title)} <span class="tag">${esc(r.cat)}</span></h4>
        <div class="why">${esc(r.why)}</div>
        <div class="analy">💡 对你的分析：${esc(r.analyze)}（${esc(r.weekly)}）</div>
        <div class="reco-foot">
          <span class="muted small">军师为你布下的一颗新棋</span>
          <button class="btn primary sm" data-addreco="${esc(r.title)}|${esc(r.cat)}|${esc(r.weekly)}">加入谋局</button>
        </div>
      </div>`).join('');

    view.innerHTML = `
      <div class="cal-title" style="margin:0 0 10px">📋 谋局</div>
      <div class="card reco-card">
        <div class="card-title"><img class="title-avatar" src="assets/img/strategist-avatar.png" alt=""> 军师已为你布好局</div>
        <p class="small muted mt8">大目标，军师替你拆成每天的小任务。先做手上的，做完自动推下一步。</p>
        <div class="mt12">${recoHtml}</div>
      </div>
      <button class="btn primary block mb0" id="add-goal-btn">＋ 我要立一个新目标（5字段）</button>
      <div class="section-gap">${goalsHtml}</div>
    `;
    bindManual();
  }

  function bindManual(){
    const b=$('#add-goal-btn'); if(b) b.addEventListener('click',addGoalForm);
    view.querySelectorAll('[data-advance]').forEach(x=>x.addEventListener('click',()=>{
      S.advanceStage(x.dataset.advance); toast('已推进到下一阶段，明日任务已更新'); renderManual();
    }));
    view.querySelectorAll('[data-complete]').forEach(x=>x.addEventListener('click',()=>{
      confirm('完成目标','确认这个目标已经完成？\n军师会为你升级代号并推荐下一局。',()=>{
        U.completeGoal(x.dataset.complete); toast('🏆 目标达成，代号升级！'); renderManual(); updateTopbar();
      });
    }));
    view.querySelectorAll('[data-delgoal]').forEach(x=>x.addEventListener('click',()=>{
      confirm('删除目标','删除这个目标吗？\n它名下的任务也会一并移除。\n——军师会记得你走过的每一局，但此目标将不再出现在谋局里。',()=>{
        S.deleteGoal(x.dataset.delgoal); toast('目标已移除。想再开局的时候，随时立一个新目标。'); renderManual(); updateTopbar();
      }, true);
    }));
    view.querySelectorAll('[data-addreco]').forEach(x=>x.addEventListener('click',()=>{
      const [title,cat,weekly]=x.dataset.addreco.split('|');
      addRecommendedGoal(title,cat,weekly);
    }));
  }

  function addGoalForm(){
    modal('立一个新目标',`
      <p class="small muted">军师会根据这5个字段，自动拆解成阶段 + 周任务，并每天推送到「今日棋局」。</p>
      <div class="field mt12"><label>① 学什么 / 做什么</label><input id="g-title" placeholder="如：英语六级 / 学Python / 练字"></div>
      <div class="field"><label>② 现在水平</label><input id="g-cur" placeholder="如：369分未过 / 零基础"></div>
      <div class="field-row">
        <div class="field"><label>③ 每天可用时间</label><input id="g-time" type="number" value="30"><span class="hint">分钟</span></div>
        <div class="field"><label>④ 每周可用天数</label><input id="g-days" type="number" value="5"></div>
      </div>
      <div class="field"><label>⑤ 现有资源</label><input id="g-res" placeholder="如：单词APP、真题、B站课程"></div>
      <button class="btn primary block" id="g-save">交给军师拆解</button>
    `,body=>{
      body.querySelector('#g-save').addEventListener('click',()=>{
        const title=body.querySelector('#g-title').value.trim();
        if(!title){ toast('先写你想做什么'); return; }
        const goal=S.addGoal({
          title, category:'自定义目标', type:inferType(title), color:pickColor(),
          current:body.querySelector('#g-cur').value.trim()||'刚开始',
          dailyTime:+body.querySelector('#g-time').value||30,
          weeklyDays:+body.querySelector('#g-days').value||5,
          resources:body.querySelector('#g-res').value.trim()||'—',
          stages:defaultStages()
        });
        closeModal(); toast('已拆解，明天起自动派发任务'); renderManual(); updateTopbar();
      });
    });
  }
  function addRecommendedGoal(title,cat,weekly){
    const goal=S.addGoal({ title, category:cat, type:'generic', color:pickColor(),
      current:'新棋局', target:'由军师陪你达成', dailyTime:20, weeklyDays:5,
      resources:'—', stages:defaultStages() });
    toast(`已加入谋局：${title}`); renderManual(); updateTopbar();
  }
  function inferType(t){
    if(/六级|英语|单词|听力|阅读|翻译/.test(t)) return 'cet6';
    if(/计算机|二级|office|excel|word|ppt|编程|python|代码/.test(t)) return 'computer';
    if(/减肥|减重|体重|健身|塑形|运动/.test(t)) return 'weight';
    if(/考公|公务员|编制|考编|申论/.test(t)) return 'civil';
    return 'generic';
  }
  const COLORS=['#C5B4E3','#B4D4E3','#E3B4C5','#B4E3D4','#F2D2B6','#F4E6A8'];
  function pickColor(){ const st=S.load(); return COLORS[st.goals.length%COLORS.length]; }
  function defaultStages(){ return [
    {name:'起步',weeks:'第1-2周',core:'建立节奏'},
    {name:'积累',weeks:'第3-6周',core:'持续投入'},
    {name:'突破',weeks:'第7-10周',core:'寻求质变'},
    {name:'收官',weeks:'第11-12周',core:'成果交付'}
  ]; }

  /* =========================================================
     视图：随记 / 日记
     ========================================================= */
  /* 21 类情绪 → 中文标签 / 色调（顺带兼容旧数据的 good/bad） */
  const MOOD_CN = {
    anxious:'焦虑', tired:'疲惫', down:'低落', frustrated:'烦躁', lost:'迷茫',
    procrastinating:'拖延', lonely:'孤独', selfDoubt:'自我怀疑', perfectionist:'完美主义',
    hesitant:'犹豫', exhausted:'透支', giveUp:'想放弃', stressed:'压力大', guilty:'内疚',
    numb:'麻木', happy:'轻松', proud:'小骄傲', angry:'生气', bored:'无聊', moved:'被触动',
    flat:'平静', good:'情绪正向', bad:'有些低落'
  };
  const MOOD_TONE = { happy:'good', proud:'good', moved:'good', flat:'flat', good:'good', bad:'bad' };

  function renderNotes(){
    const st=S.load();
    const notes=st.notes.slice(0,30);
    const diaries=st.diaries.slice(0,12);
    const notesHtml=notes.length?notes.map(n=>{
      const mood=n.emotion||'flat';
      const emoTxt=MOOD_CN[mood]||'平静';
      const emoCls=MOOD_TONE[mood]||'bad';
      // 已存过结构化重点就直接用；老数据才现场分析（readonly：不写建议记忆，避免刷新跳层）
      const r=(n.topics||n.suggestion)?n:E.refineNote(n,{readonly:true});
      const tags=[];
      (r.topics||[]).slice(0,3).forEach(t=> tags.push(`<span class="rt topic">${esc(t)}</span>`));
      (r.blockers||[]).slice(0,2).forEach(t=> tags.push(`<span class="rt blocker">${esc(t)}</span>`));
      (r.metrics||[]).slice(0,2).forEach(m=> tags.push(`<span class="rt metric">${esc(m.raw)}</span>`));
      (r.actions||[]).slice(0,2).forEach(t=> tags.push(`<span class="rt action">${esc(t)}</span>`));
      if(r.when)  tags.push(`<span class="rt when">${esc(r.when)}</span>`);
      if(r.where) tags.push(`<span class="rt where">${esc(r.where)}</span>`);
      const refine=n.refined?`<div class="refine-box">
        ${tags.length?`<div class="refine-tags">${tags.join('')}</div>`:''}
        <div class="refine-advice">军师建议：<b>${esc(r.suggestion||'')}</b>${r.adviceLevel>1?`<span class="rt lv">进阶解法 ${r.adviceLevel}</span>`:''}</div>
        ${r.domain?`<div class="refine-domain">💡 ${esc(r.domain)}</div>`:''}
        ${r.taskId?'<div class="refine-linked">已关联今日任务</div>':''}</div>`:'';
      return `<div class="card note-card"><div class="note-text">${esc(n.text)}</div>
        <div class="note-meta"><span class="emotion ${emoCls}">${emoTxt}</span><span class="tag">${esc(n.date)}</span></div>${refine}</div>`;
    }).join(''):`<div class="empty"><div class="em">📝</div><p>还没有随记。<br>脑子里闪过的念头，先记下来，军师帮你整理成日记。</p></div>`;

    const diaHtml=diaries.length?diaries.map(d=>`
      <div class="card diary">
        <div class="d-date">📅 ${esc(d.date)}</div>
        <div class="d-line" style="white-space:pre-wrap">${esc(d.content)}</div>
      </div>`).join(''):`<div class="empty"><div class="em">📔</div><p>还没有日记。<br>先记几笔随记，再一键整理成日记。</p></div>`;

    // 军师会客厅：情绪回应 + 可直接提问（离线意图问答，不联网）
    const comfortNote=st.notes.find(n=>n.comfort);
    let asks=[];
    try{ asks=O.suggestedQuestions()||[]; }catch(e){ asks=[]; }
    const comfortHTML = `
      <div class="card comfort-card">
        <div class="who"><img class="who-avatar" src="assets/img/strategist-avatar.png" alt=""> 军师会客厅</div>
        ${comfortNote?`<div class="msg">${esc(comfortNote.comfort)}</div>
        <div class="comfort-from">—— 回应你的随记：「${esc(comfortNote.text.slice(0,24))}${comfortNote.text.length>24?'…':''}」</div>`:''}
        <div class="ask-box mt12">
          <input id="ask-input" placeholder="问军师：我这周能完成多少？" />
          <button class="btn primary sm" id="ask-btn">问</button>
        </div>
        <div class="ask-chips mt8">
          ${asks.map(q=>`<button class="ask-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
        </div>
        <div class="ask-answer mt12" id="ask-answer" hidden></div>
      </div>`;

    view.innerHTML=`
      <div class="card">
        <div class="card-title">📝 随记</div>
        <p class="small muted mt8">不用写得很完善，先记下片段，军师稍后帮你提炼重点、整理结构。</p>
        <div class="note-input mt12">
          <textarea id="note-input" placeholder="今天听力还是跟不上连读，烦……"></textarea>
          <button class="btn primary block" id="note-add">记下来</button>
        </div>
      </div>
      ${comfortHTML}
      <div class="section-gap">${notesHtml}</div>
      <button class="btn mint block mb0 mt12" id="review-btn">🌙 一键整理今日随记为日记</button>
      <div class="card-title mt16" style="font-size:15px">📔 我的日记</div>
      <div class="section-gap">${diaHtml}</div>
    `;
    bindNotes();
  }
  function bindNotes(){
    // 军师会客厅 · 提问：意图识别 → 调算法 → 用数据回答（全程离线）
    const doAsk=(q)=>{
      const inp=$('#ask-input'); if(!inp) return;
      if(q) inp.value=q;
      const text=(inp.value||'').trim();
      if(!text){ toast('想问什么？点上面的问题也行'); return; }
      let ans=null;
      try{ ans=E.ask(text); }catch(e){ ans=null; }
      const box=$('#ask-answer');
      if(!box) return;
      box.hidden=false;
      box.innerHTML=`<div class="aa-q">${esc(text)}</div>
        <div class="aa-a">${esc(ans&&ans.text? ans.text : '这个我还没学会。换个问法试试，比如「我今天该先做什么」。')}</div>`;
      inp.value='';
    };
    const ab=$('#ask-btn');      if(ab) ab.addEventListener('click',()=>doAsk());
    const ai=$('#ask-input');    if(ai) ai.addEventListener('keydown',e=>{ if(e.key==='Enter') doAsk(); });
    view.querySelectorAll('.ask-chip').forEach(c=>{
      c.addEventListener('click',()=>doAsk(c.dataset.q));
    });

    $('#note-add').addEventListener('click',()=>{
      const v=$('#note-input').value.trim(); if(!v){ toast('写点什么'); return; }
      const note=S.addNote({text:v});
      const r=E.refineNote(note);
      // 关键：把识别出的情绪一起传给军师再要回应，否则回应会落到「平静」兜底话术
      const er=E.emotionResponse({ id:note.id, text:v, emotion:r.emotion });
      S.updateNote(note.id,{
        emotion:r.emotion, points:r.points, taskId:r.taskId, refined:true, comfort:er||'',
        suggestion:r.suggestion, topics:r.topics, blockers:r.blockers, actions:r.actions,
        metrics:r.metrics, when:r.when, where:r.where, summary:r.summary, adviceLevel:r.adviceLevel
      });
      if(er) S.pushLog('军师', er, 'comfort');
      $('#note-input').value=''; toast(r.suggestion||'已记录'); renderNotes();
    });
    $('#review-btn').addEventListener('click',()=>{
      const todayStr=S.fmtDate(S.today());
      const content=E.generateReview(todayStr);
      S.addDiary({date:todayStr,content});
      U.recordReview();
      modal('📔 今日复盘日记',`<div class="d-line" style="white-space:pre-wrap;line-height:1.7">${esc(content)}</div>
        <button class="btn primary block mt12" id="dia-ok">收下，明天继续</button>`,body=>{
        body.querySelector('#dia-ok').addEventListener('click',()=>{ closeModal(); renderNotes(); updateTopbar(); });
      });
    });
  }

  /* =========================================================
     视图：棋力（统计）
     ========================================================= */
  function renderPower(){
    const st=S.load();
    const u=st.undercover;
    // 完成率（全部任务）
    let total=0,done=0;
    for(const d in st.tasks){ st.tasks[d].forEach(t=>{ total++; if(t.done) done++; }); }
    const rate= total? Math.round(done/total*100):0;
    const lvl=U.getLevelInfo();
    const stat=`<div class="stat-grid">
      <div class="stat-card purple"><div class="num">${rate}%</div><div class="lab">累计完成率</div></div>
      <div class="stat-card pink"><div class="num">${u.streak}</div><div class="lab">连续落子(天)</div></div>
      <div class="stat-card mint"><div class="num">${u.intelFragments}/${u.intelMax}</div><div class="lab">情报碎片</div></div>
      <div class="stat-card blue"><div class="num" style="font-size:15px;line-height:1.5;margin-top:4px">${esc(lvl.name)}</div><div class="lab">当前代号</div></div>
    </div>`;

    // 近7天
    let bars='';
    for(let i=6;i>=0;i--){
      const d=S.fmtDate(S.shiftDay(S.today(),-i));
      const arr=st.tasks[d]||[]; const dt=arr.filter(t=>t.done).length; const tt=arr.length;
      const p= tt? Math.round(dt/tt*100):0;
      bars+=`<div class="bar-row"><span class="day">${S.weekdayShort[new Date(d+'T00:00:00').getDay()]}</span>
        <div class="bar-track"><i style="width:${p}%"></i></div><span class="pct">${p}%</span></div>`;
    }
    const goalRows=st.goals.map(g=>{
      const prog=g.status==='done'?100:Math.round(g.stageIndex/g.stages.length*100);
      return `<div class="bar-row"><span class="day" style="width:auto;flex:1;font-weight:600">${esc(g.title)}</span>
        <div class="bar-track" style="flex:2"><i style="width:${prog}%;background:${g.color}"></i></div>
        <span class="pct">${g.status==='done'?'完成':prog+'%'}</span></div>`;
    }).join('');

    view.innerHTML=`
      <div class="card"><div class="card-title">📊 战绩</div>${stat}</div>
      <div class="card chart-card"><div class="card-title">近7天完成率</div>${bars}</div>
      <div class="card chart-card"><div class="card-title">目标进度</div>${goalRows}</div>
      <div class="card hint-card">
        <div class="card-title">🔐 数据离线保存</div>
        <p class="small muted mt8">所有数据存在本机，飞行模式也能用。导出 / 导入 / 重置请在「更多 → 工具箱 → 数据备份」。</p>
      </div>
    `;
    bindPower();
  }
  function bindPower(){ /* 数据管理已统一收进三级「数据备份」弹窗，棋力仅展示洞察 */ }

  /* =========================================================
     视图：卧底
     ========================================================= */
  function renderUndercover(){
    const st=S.load(); const u=st.undercover; const lvl=U.getLevelInfo(); const prog=U.progressToNext();
    const intelCells=Array.from({length:u.intelMax},(_,i)=>
      `<div class="intel-cell ${i<u.intelFragments?'have':''}">${i<u.intelFragments?'🕵️ 已收集':'情报'}</div>`).join('');
    const titlesHtml=Object.values(U.TITLES).map(t=>
      `<span class="title-chip ${u.titles.includes(t)?'on':''}">${u.titles.includes(t)?'🏅':''}${esc(t)}</span>`).join('');
    const secrets=st.undercover.secrets.length?st.undercover.secrets.map(s=>
      `<div class="s-item"><span class="s-when">${esc(s.date)}</span><span class="s-msg">${esc(s.text)}</span></div>`).join('')
      :`<div class="muted small">还没有密语。完成今日棋局，军师会悄悄给你下一步。</div>`;
    const chain=st.goals.map(g=>`
      <div class="bar-row"><span class="day" style="width:auto;flex:1;font-weight:600">${esc(g.title)}</span>
      <div class="bar-track" style="flex:2"><i style="width:${g.status==='done'?100:Math.round(g.stageIndex/g.stages.length*100)}%;background:${g.color}"></i></div>
      <span class="pct">${g.status==='done'?'✓':g.stages[g.stageIndex].name}</span></div>`).join('');

    view.innerHTML=`
      <div class="agent-hero">
        <div class="codename">${esc(lvl.name)}</div>
        <div class="level">等级 ${lvl.level} / 5 · 已完成目标 ${lvl.goalsDone}</div>
        <div class="next">下一阶段：<b>${esc(prog.label)}</b><br>进度 ${prog.cur}/${prog.need}（${prog.pct}%）</div>
      </div>
      <div class="card">
        <div class="card-title">🕵️ 情报碎片</div>
        <p class="small muted mt8">每清空一次今日棋局，收集一枚。集齐会解锁新阶段任务。</p>
        <div class="intel-grid mt12">${intelCells}</div>
      </div>
      <div class="card">
        <div class="card-title">🏅 已获称号</div>
        <div class="mt12">${titlesHtml}</div>
      </div>
      <div class="card">
        <div class="card-title">♟️ 任务推进链</div>
        <div class="mt12">${chain}</div>
      </div>
      <div class="card">
        <div class="card-title"><img class="title-avatar" src="assets/img/strategist-avatar.png" alt=""> 军师密语</div>
        <div class="secret-log mt12">${secrets}</div>
      </div>
    `;
  }

  /* =========================================================
     视图：棋历（日 / 周 / 月 可视化拖拽 · 计划本+GoalDay 融合）
     —— 规划层，与今日棋局(执行)/棋谱(目标)形成闭环
     ========================================================= */
  let calMode='week';
  let calCursor=S.today();
  let calWeekCursor=S.today();   // 当前「本周视图」查看的周（周一）
  let weekFocusTab='focus';      // focus | summary
  let showWeekPicker=false;      // 小周历展开状态
  let weekFocusOpen=false;       // 「本周重点/总结」默认折叠——把垂直空间还给 7 个日格子

  function mondayOf(d){
    const t=new Date(d.getTime()); t.setHours(0,0,0,0);
    const dow=(t.getDay()+6)%7; // 0=周一
    t.setDate(t.getDate()-dow);
    return t;
  }
  function addDays(d,n){ const t=new Date(d.getTime()); t.setDate(t.getDate()+n); return t; }
  function addWeeks(d,n){ return addDays(d,n*7); }
  function weekNumber(d){ return S.isoWeek(d); }
  function calSegOf(t){
    if(t.time==='上午'||t.time==='下午'||t.time==='晚上') return t.time;
    if(t.type==='evening') return '晚上';
    if(t.type==='byway'||t.type==='habit') return '下午';
    return '上午';
  }
  function calRate(dateStr){
    const arr=S.tasksOf(dateStr); if(!arr.length) return null;
    const done=arr.filter(t=>t.done).length; return Math.round(done/arr.length*100);
  }
  function calTaskCard(t, fromDate){
    const g=t.goalId?S.getGoal(t.goalId):null;
    return `<div class="cal-task ${t.done?'done':''}" data-drag data-id="${t.id}" data-date="${fromDate}" data-type="${t.type}">
      <span class="drag-h" title="拖动改期">⠿</span>
      <span class="cal-check ${t.done?'on':''}" data-check="${t.id}"></span>
      <span class="cal-tt">${esc(t.title)}</span>
      <span class="cal-meta"><i class="dot t-${t.type}"></i>${t.duration}′${g?' · '+esc(g.title):''}</span>
    </div>`;
  }
  function calDropZone(inner, cls, dateStr, seg){
    return `<div class="drop-zone ${cls||''}" data-drop data-date="${dateStr}" ${seg?`data-seg="${seg}"`:''}>${inner}</div>`;
  }

  function renderCalendar(){
    if(calMode==='week'){
      E.ensureWeekPlan(calWeekCursor);
      const b=E.fridayBoost();
      if(b.fired) toast('军师已备好「周末充电清单」，去「未排程」拖进周末吧');
    }
    const segTabs=`<div class="seg-tabs">
      <button class="seg-tab ${calMode==='day'?'on':''}" data-cal="day">今日</button>
      <button class="seg-tab ${calMode==='week'?'on':''}" data-cal="week">本周</button>
      <button class="seg-tab ${calMode==='month'?'on':''}" data-cal="month">本月</button>
    </div>`;
    let body='';
    if(calMode==='day') body=renderCalDay();
    else if(calMode==='week') body=renderCalWeek();
    else body=renderCalMonth();
    // 说明文案只在「今日」视图显示，本周视图要尽最大空间给 8 分格
    const hint = calMode==='day' ? `<p class="small muted mt8">军师已预排今日任务。点击 + 号快速添加，拖动任务可改期，改动会同步回今日棋局。</p>` : '';
    view.innerHTML=`
      <div class="card cal-head">
        <div class="cal-title">📅 棋历</div>
        ${segTabs}
      </div>
      ${hint}
      <div id="cal-body">${body}</div>
    `;
    bindCalendar();
    enableDnD(view);
  }

  function renderCalDay(){
    const d=S.fmtDate(calCursor);
    const arr=S.tasksOf(d).slice().sort((a,b)=>a.order-b.order);
    const inbox=S.unscheduled();
    const segs=['上午','下午','晚上'];
    const segHtml=segs.map(seg=>{
      const items=arr.filter(t=>calSegOf(t)===seg);
      const inner=items.length?items.map(t=>calTaskCard(t,d)).join('')
        :`<div class="zone-empty">把任务拖到这里</div>`;
      return `<div class="day-seg">
        <div class="seg-name">${seg}</div>
        ${calDropZone(inner,'seg-zone',d,seg)}
      </div>`;
    }).join('');
    const inboxInner=inbox.length?inbox.map(t=>calTaskCard(t,S.INBOX)).join(''):`<div class="zone-empty">清单池已清空</div>`;
    return `<div class="cal-day">
      <div class="cal-day-top">${d} ${S.weekdayCN[calCursor.getDay()]}${d===S.fmtDate(S.today())?' · 今天':''}</div>
      ${segHtml}
      <div class="day-seg">
        <div class="seg-name">📥 未排程清单</div>
        ${calDropZone(inboxInner,'inbox-zone',S.INBOX)}
      </div>
    </div>`;
  }

  function renderCalWeek(){
    const mon=mondayOf(calWeekCursor);
    const {year, week}=weekNumber(mon);
    const todayStr=S.fmtDate(S.today());
    const focusData=S.getWeekFocus(year, week);

    // 顶部 Wxx 标题与小周历
    const pickerRows=[];
    for(let w=-2; w<=3; w++){
      const rowMon=addWeeks(mon,w);
      const rowNum=weekNumber(rowMon);
      const days=[];
      for(let i=0;i<7;i++){
        const dd=addDays(rowMon,i);
        const ds=S.fmtDate(dd);
        const isCurWeek=ds>=S.fmtDate(rowMon) && ds<=S.fmtDate(addDays(rowMon,6));
        days.push(`<span class="mpd ${ds===todayStr?'today':''} ${isCurWeek?'inweek':''}">${dd.getDate()}</span>`);
      }
      pickerRows.push(`<div class="mp-row ${w===0?'active':''}" data-weekjump="${S.fmtDate(rowMon)}">
        <div class="mp-label">W${rowNum.week}</div>
        <div class="mp-days">${days.join('')}</div>
      </div>`);
    }

    // 本周重点/总结：默认折叠成一行，展开才写——内容密集页优先把空间还给格子
    const focusText = weekFocusTab==='focus' ? (focusData.focus||'') : (focusData.summary||'');
    const focusPreview = focusText
      ? esc(focusText.slice(0,20)) + (focusText.length>20?'…':'')
      : '<span class="wf-ph">还没写，点开补一句</span>';
    const focusBody = weekFocusTab==='focus'
      ? `<div class="wf-summary">
           <textarea class="wf-area" id="wf-focus" placeholder="本周最想完成什么？">${esc(focusData.focus)}</textarea>
           <button class="btn primary sm block mt8" id="wf-save">保存</button>
         </div>`
      : `<div class="wf-summary">
           <textarea class="wf-area" id="wf-summary" placeholder="自己写本周总结，或等周日让军师一键生成。">${esc(focusData.summary)}</textarea>
           <button class="btn ghost sm block mt8" id="wf-save-summary">保存</button>
         </div>`;

    // 7 天卡片：上 4 下 3（左侧重点面板跨两行）
    function dayCard(i){
      const dd=addDays(mon,i);
      const ds=S.fmtDate(dd);
      const arr=S.tasksOf(ds).slice().sort((a,b)=>a.order-b.order);
      const done=arr.filter(t=>t.done).length;
      const rate=arr.length?Math.round(done/arr.length*100):null;
      const isToday=ds===todayStr;
      const dowName=S.weekdayCN[dd.getDay()];
      const dowColor=['周一','周二','周三','周四','周五','周六','周日'][i];
      const inner=arr.length?arr.map(t=>calTaskCard(t,ds)).join(''):`<div class="zone-empty small">拖入任务</div>`;
      return `
        <div class="week-card ${isToday?'is-today':''}" data-drop-card data-date="${ds}" data-date-idx="${i}">
          <div class="wc-head">
            <div class="wc-dow ${dowColor}"><span>${dowName}</span></div>
            <div class="wc-date">${dd.getMonth()+1}/${dd.getDate()}</div>
            <div class="wc-count">${arr.length?`<b>${done}/${arr.length}</b>`:'0'}</div>
            <button class="wc-add" data-adddate="${ds}" title="添加任务">+</button>
          </div>
          <div class="wc-body">${calDropZone(inner,'wc-zone',ds)}</div>
          ${rate!==null?`<div class="wc-rate ${rate===100?'all':rate>0?'part':'none'}"><div style="width:${rate}%"></div></div>`:'<div class="wc-rate none"><div></div></div>'}
        </div>
      `;
    }

    return `
      <div class="cal-week-layout">
        <div class="week-topbar">
          <button class="week-title-btn" id="week-title-btn">
            <span class="week-label">W${week}, 本周</span>
            <span class="week-arrow ${showWeekPicker?'open':''}">›</span>
          </button>
          <div class="mini-week-picker ${showWeekPicker?'show':''}" id="mini-week-picker">
            <div class="mp-head">
              <span>周</span>
              <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
            </div>
            ${pickerRows.join('')}
          </div>
        </div>
        <div class="week-main">
          <div class="week-focus-panel ${weekFocusOpen?'open':''}">
            <button class="wf-collapse" id="wf-toggle" title="展开 / 收起">
              <span class="wf-icon">🎯</span>
              <span class="wf-label">${weekFocusTab==='focus'?'本周重点':'本周总结'}</span>
              <span class="wf-preview">${focusPreview}</span>
              <span class="wf-arrow ${weekFocusOpen?'open':''}">›</span>
            </button>
            ${weekFocusOpen? `
            <div class="wf-tabs">
              <button class="wf-tab ${weekFocusTab==='focus'?'on':''}" data-wtab="focus">本周重点</button>
              <button class="wf-tab ${weekFocusTab==='summary'?'on':''}" data-wtab="summary">本周总结</button>
            </div>
            <div class="wf-body fade-in">${focusBody}</div>`:''}
          </div>
          <div class="week-card-placeholder" aria-hidden="true"></div>
          ${dayCard(0)}${dayCard(1)}${dayCard(2)}${dayCard(3)}${dayCard(4)}${dayCard(5)}${dayCard(6)}
        </div>
      </div>
    `;
  }

  function weekScheduledCount(mon){ let n=0; for(let i=0;i<7;i++) n+=S.tasksOf(S.fmtDate(addDays(mon,i))).length; return n; }
  function weekDoneCount(mon){ let n=0; for(let i=0;i<7;i++) n+=S.tasksOf(S.fmtDate(addDays(mon,i))).filter(t=>t.done).length; return n; }
  function weekRate(mon){ const tot=weekScheduledCount(mon), done=weekDoneCount(mon); return tot?Math.round(done/tot*100):0; }

  function renderCalMonth(){
    const y=calCursor.getFullYear(), m=calCursor.getMonth();
    const first=new Date(y,m,1); const firstDow=first.getDay();
    const startOffset=(firstDow===0?-6:1-firstDow);
    const cells=[];
    for(let i=0;i<42;i++){
      const dd=S.shiftDay(first,startOffset+i);
      const ds=S.fmtDate(dd);
      const arr=S.tasksOf(ds);
      const rate=calRate(ds);
      const otherMonth=dd.getMonth()!==m?'other':'';
      const isToday=ds===S.fmtDate(S.today())?'is-today':'';
      cells.push(`<div class="m-cell ${otherMonth} ${isToday}" data-caljump="${ds}">
        <div class="m-num">${dd.getDate()}</div>
        ${arr.length?`<div class="m-rate ${rate===100?'all':rate>0?'part':'none'}">${rate}%</div>`:`<div class="m-dot"></div>`}
        <div class="m-cnt">${arr.length?arr.length+'项':''}</div>
      </div>`);
    }
    return `<div class="cal-month-head">
        <button class="btn ghost sm" id="m-prev">‹</button>
        <div class="m-label">${y}年${m+1}月</div>
        <button class="btn ghost sm" id="m-next">›</button>
      </div>
      <div class="m-weekrow">${['一','二','三','四','五','六','日'].map(w=>`<span>${w}</span>`).join('')}</div>
      <div class="m-grid">${cells.join('')}</div>
      <p class="small muted mt12 center">点任意日期 → 进入「今日」视图安排那一天</p>`;
  }

  function bindCalendar(){
    view.querySelectorAll('[data-cal]').forEach(b=>b.addEventListener('click',()=>{ calMode=b.dataset.cal; renderCalendar(); }));
    const prev=view.querySelector('#m-prev'), next=view.querySelector('#m-next');
    if(prev) prev.addEventListener('click',()=>{ calCursor.setMonth(calCursor.getMonth()-1); renderCalendar(); });
    if(next) next.addEventListener('click',()=>{ calCursor.setMonth(calCursor.getMonth()+1); renderCalendar(); });
    view.querySelectorAll('[data-caljump]').forEach(c=>c.addEventListener('click',()=>{
      calCursor=new Date(c.dataset.caljump+'T00:00:00'); calMode='day'; renderCalendar();
    }));
    view.querySelectorAll('[data-check]').forEach(c=>c.addEventListener('click',e=>{
      e.stopPropagation();
      const t=findTaskAny(c.dataset.check); if(!t) return;
      S.setDone(c.dataset.check, !t.done); updateTopbar(); renderCalendar();
    }));

    // 本周视图：展开/收起小周历
    const wt=view.querySelector('#week-title-btn');
    if(wt) wt.addEventListener('click',()=>{ showWeekPicker=!showWeekPicker; renderCalendar(); });
    // 选择某周
    view.querySelectorAll('[data-weekjump]').forEach(r=>r.addEventListener('click',()=>{
      calWeekCursor=new Date(r.dataset.weekjump+'T00:00:00');
      showWeekPicker=false; renderCalendar();
    }));
    // 展开 / 收起「本周重点·总结」（默认收起，需要时才占地方）
    const wft=view.querySelector('#wf-toggle');
    if(wft) wft.addEventListener('click',()=>{ weekFocusOpen=!weekFocusOpen; renderCalendar(); });
    // 本周重点 / 本周总结 Tab
    view.querySelectorAll('[data-wtab]').forEach(b=>b.addEventListener('click',()=>{
      weekFocusTab=b.dataset.wtab; weekFocusOpen=true; renderCalendar();
    }));
    // 保存本周重点
    const saveFocus=view.querySelector('#wf-save');
    if(saveFocus) saveFocus.addEventListener('click',()=>{
      const {year,week}=weekNumber(mondayOf(calWeekCursor));
      S.setWeekFocus(year, week, view.querySelector('#wf-focus').value);
      toast('🎯 本周重点已保存，军师会据此调整优先级');
    });
    // 保存本周总结
    const saveSummary=view.querySelector('#wf-save-summary');
    if(saveSummary) saveSummary.addEventListener('click',()=>{
      const {year,week}=weekNumber(mondayOf(calWeekCursor));
      S.setWeekSummary(year, week, view.querySelector('#wf-summary').value);
      toast('📒 本周总结已保存');
    });
    // 卡片上的 + 添加任务
    view.querySelectorAll('[data-adddate]').forEach(b=>b.addEventListener('click',()=>{
      const ds=b.dataset.adddate;
      prompt('添加待办', `为 ${ds} 添加一条待办：`, txt=>{
        if(txt && txt.trim()){
          const parsed=E.parseSentence(txt.trim());
          const spec=Array.isArray(parsed)?(parsed[0]||null):((parsed&&parsed.tasks)?parsed.tasks[0]:null);
          const taskSpec = spec || {title:txt.trim(), duration:15, type:'fragment', goalId:null};
          S.addTask(ds, {title:taskSpec.title, duration:taskSpec.duration, type:taskSpec.type, goalId:taskSpec.goalId, source:'manual'});
          toast('已落子'); renderCalendar(); updateTopbar();
        }
      }, {placeholder:'如：背30个单词，顺路打印资料'});
    }));
  }

  /* 跨容器拖放：按住任务卡任意位置即可拖动改期（事件委托，只绑定一次） */
  function enableDnD(root){
    if(root.dataset.dndReady==='1') return;
    root.dataset.dndReady='1';
    let dragEl=null, clone=null, activeZone=null, fromDate=null, taskId=null, taskType=null;
    root.addEventListener('pointerdown',e=>{
      const card=e.target.closest('[data-drag]');
      if(!card) return;
      // 点复选框/按钮时交给 click，不启动拖动
      if(e.target.closest('.cal-check') || e.target.closest('button') || e.target.closest('a')) return;
      e.preventDefault();
      dragEl=card; taskId=card.dataset.id; fromDate=card.dataset.date; taskType=card.dataset.type;
      const r=card.getBoundingClientRect();
      clone=card.cloneNode(true);
      clone.className='cal-task drag-clone';
      clone.style.width=r.width+'px'; clone.style.left=r.left+'px'; clone.style.top=r.top+'px';
      document.body.appendChild(clone);
      card.classList.add('dragging');
    });
    root.addEventListener('pointermove',e=>{
      if(!dragEl) return;
      clone.style.left=(e.clientX-22)+'px'; clone.style.top=(e.clientY-18)+'px';
      const under=document.elementFromPoint(e.clientX,e.clientY);
      // 优先命中卡片内部的 drop-zone，其次命中整张卡片本身
      let zone=under&&under.closest('[data-drop]');
      if(!zone) zone=under&&under.closest('[data-drop-card]');
      if(zone!==activeZone){
        if(activeZone) activeZone.classList.remove('drop-active');
        activeZone=zone; if(activeZone) activeZone.classList.add('drop-active');
      }
    });
    function end(){
      if(!dragEl) return;
      if(activeZone){
        // 落到卡片本身时，实际目标日期取卡片 data-date
        let toDate=activeZone.dataset.date;
        const seg=activeZone.dataset.seg;
        const res=S.setTaskDate(taskId, toDate);
        if(seg) S.updateTask(taskId,{time:seg});
        E.recordDrag(fromDate, toDate, taskType);
        if(res && fromDate!==toDate) S.pushLog('军师',`你调整了布局：${res.task.title} → ${toDate==='INBOX'?'未排程':toDate}。计划-执行-复盘，闭环在跑。`,'move');
      }
      if(activeZone) activeZone.classList.remove('drop-active');
      dragEl.classList.remove('dragging');
      if(clone) clone.remove();
      dragEl=null; activeZone=null; clone=null;
      renderCalendar(); updateTopbar();
    }
    root.addEventListener('pointerup',end);
    root.addEventListener('pointercancel',end);
  }

  /* =========================================================
     视图：周报（战略报告）
     ========================================================= */
  function renderReport(){
    const r=E.weeklyReport();
    const a=r.analysis||{};
    const goalRows=r.goals.map(g=>`
      <div class="bar-row"><span class="day" style="width:auto;flex:1;font-weight:600">${esc(g.title)}</span>
        <div class="bar-track" style="flex:2"><i style="width:${g.prog}%;background:${g.status==='done'?'var(--mint)':'var(--purple)'}"></i></div>
        <span class="pct">${g.status==='done'?'✓':esc(g.stage)}</span></div>`).join('');

    // 军师预测：明日完成率 / 本周预计 / 各目标达成日期（都是离线推算出来的数）
    const f = a.forecast;
    const forecastHTML = f? `
      <div class="card fc-card">
        <div class="card-title">🔭 军师预测</div>
        <div class="stat-grid mt12">
          <div class="stat-card blue"><div class="num">${Math.round(f.tomorrow.rate*100)}%</div><div class="lab">明日完成率</div></div>
          <div class="stat-card purple"><div class="num" style="font-size:19px">${f.week.predWeekTotal}<i style="font-size:12px">/${f.week.totalSum}</i></div><div class="lab">本周预计落子</div></div>
          <div class="stat-card mint"><div class="num">${Math.round(f.week.predWeekRate*100)}%</div><div class="lab">本周预计完成率</div></div>
          <div class="stat-card pink"><div class="num" style="font-size:15px;line-height:1.5;margin-top:4px">${f.streak&&f.streak.hold?'已保住':(f.streak?Math.round(f.streak.prob*100)+'%':'—')}</div><div class="lab">今日连续概率</div></div>
        </div>
        <p class="small muted mt8">${esc(f.week.verdict)}</p>
        ${(f.tomorrow.factors&&f.tomorrow.factors.length)? `<div class="fc-factors mt8">${f.tomorrow.factors.map(x=>`<span class="fc-f">${esc(x.k)} ${x.v>1?'+':''}${Math.round((x.v-1)*100)}% · ${esc(x.txt)}</span>`).join('')}</div>`:''}
        ${(f.goals&&f.goals.length)? `<div class="mt12"><div class="report-lab">目标达成预测</div>${f.goals.map(g=>`
          <div class="fc-goal">
            <div class="fg-head"><b>${esc(g.goal.title)}</b><span class="fg-v ${g.verdict}">${esc(g.verdictCN)}</span></div>
            <div class="fg-line">进度 ${g.progress}% · 时间已过 ${g.timePast}% · 当前 ${g.speed} 项/天</div>
            <div class="fg-line">预计 ${esc(g.arrive)} 完成${g.late>0?`（晚 ${g.late} 天）`:''} · 距目标 ${g.daysToDeadline} 天</div>
            <div class="fg-tip">${esc(g.tip)}</div>
          </div>`).join('')}</div>`:''}
      </div>` : '';

    view.innerHTML=`
      <div class="card">
        <div class="card-title"><img class="title-avatar" src="assets/img/strategist-avatar.png" alt=""> 执棋者·周报</div>
        <div class="report-sub">第 ${r.week} 周 · 完成率 ${r.rate}%</div>
        <div class="stat-grid mt12">
          <div class="stat-card purple"><div class="num">${r.done}/${r.total}</div><div class="lab">本周落子</div></div>
          <div class="stat-card pink"><div class="num">${r.rate}%</div><div class="lab">完成率</div></div>
          <div class="stat-card mint"><div class="num">${r.streak}</div><div class="lab">连续天数</div></div>
          <div class="stat-card blue"><div class="num">${r.notes}</div><div class="lab">随记条数</div></div>
        </div>
      </div>
      <div class="card chart-card"><div class="card-title">目标进度</div>${goalRows}</div>
      ${forecastHTML}
      <div class="card hint-card">
        <div class="card-title">军师点评</div>
        <p class="small muted mt8">${esc(a.biggest||'')}</p>
        <p class="small muted mt8">${esc(a.weakest||'')}</p>
        ${a.good&&a.good.length? `<div class="mt12"><div class="report-lab good">做得好</div>${a.good.map(x=>`<p class="small mt8">· ${esc(x)}</p>`).join('')}</div>`:''}
        ${a.bad&&a.bad.length? `<div class="mt12"><div class="report-lab bad">要注意</div>${a.bad.map(x=>`<p class="small mt8">· ${esc(x)}</p>`).join('')}</div>`:''}
      </div>
      <div class="card hint-card">
        <div class="card-title">下周布局</div>
        ${a.layout&&a.layout.alloc&&a.layout.alloc.length? `
          <div class="mt8">${a.layout.alloc.map(x=>`
            <div class="nw-alloc">
              <div class="nwa-row"><span class="nwa-name">${esc(x.title)}</span>
                <span class="nwa-bar"><i style="width:${x.share}%"></i></span>
                <span class="nwa-pct">${x.share}%</span></div>
              <div class="nwa-why">${esc(x.reason)}</div>
            </div>`).join('')}</div>`:''}
        ${a.layout&&a.layout.days? `<div class="mt12"><div class="report-lab">每日节奏</div>${a.layout.days.map(d=>`<p class="small muted mt8">· ${esc(d.note)}</p>`).join('')}</div>`:''}
        ${a.next&&a.next.length? `<div class="mt12"><div class="report-lab">策略</div>${a.next.map(x=>`<p class="small muted mt8">· ${esc(x)}</p>`).join('')}</div>`:''}
        ${(!a.layout&&!(a.next&&a.next.length))?'<p class="small muted mt8">主线按当前阶段继续推进；薄弱项我会加大排程比例。你只管照做，明天打开棋局看新指令。</p>':''}
      </div>`;
  }

  /* =========================================================
     视图：十年棋局（成长长图）
     ========================================================= */
  function renderTimeline(){
    const m=E.tenYearMap();
    const yearsHtml=m.years.map(y=>{
      const nodes=y.goals.length
        ? y.goals.map(g=>`<div class="ty-node on"><span class="ty-dot"></span><span class="ty-label">${esc(g.title)}</span><span class="ty-date">${esc(g.date)}</span></div>`).join('')
        : `<div class="ty-node ghost"><span class="ty-dot"></span><span class="ty-label muted">待落子</span></div>`;
      return `<div class="ty-year">
        <div class="ty-yr">${y.year}</div>
        <div class="ty-nodes">${nodes}</div>
      </div>`;
    }).join('');
    const visionHtml=m.vision.map(v=>`<div class="ty-vision">🏁 ${esc(v)}</div>`).join('');
    view.innerHTML=`
      <div class="card">
        <div class="card-title">🗺️ 十年棋局</div>
        <p class="small muted mt8">每完成一个目标，就在这里落下一子。看着自己走过的路，也看清离「大人物」还有多远。</p>
      </div>
      <div class="card ty-axis">${yearsHtml}</div>
      <div class="card ty-vision-card">${visionHtml}<div class="muted small mt8">十年后你会成为大人物。但那个大人物的起点，就是今天这一颗小小的棋子。</div></div>`;
  }

  /* =========================================================
     视图：小贴士（大人物习惯 · 知识库）
     ========================================================= */
  function renderTips(){
    const list=E.allBigshots();
    const cur=E.dailyTip();
    const items=list.map(b=>`
      <div class="card tip-item ${b.who===cur.who?'on':''}">
        <div class="tip-who">${esc(b.who)} <span class="tip-tag">${esc(b.cat)}</span></div>
        <div class="tip-role">${esc(b.tag)}</div>
        <div class="tip-habit">${esc(b.habit)}</div>
        <div class="tip-txt">军师：${esc(b.tip)}</div>
      </div>`).join('');
    view.innerHTML=`
      <div class="card reco-card">
        <div class="card-title">💡 军师锦囊</div>
        <p class="small muted mt8">来自商业大佬、投资家、作家、思想家与书中人物、科学家、运动员、自律明星。今日轮到 <b>${esc(cur.who)}</b>；全库共 <b>${list.length}</b> 条，每天换一位，慢慢收集属于你的习惯。</p>
      </div>
      <div class="grid g2 g3 section-gap">${items}</div>`;
  }

  /* =========================================================
     主渲染分发
     ========================================================= */
  function render(v){
    current=v||current;
    if(current==='today') renderToday();
    else if(current==='manual') renderManual();
    else if(current==='notes') renderNotes();
    else if(current==='power') renderPower();
    else if(current==='undercover') renderUndercover();
    else if(current==='calendar') renderCalendar();
    else if(current==='report') renderReport();
    else if(current==='timeline') renderTimeline();
    else if(current==='tips') renderTips();
    // 高亮导航：一级(核心循环)视图直接高亮；二级/三级视图回落到「更多」入口
    const primarySet={'today':1,'calendar':1,'manual':1,'notes':1};
    const onMore = !primarySet[current];
    document.querySelectorAll('.tab').forEach(t=>{
      if(t.dataset.view==='more') t.classList.toggle('active', onMore);
      else t.classList.toggle('active', t.dataset.view===current);
    });
    document.querySelectorAll('.side-item').forEach(t=>t.classList.toggle('active',t.dataset.view===current));
    document.querySelectorAll('.side-sub').forEach(t=>t.classList.toggle('active',t.dataset.view===current));
    view.scrollTop=0;
    if(current==='today') updateTopbar();
  }
  /* 内容密集型页面：收起顶栏品牌区，把垂直空间还给内容，也和其它页面形成区分 */
  const DENSE_VIEWS = ['calendar','report','timeline','tips','power'];

  function navigate(v){
    render(v);
    try{ document.body.classList.toggle('dense-view', DENSE_VIEWS.indexOf(v)>=0); }catch(e){}
    try{ window.ZQ.ui.current=v; }catch(e){}
    localStorage.setItem('zhiqi_lastview',v);
  }

  function updateTopbar(){
    const u=S.load().undercover;
    $('#streak-num').textContent=u.streak;
    const d=S.today(); $('#topbar-date').textContent=`${d.getMonth()+1}月${d.getDate()}日 ${S.weekdayCN[d.getDay()]}`;
  }

  /* =========================================================
     拖拽排序（指针事件，鼠标+触屏通用）
     ========================================================= */
  function makeSortable(container, handleSel, onEnd){
    if(!container) return;
    let dragEl=null, placeholder=null, offsetY=0;
    container.addEventListener('pointerdown',e=>{
      const handle=e.target.closest(handleSel); if(!handle) return;
      const item=handle.closest('[data-sortable]'); if(!item) return;
      e.preventDefault();
      dragEl=item;
      const rect=dragEl.getBoundingClientRect();
      offsetY=e.clientY-rect.top;
      dragEl.classList.add('dragging');
      dragEl.style.width=rect.width+'px';
      dragEl.style.position='fixed'; dragEl.style.left=rect.left+'px';
      dragEl.style.top=rect.top+'px'; dragEl.style.zIndex=1000;
      placeholder=document.createElement('div');
      placeholder.style.height=rect.height+'px';
      placeholder.style.border='2px dashed var(--purple)';
      placeholder.style.borderRadius='14px';
      placeholder.style.marginBottom='9px';
      placeholder.style.background='rgba(197,180,227,.12)';
      dragEl.parentNode.insertBefore(placeholder, dragEl.nextSibling);
    });
    container.addEventListener('pointermove',e=>{
      if(!dragEl) return;
      dragEl.style.top=(e.clientY-offsetY)+'px';
      dragEl.style.visibility='hidden';
      const under=document.elementFromPoint(e.clientX,e.clientY);
      dragEl.style.visibility='';
      const over=under&&under.closest('[data-sortable]');
      if(over && over!==dragEl && over!==placeholder){
        const r=over.getBoundingClientRect();
        const before=e.clientY < r.top + r.height/2;
        if(before) placeholder.parentNode.insertBefore(placeholder, over);
        else placeholder.parentNode.insertBefore(placeholder, over.nextSibling);
      }
    });
    function end(){
      if(!dragEl) return;
      placeholder.parentNode.insertBefore(dragEl, placeholder);
      placeholder.remove();
      dragEl.classList.remove('dragging');
      dragEl.style.position=''; dragEl.style.left=''; dragEl.style.top='';
      dragEl.style.zIndex=''; dragEl.style.width='';
      const ids=[...container.querySelectorAll('[data-sortable]')].map(el=>el.dataset.id);
      dragEl=null; placeholder=null;
      onEnd&&onEnd(ids);
    }
    container.addEventListener('pointerup',end);
    container.addEventListener('pointercancel',end);
  }

  window.ZQ.ui = { render, navigate, toast, modal, closeModal, closeStrategist, confirm, prompt, updateTopbar };
})();
