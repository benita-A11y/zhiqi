/* =========================================================
   执棋 · UI 渲染与交互 (ui.js)
   ========================================================= */
(function(){
  const S = window.ZQ.store;
  const E = window.ZQ.engine;
  const U = window.ZQ.undercover;

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

    let html = `
      <div class="card strategist-cmd fade-in">
        <div class="who"><img class="who-avatar" src="assets/img/strategist-avatar.png" alt=""> ${esc(cmd.who)}</div>
        <div class="msg">${esc(cmd.msg)}</div>
      </div>

      <div class="quick-add">
        <input id="quick-input" placeholder="一句话生成待办，如：明早去图书馆背30个单词顺便打印资料" />
        <button class="btn primary" id="quick-add-btn">落子</button>
      </div>

      <div class="divider"></div>
      <div class="row between" style="margin:2px 2px 4px">
        <div class="card-title">♟️ 今日棋局</div>
        <div class="card-sub">${tasks.length} 项 · 拖动手柄可排序</div>
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
        ${nudge?`<div class="intel">${esc(nudge)}</div>`:''}
      </div>`;
    }

    view.innerHTML = html;
    bindToday(tasks);
  }

  function renderTaskList(tasks){
    if(tasks.length===0) return `<div class="empty"><div class="em">♟️</div><p>今日棋局空空如也。<br>说一句话，或点开军师头像让军师派发任务。</p></div>`;
    let html=''; let lastType=null;
    tasks.forEach(t=>{
      if(t.type!==lastType){
        const cnt=tasks.filter(x=>x.type===t.type).length;
        html += `<div class="group-label"><span class="bar"></span>${TYPE_LABEL[t.type]}<span class="cnt">${cnt}项</span></div>`;
        lastType=t.type;
      }
      const g = t.goalId?S.getGoal(t.goalId):null;
      html += `
      <div class="task ${t.done?'done':''}" data-sortable data-id="${t.id}">
        <div class="task-handle">⠿</div>
        <div class="check ${t.done?'on':''}" data-check="${t.id}"></div>
        <div class="task-main">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            <span class="mini">⏱ ${t.duration}分钟</span>
            ${t.location?`<span class="mini">📍 ${esc(t.location)}</span>`:''}
            ${typeTag(t.type)}
            ${g?goalTag(t.goalId):''}
            ${t.time?`<span class="mini">🕒 ${esc(t.time)}</span>`:''}
          </div>
        </div>
        <div class="task-actions">
          <button data-edit="${t.id}" title="编辑">✎</button>
          <button data-del="${t.id}" title="删除">🗑</button>
        </div>
      </div>`;
    });
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
          <button class="btn primary sm" data-addreco="${esc(r.title)}|${esc(r.cat)}|${esc(r.weekly)}">加入棋谱</button>
        </div>
      </div>`).join('');

    view.innerHTML = `
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
      if(confirm('确认这个目标已经完成？军师会为你升级代号并推荐下一局。')){
        U.completeGoal(x.dataset.complete); toast('🏆 目标达成，代号升级！'); renderManual(); updateTopbar();
      }
    }));
    view.querySelectorAll('[data-delgoal]').forEach(x=>x.addEventListener('click',()=>{
      if(confirm('删除这个目标吗？\n它名下的任务也会一并移除。\n——军师会记得你走过的每一局，但此目标将不再出现在棋谱里。')){
        S.deleteGoal(x.dataset.delgoal); toast('目标已移除。想再开局的时候，随时立一个新目标。'); renderManual(); updateTopbar();
      }
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
    toast(`已加入棋谱：${title}`); renderManual(); updateTopbar();
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
  function renderNotes(){
    const st=S.load();
    const notes=st.notes.slice(0,30);
    const diaries=st.diaries.slice(0,12);
    const notesHtml=notes.length?notes.map(n=>{
      const emoCls=n.emotion==='good'?'good':n.emotion==='bad'?'bad':'flat';
      const emoTxt=n.emotion==='good'?'情绪正向':n.emotion==='bad'?'有些低落':'平静';
      const refine=n.refined?`<div class="refine-box">
        ${n.points&&n.points.length?`重点：<b>${esc(n.points.join('、'))}</b><br>`:''}
        军师建议：<b>${esc(E.refineNote(n).suggestion)}</b>
        ${n.taskId?'<br>已关联今日任务':''}</div>`:'';
      return `<div class="card note-card"><div class="note-text">${esc(n.text)}</div>
        <div class="note-meta"><span class="emotion ${emoCls}">${emoTxt}</span><span class="tag">${esc(n.date)}</span></div>${refine}</div>`;
    }).join(''):`<div class="empty"><div class="em">📝</div><p>还没有随记。<br>脑子里闪过的念头，先记下来，军师帮你整理成日记。</p></div>`;

    const diaHtml=diaries.length?diaries.map(d=>`
      <div class="card diary">
        <div class="d-date">📅 ${esc(d.date)}</div>
        <div class="d-line" style="white-space:pre-wrap">${esc(d.content)}</div>
      </div>`).join(''):`<div class="empty"><div class="em">📔</div><p>还没有日记。<br>先记几笔随记，再一键整理成日记。</p></div>`;

    view.innerHTML=`
      <div class="card">
        <div class="card-title">📝 随记</div>
        <p class="small muted mt8">不用写得很完善，先记下片段，军师稍后帮你提炼重点、整理结构。</p>
        <div class="note-input mt12">
          <textarea id="note-input" placeholder="今天听力还是跟不上连读，烦……"></textarea>
          <button class="btn primary block" id="note-add">记下来</button>
        </div>
      </div>
      <div class="section-gap">${notesHtml}</div>
      <button class="btn mint block mb0 mt12" id="review-btn">🌙 一键整理今日随记为日记</button>
      <div class="card-title mt16" style="font-size:15px">📔 我的日记</div>
      <div class="section-gap">${diaHtml}</div>
    `;
    bindNotes();
  }
  function bindNotes(){
    $('#note-add').addEventListener('click',()=>{
      const v=$('#note-input').value.trim(); if(!v){ toast('写点什么'); return; }
      const note=S.addNote({text:v}); const r=E.refineNote(note);
      S.updateNote(note.id,{emotion:r.emotion,points:r.points,taskId:r.taskId,refined:true});
      const er=E.emotionResponse(note); if(er) S.pushLog('军师', er, 'comfort');
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
      <div class="card"><div class="card-title">📊 棋力</div>${stat}</div>
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
      if(b.fired) toast('🎖️ 军师已备好「周末充电清单」，去「未排程」拖进周末吧');
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

    // 左侧本周重点/总结：参考图没有统计块，只保留 Tab + 输入 + 保存，把空间还给格子
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
          <div class="week-focus-panel">
            <div class="wf-tabs">
              <button class="wf-tab ${weekFocusTab==='focus'?'on':''}" data-wtab="focus">本周重点</button>
              <button class="wf-tab ${weekFocusTab==='summary'?'on':''}" data-wtab="summary">本周总结</button>
            </div>
            <div class="wf-body fade-in">${focusBody}</div>
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
    // 本周重点 / 本周总结 Tab
    view.querySelectorAll('[data-wtab]').forEach(b=>b.addEventListener('click',()=>{
      weekFocusTab=b.dataset.wtab; renderCalendar();
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
      const txt=prompt(`为 ${ds} 添加一条待办：`);
      if(txt && txt.trim()){
        const parsed=E.parseSentence(txt.trim());
        const spec=Array.isArray(parsed)?(parsed[0]||null):((parsed&&parsed.tasks)?parsed.tasks[0]:null);
        const taskSpec = spec || {title:txt.trim(), duration:15, type:'fragment', goalId:null};
        S.addTask(ds, {title:taskSpec.title, duration:taskSpec.duration, type:taskSpec.type, goalId:taskSpec.goalId, source:'manual'});
        toast('已落子'); renderCalendar(); updateTopbar();
      }
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
    // 高亮导航：一级视图直接高亮；二级/三级视图回落到「更多」入口
    const primarySet={'today':1,'manual':1};
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
  function navigate(v){
    render(v);
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

  window.ZQ.ui = { render, navigate, toast, modal, closeModal, closeStrategist, updateTopbar };
})();
