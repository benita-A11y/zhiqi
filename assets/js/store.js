/* ============================================================
   执棋 · 数据层 (store.js)
   纯本地存储，无网络依赖。飞行模式 / 离线均可用。
   所有"越用越懂你"的学习结果都落在这里。
   ============================================================ */
(function(){
  const KEY = 'zhiqi_state_v1';

  /* ---------- 工具 ---------- */
  const INBOX = 'INBOX';   // 未排程清单池（计划本/GoalDay 的"待安排"区）
  const uid = (p='t') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const pad = n => (n<10?'0':'')+n;
  const fmtDate = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const today = () => { const d=new Date(); d.setHours(0,0,0,0); return d; };
  const shiftDay = (base,n) => { const d=new Date(base); d.setDate(d.getDate()+n); d.setHours(0,0,0,0); return d; };
  const weekdayCN = ['周日','周一','周二','周三','周四','周五','周六'];
  const weekdayShort = ['日','一','二','三','四','五','六'];
  // 学期/周次计算（自目标创建起）
  const weekOf = (createdStr) => {
    const c = new Date(createdStr+'T00:00:00'); const t = today();
    const diff = Math.floor((t - c)/86400000);
    return Math.max(1, Math.floor(diff/7)+1);
  };

  /* ---------- 默认画像（你的真实情况） ---------- */
  const DEFAULT_PROFILE = {
    name:'',
    sign:'天秤座',
    mbti:'ISFJ',
    age:22,
    height:168,
    weight:53,
    targetWeight:44,      // 88斤
    lowestWeight:46,      // 92斤
    situation:'26年专转本上岸，等待开学的大学生',
    longTerm:['考公','考编','进国家单位','赚大钱'],
    traits:['天秤座·犹豫需他人决断','ISFJ·负责·需外部认可','事情乱·忘下一步','目标大·难落实','碎片时间多'],
    onboarded:true,
    dragLog:[]          // 拖拽行为学习：[ {from,to,type,ts} ]，军师据此"越用越懂你"
  };

  /* ---------- 目标阶段模板（用于拆解展示 + 周计划生成） ---------- */
  // 每个 goal 存 type，周计划由 engine 动态生成，保证可推进
  const GOAL_SEED = [
    {
      id:'g_cet6', title:'英语六级', category:'考试提分', type:'cet6', color:'#C5B4E3',
      current:'369分（未过线）', target:'≥425分', dailyTime:60, weeklyDays:5,
      resources:'单词APP、历年真题、精听材料',
      stages:[
        {name:'基础修复',weeks:'第1-2周',core:'补词汇 + 听力连读'},
        {name:'题型突破',weeks:'第3-6周',core:'阅读 + 翻译 + 写作'},
        {name:'套卷实战',weeks:'第7-10周',core:'限时真题 + 错题'},
        {name:'冲刺调整',weeks:'第11-12周',core:'错题重做 + 模板'}
      ]
    },
    {
      id:'g_computer', title:'计算机二级', category:'证书考试', type:'computer', color:'#B4D4E3',
      current:'零基础备考', target:'通过（MS/语言任选）', dailyTime:45, weeklyDays:4,
      resources:'题库APP、操作题视频',
      stages:[
        {name:'知识筑基',weeks:'第1-2周',core:'选择题知识点 + 界面熟悉'},
        {name:'操作攻坚',weeks:'第3-5周',core:'Word/Excel/PPT 操作题'},
        {name:'真题演练',weeks:'第6-8周',core:'整套真题限时'},
        {name:'冲刺提速',weeks:'第9-10周',core:'错题 + 提速'}
      ]
    },
    {
      id:'g_weight', title:'减重塑形', category:'体态健康', type:'weight', color:'#E3B4C5',
      current:'53kg / 168cm', target:'44kg（88斤）', dailyTime:40, weeklyDays:6,
      resources:'体重秤、散步路线、饮食记录',
      stages:[
        {name:'启动期',weeks:'第1-3周',core:'饮食记录 + 每日散步'},
        {name:'强化期',weeks:'第4-8周',core:'控制热量 + 有氧'},
        {name:'塑形期',weeks:'第9周+',core:'体态 + 线条'}
      ]
    },
    {
      id:'g_civil', title:'考公 / 考编', category:'长期布局', type:'civil', color:'#B4E3D4',
      current:'信息收集阶段', target:'上岸国家单位', dailyTime:30, weeklyDays:3,
      resources:'岗位表、经验帖、时政',
      stages:[
        {name:'信息布局',weeks:'长期',core:'岗位调研 + 资料收集'},
        {name:'基础铺垫',weeks:'长期',core:'行测常识 + 申论卷面'},
        {name:'系统强化',weeks:'考前',core:'模块刷题'},
        {name:'冲刺实战',weeks:'考前',core:'套卷 + 模考'}
      ]
    }
  ];

  /* ---------- 卧底初始态 ---------- */
  const DEFAULT_UNDERCOVER = {
    codeName:'执棋者·新兵', level:0,
    intelFragments:0, intelMax:24,
    streak:0, lastCompletedDate:null,
    titles:['执棋者·新兵'],
    unlockedStages:[],
    secrets:[],
    lostDays:0
  };

  function buildSeed(){
    const now = fmtDate(today());
    const goals = GOAL_SEED.map(g=>({
      ...g, stageIndex:0, status:'active', createdAt:now, progress:0,
      totalTasksDone:0, weeklyTasksDone:0
    }));
    return {
      version:1,
      profile:JSON.parse(JSON.stringify(DEFAULT_PROFILE)),
      goals,
      tasks:{},          // { 'YYYY-MM-DD': [task,...] }
      notes:[],          // {id,date,text,emotion,points,taskId,refined}
      diaries:[],        // {id,date,content}
      undercover:JSON.parse(JSON.stringify(DEFAULT_UNDERCOVER)),
      log:[],            // 军师消息流 {id,date,from,text,kind}
      meta:{ createdAt:now, lastOpen:now }
    };
  }

  /* ---------- 读写 ---------- */
  let _state = null;
  function load(){
    if(_state) return _state;
    try{
      const raw = localStorage.getItem(KEY);
      if(raw){ _state = JSON.parse(raw); }
    }catch(e){ console.warn('读取失败',e); }
    if(!_state || !_state.goals){ _state = buildSeed(); save(); }
    return _state;
  }
  function save(){
    try{ localStorage.setItem(KEY, JSON.stringify(_state)); }
    catch(e){ console.warn('保存失败（可能隐私模式）',e); }
  }
  function reset(){
    _state = buildSeed(); save(); return _state;
  }
  function exportJSON(){
    return JSON.stringify(_state,null,2);
  }
  function importJSON(str){
    const obj = JSON.parse(str);
    if(!obj.goals) throw new Error('数据格式不正确');
    _state = obj; save(); return _state;
  }

  /* ---------- 任务 ---------- */
  function tasksOf(dateStr){ return (_state.tasks[dateStr]||[]); }
  function ensureDate(dateStr){ if(!_state.tasks[dateStr]) _state.tasks[dateStr]=[]; return _state.tasks[dateStr]; }
  function addTask(dateStr, t){
    const arr = ensureDate(dateStr);
    const task = Object.assign({
      id:uid('t'), date:dateStr, done:false, order:arr.length,
      type:'fragment', duration:15, goalId:null, location:'', time:'', source:'manual', note:''
    }, t);
    arr.push(task); save(); return task;
  }
  function updateTask(id, patch){
    for(const d in _state.tasks){
      const i = _state.tasks[d].findIndex(t=>t.id===id);
      if(i>=0){ Object.assign(_state.tasks[d][i], patch); save(); return _state.tasks[d][i]; }
    }
    return null;
  }
  function deleteTask(id){
    for(const d in _state.tasks){
      const i = _state.tasks[d].findIndex(t=>t.id===id);
      if(i>=0){ _state.tasks[d].splice(i,1); save(); return true; }
    }
    return false;
  }
  function reorder(dateStr, orderedIds){
    const arr = _state.tasks[dateStr]; if(!arr) return;
    orderedIds.forEach((id,idx)=>{ const t=arr.find(x=>x.id===id); if(t) t.order=idx; });
    arr.sort((a,b)=>a.order-b.order); save();
  }
  /* 跨日重排（拖拽改期）：把任务从原日期数组移到新日期数组末尾 */
  function setTaskDate(id, newDate){
    let task=null, oldDate=null;
    for(const d in _state.tasks){
      const i = _state.tasks[d].findIndex(t=>t.id===id);
      if(i>=0){ task=_state.tasks[d][i]; oldDate=d; _state.tasks[d].splice(i,1); break; }
    }
    if(!task) return null;
    task.date = newDate;
    const arr = ensureDate(newDate);
    task.order = arr.length;
    arr.push(task); save();
    return { task, oldDate };
  }
  function unscheduled(){ return tasksOf(INBOX); }
  function pushDragLog(entry){
    const p = _state.profile; p.dragLog = p.dragLog||[];
    p.dragLog.push(entry);
    if(p.dragLog.length>120) p.dragLog.shift();
    save();
  }
  function dragOutCount(dateStr){
    const p=_state.profile; if(!p.dragLog) return 0;
    return p.dragLog.filter(x=>x.from===dateStr).length;
  }
  function dragInCount(dateStr){
    const p=_state.profile; if(!p.dragLog) return 0;
    return p.dragLog.filter(x=>x.to===dateStr).length;
  }
  /* 周重点 / 本周总结（按 ISO 周 key：2026-W35） */
  function weekKey(y,w){ return `${y}-W${String(w).padStart(2,'0')}`; }
  function isoWeek(d){
    const t=new Date(d.getTime()); t.setHours(0,0,0,0);
    const thu = new Date(t.setDate(t.getDate()+3-((t.getDay()+6)%7)));
    const y=thu.getFullYear();
    const w1=new Date(y,0,4); w1.setDate(w1.getDate()+3-((w1.getDay()+6)%7));
    const n=1+Math.round(((thu-w1)/86400000)/7);
    return {year:y, week:n};
  }
  function getWeekFocus(y,w){
    if(!_state.weekFocus) _state.weekFocus={};
    return _state.weekFocus[weekKey(y,w)]||{focus:'', summary:'', updatedAt:null};
  }
  function setWeekFocus(y,w,text){
    if(!_state.weekFocus) _state.weekFocus={};
    const k=weekKey(y,w);
    if(!_state.weekFocus[k]) _state.weekFocus[k]={summary:''};
    _state.weekFocus[k].focus=text;
    _state.weekFocus[k].updatedAt=Date.now();
    save();
  }
  function setWeekSummary(y,w,text){
    if(!_state.weekFocus) _state.weekFocus={};
    const k=weekKey(y,w);
    if(!_state.weekFocus[k]) _state.weekFocus[k]={focus:''};
    _state.weekFocus[k].summary=text;
    _state.weekFocus[k].updatedAt=Date.now();
    save();
  }
  function setDone(id, done){
    const t = updateTask(id,{done});
    if(t){ afterTaskToggled(t, done); }
    return t;
  }

  /* 任务勾选后的联动（连续天数 / 情报 / 卧底）由 undercover 模块处理，这里只做数据调用占位 */
  let _afterToggle = null;
  function onTaskToggled(fn){ _afterToggle = fn; }
  function afterTaskToggled(t, done){ if(_afterToggle) _afterToggle(t, done); }

  /* ---------- 目标 ---------- */
  function addGoal(g){
    const now = fmtDate(today());
    const goal = Object.assign({
      id:uid('g'), stageIndex:0, status:'active', createdAt:now, progress:0,
      totalTasksDone:0, weeklyTasksDone:0, stages:[], color:'#C5B4E3', type:'generic'
    }, g);
    _state.goals.push(goal); save(); return goal;
  }
  function getGoal(id){ return _state.goals.find(g=>g.id===id)||null; }
  function updateGoal(id,patch){ const g=getGoal(id); if(g){Object.assign(g,patch);save();} return g; }
  function advanceStage(id){
    const g=getGoal(id); if(!g) return null;
    if(g.stageIndex < g.stages.length-1){ g.stageIndex++; save(); return g; }
    return g;
  }
  // 删除目标：连同它名下的派生任务一并移除，避免出现孤儿任务
  function deleteGoal(id){
    _state.goals = _state.goals.filter(g=>g.id!==id);
    if(_state.tasks) _state.tasks = _state.tasks.filter(t=>t.goalId!==id);
    save();
  }

  /* ---------- 随记 / 日记 ---------- */
  function addNote(n){
    const note = Object.assign({ id:uid('n'), date:fmtDate(today()), emotion:'flat', points:[], taskId:null, refined:false }, n);
    _state.notes.unshift(note); save(); return note;
  }
  function updateNote(id,patch){ const n=_state.notes.find(x=>x.id===id); if(n){Object.assign(n,patch);save();} return n; }
  function addDiary(d){
    const dia = Object.assign({ id:uid('d'), date:fmtDate(today()), content:'' }, d);
    _state.diaries.unshift(dia); save(); return dia;
  }

  /* ---------- 军师消息流 ---------- */
  function pushLog(from,text,kind){
    const item = { id:uid('l'), date:fmtDate(today()), from, text, kind:kind||'info' };
    _state.log.unshift(item);
    if(_state.log.length>200) _state.log.length=200;
    save(); return item;
  }

  window.ZQ = window.ZQ || {};
  window.ZQ.store = {
    load, save, reset, exportJSON, importJSON,
    uid, fmtDate, today, shiftDay, weekdayCN, weekdayShort, weekOf, INBOX, isoWeek, weekKey,
    tasksOf, ensureDate, addTask, updateTask, deleteTask, reorder, setDone, onTaskToggled,
    setTaskDate, unscheduled, pushDragLog, dragOutCount, dragInCount, getWeekFocus, setWeekFocus, setWeekSummary,
    addGoal, getGoal, updateGoal, advanceStage, deleteGoal,
    addNote, updateNote, addDiary, pushLog,
    KEY
  };
})();
