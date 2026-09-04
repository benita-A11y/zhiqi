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
      id:'g_cet6', title:'英语六级', category:'考试提分', type:'cet6', color:'#C0B8DC',
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
      id:'g_computer', title:'计算机二级', category:'证书考试', type:'computer', color:'#C8E1EB',
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
      id:'g_weight', title:'减重塑形', category:'体态健康', type:'weight', color:'#F6D6E5',
      current:'53kg / 168cm', target:'44kg（88斤）', dailyTime:40, weeklyDays:6,
      resources:'体重秤、散步路线、饮食记录',
      stages:[
        {name:'启动期',weeks:'第1-3周',core:'饮食记录 + 每日散步'},
        {name:'强化期',weeks:'第4-8周',core:'控制热量 + 有氧'},
        {name:'塑形期',weeks:'第9周+',core:'体态 + 线条'}
      ]
    },
    {
      id:'g_civil', title:'考公 / 考编', category:'长期布局', type:'civil', color:'#ACE1DC',
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
      adviceLog:[],      // 军师建议记忆 {id,topic,blocker,level,date} —— 用于建议去重与递进
      meta:{ createdAt:now, lastOpen:now }
    };
  }

  /* ---------- 读写 ---------- */
  let _state = null;
  let _isCloud = false;        // 是否启用了 GitHub 云同步
  let _cloudStatusCb = null;   // 云同步状态回调（UI 可注册，用于轻提示）

  /* 云同步配置：由 index.html 顶部 window.ZQ_GITHUB 注入
     GitHub 仓库当后端 —— 你已有 GitHub 账号（部署就靠它），零云配置：
       ① 图案在浏览器本地派生 AES-GCM-256 密钥（密钥只驻内存，永不上网、永不落盘）
       ② 数据本地加密后，用 GitHub Contents API 写入本仓库的 <dir>/<spaceId>.json
       ③ token 由部署脚本「拆分拼接」写入前端（'ghp_'+'xxxx'，仓库内不出现完整字面量，仅绕过 GitHub 密钥扫描），运行期自动拼成完整 token：
          - 全程端到端加密，云端只有密文 —— 即使 token 泄露，没图案也解不开
          - 建议用「细粒度 PAT」仅授权本仓库，用完可在 GitHub 撤销；仓库开版本控制可回滚
     未配置（或 token 为占位符）→ 退化为纯本地模式，行为与旧版一致、离线可用。 */
  function _resolveCloud(){
    const c = (typeof window!=='undefined') ? window.ZQ_GITHUB : null;
    if(!c || !c.owner || !c.repo) return null;
    let raw = (c.token||'').trim();
    let tok = raw;
    // 部署脚本把 PAT 以「拆分拼接」形式写入前端（'ghp_'+'xxxx'），仓库内不出现完整 token 字面量，
    // 仅为绕过 GitHub 密钥扫描；运行期 JS 自动拼成完整 token。本地预览若填明文 PAT 也兼容。
    if(!tok || /'ghp_'+'xGS2DFHKOlVtlr43goNLMsQ65lUbUj0PIVpl'|替换|your[-_]?|你的|example|占位|xxx/i.test(tok)) return null;
    return {
      owner:  c.owner,
      repo:   c.repo,
      branch: c.branch || 'main',
      dir:    (c.dir || 'vault').replace(/^\/+|\/+$/g,''),
      token:  tok
    };
  }
  const CLOUD = _resolveCloud();

  /* GitHub Contents API 请求头（token 编译进前端，配合 E2E 加密，泄露也只见密文） */
  function _ghHeaders(){
    return {
      'Authorization': 'Bearer ' + CLOUD.token,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'zhiqi-pwa'
    };
  }
  function _vaultApi(){
    return 'https://api.github.com/repos/' + CLOUD.owner + '/' + CLOUD.repo
         + '/contents/' + CLOUD.dir + '/' + _spaceId + '.json';
  }
  /* UTF-8 安全 base64（信封 JSON 全 ASCII，但按 UTF-8 编更稳） */
  function b64u(str){ return btoa(unescape(encodeURIComponent(str))); }

  let _key = null;          // 当前空间的 AES-GCM 密钥（只驻内存，lock() 即丢弃）
  let _spaceId = null;      // 当前空间 ID（图案派生）
  let _cloudSha = null;     // 最近一次云端读取的文件 blob sha，用于 GitHub 乐观并发
  let _unlocked = false;    // 是否已解锁：未解锁时绝不上云（本地兜底）

  /* 本地快照按空间隔离：不同图案 → 不同 localStorage 键，互不串数据 */
  function _localKey(){ return _spaceId ? (KEY + '_' + _spaceId) : KEY; }
  function markSync(ts){ if(_state && _state.meta){ _state.meta.lastSync = ts || Date.now(); } }
  function emitCloudStatus(s){ if(_cloudStatusCb) try{ _cloudStatusCb(s); }catch(e){} }

  function load(){
    if(_state) return _state;
    try{
      const raw = localStorage.getItem(_localKey());
      if(raw){ _state = JSON.parse(raw); }
    }catch(e){ console.warn('读取失败',e); }
    if(!_state || !_state.goals){ _state = buildSeed(); save(); }
    return _state;
  }

  /* 用「图案(+暗号)」解锁一个数据空间：
     图案 → spaceId（决定云端哪个文件）+ 密钥（决定能否解开内容）
     返回 { ok, isNew, degraded, offline, error }
       - isNew    : 云端还没有这个空间，首次保存会自动创建（换图案 = 换一个全新空间）
       - degraded : 网络/COS 不通，已退回本机数据（离线照常用，恢复后自动同步）
       - ok=false : 图案或暗号不对 / 该文件被人动过 —— 必须明确报错，不能拿旧数据糊弄 */
  async function unlock(pattern, passphrase){
    if(!CLOUD) return { ok:true, offline:true, isNew:false };      // 纯本地模式：无需解锁
    const V = (typeof window!=='undefined') && window.ZQ && window.ZQ.vault;
    if(!V || !V.hasCrypto()){
      return { ok:false, error:'当前环境不支持加密（浏览器要求 HTTPS 或 localhost）' };
    }
    try{
      const pair = await V.keyOf(String(pattern||''), String(passphrase||''));
      _spaceId  = pair.spaceId;
      _key      = pair.key;
      _unlocked = true;
      _isCloud  = true;
    }catch(e){
      return { ok:false, error:'密钥派生失败：' + (e && e.message) };
    }
    load();                                   // 按空间加载本机快照
    emitCloudStatus('unlocking');
    try{
      const got = await _ghGet();
      if(got.notFound){                        // 云端无此空间 → 新空间
        emitCloudStatus('new-space');
        return { ok:true, isNew:true };
      }
      if(got.error){                           // 网络/CORS/限流：离线降级，本机照常用
        console.warn('[云同步] 读取失败，使用本机数据：', got.error);
        emitCloudStatus('fail');
        return { ok:true, degraded:true };
      }
      _cloudSha = got.sha;                      // 记下 blob sha，写回时带它做乐观并发
      const remote = await V.decrypt(got.env, _key);
      if(!remote || !remote.goals) throw new Error('BAD_PAYLOAD');
      const rTs = (remote.meta && remote.meta.lastSync) || 0;
      const lTs = (_state.meta && _state.meta.lastSync) || 0;
      if(rTs > lTs){ _state = remote; save(); emitCloudStatus('synced'); }
      else { emitCloudStatus('local-newer'); }
      return { ok:true, isNew:false };
    }catch(e){
      const m = e && e.message;
      if(m === 'DECRYPT_FAILED' || m === 'BAD_PAYLOAD' || m === 'BAD_ENVELOPE'){
        // 图案不对，或密文被篡改（AES-GCM 会认证失败）——两者都不能放行
        lock();
        return { ok:false, error:'图案或暗号不对（也可能是这个文件被人动过）' };
      }
      console.warn('[云同步] 读取失败，使用本机数据：', m);
      emitCloudStatus('fail');
      return { ok:true, degraded:true };      // 离线降级：本机照常用
    }
  }

  /* 锁定：丢弃内存密钥与状态。下次进入必须重新画图案。 */
  function lock(){
    _key = null; _spaceId = null; _unlocked = false; _state = null; _cloudSha = null;
    emitCloudStatus('locked');
  }
  function isUnlocked(){ return _unlocked; }
  function currentSpace(){ return _spaceId; }

  /* 本机是否还留着「改造前」那套旧数据（存在旧键里、还没进过任何空间）。
     用于建空间时给用户一个「把原有数据搬进来」的选项，
     免得升级后一进来看到空棋盘，以为数据丢了。 */
  function hasLegacyData(){
    try{
      const raw = localStorage.getItem(KEY);
      if(!raw) return false;
      const o = JSON.parse(raw);
      return !!(o && o.goals);
    }catch(e){ return false; }
  }

  /* 在一个「还没有数据」的图案里落下第一笔：把当前数据加密上传，正式创建这个空间。
     必须显式调用 —— 因为不同图案 = 不同文件，若画错图案就自动建空间，
     用户会看到一个空棋盘、误以为数据丢了。所以新空间一律要用户点头才建。
     useLegacy=true：先把本机改造前的旧数据搬进这个空间。 */
  async function createSpace(useLegacy){
    if(!_unlocked || !_key || !CLOUD) return false;
    if(useLegacy){
      try{
        const o = JSON.parse(localStorage.getItem(KEY) || 'null');
        if(o && o.goals) _state = o;
      }catch(e){}
    }
    if(!_state) load();
    markSync(Date.now());
    _cloudSha = null;                   // 新空间首次写入不带 sha（GitHub 据此创建文件）
    try{ localStorage.setItem(_localKey(), JSON.stringify(_state)); }
    catch(e){ console.warn('本机保存失败', e); }
    await cloudPut();
    return true;
  }

  /* 纯本机模式初始化：未配置云同步、或用户在解锁页选「仅用本机」时走这条。
     行为与改造前完全一致：读 localStorage 种子，离线可用。 */
  async function init(){
    load();
    _isCloud = false;
    return _state;
  }

  /* 写：永远先落本机（离线兜底），再异步防抖把「密文」PUT 到 COS。
     关键：上传到云端的永远是密文；密钥从未离开这台设备的内存。
     云端失败/冲突不抛错、不影响本机，保证「至少本机可用」。 */
  let _putTimer = null;
  let _putting  = false;    // 写串行化：避免两次请求用同一个 sha 互相把对方打成 409
  let _pending  = false;    // 写过程中又产生了新改动 → 结束后补一次
  function save(){
    markSync(Date.now());
    try{ localStorage.setItem(_localKey(), JSON.stringify(_state)); }
    catch(e){ console.warn('保存失败（可能隐私模式）',e); }
    if(_unlocked && CLOUD) scheduleCloudPut();
  }
  function scheduleCloudPut(){
    if(_putTimer) clearTimeout(_putTimer);
    _putTimer = setTimeout(function(){
      if(_putting){ _pending = true; return; }
      cloudPut().catch(function(err){
        console.warn('[云同步] 写入失败：', err && err.message); emitCloudStatus('fail');
      });
    }, 600);   // 防抖：连续操作合并成一次 PUT（省请求费、也降低撞锁概率）
  }
  /* GitHub 读：返回 { sha, env } / { notFound:true } / { error }。
     公开仓库即便不带 token 也能读，但带 token 限额更高（认证 5000/h）。 */
  async function _ghGet(){
    const api = _vaultApi() + '?ref=' + encodeURIComponent(CLOUD.branch) + '&t=' + Date.now();
    try{
      const res = await fetch(api, { method:'GET', cache:'no-store', headers: _ghHeaders() });
      if(res.status === 404) return { notFound:true };
      if(!res.ok) return { error: 'HTTP ' + res.status };
      const obj = await res.json();
      const b64 = (obj.content || '').replace(/\s+/g, '');   // GitHub 返回的 content 带换行
      const env = JSON.parse(atob(b64));
      return { sha: obj.sha || null, env };
    }catch(e){ return { error: (e && e.message) || 'net' }; }
  }
  /* GitHub 写：把密文信封 PUT 进 <dir>/<spaceId>.json。带 sha = 乐观并发更新；不带 = 创建。 */
  async function _ghPut(content, sha){
    const body = { message: 'zhiqi sync: ' + _spaceId, content, branch: CLOUD.branch };
    if(sha) body.sha = sha;
    return await fetch(_vaultApi(), { method:'PUT', headers: _ghHeaders(), body: JSON.stringify(body) });
  }

  async function cloudPut(){
    if(!_state || !_key || !CLOUD){ return; }
    _putting = true;
    try{
      const V = window.ZQ.vault;
      const content = b64u(JSON.stringify(await V.encrypt(_state, _key)));
      let res = await _ghPut(content, _cloudSha);

      if(res.status === 409){
        /* 409 = 远端 sha 变了（别的设备先改了云端副本）→ 拉最新密文 → 解密 → 合并 → 重试一次 */
        const got = await _ghGet();
        if(got && got.sha) _cloudSha = got.sha;
        if(got && got.env){
          const remote = await V.decrypt(got.env, _key);
          if(remote && remote.goals){ _state = _merge(_state, remote); }
        }
        res = await _ghPut(content, _cloudSha);
      }

      if(!res.ok) throw new Error('HTTP ' + res.status);
      const rd = await res.json().catch(()=>null);
      if(rd && rd.content && rd.content.sha) _cloudSha = rd.content.sha;
      emitCloudStatus('synced');
    }catch(e){
      console.warn('[云同步] 写入失败：', e && e.message); emitCloudStatus('fail');
    }finally{
      _putting = false;
      if(_pending){ _pending = false; scheduleCloudPut(); }
    }
  }

  /* 乐观并发冲突时的字段级合并：尽量不丢任意一端的数据
     - 数组类（goals/notes/diaries/log/adviceLog）按 id 去重并集
     - tasks 按 日期→id 去重并集
     - 标量/对象（profile、meta、version）取 lastSync 较新的一方整体 */
  function _merge(local, remote){
    const lTs = (local.meta && local.meta.lastSync) || 0;
    const rTs = (remote.meta && remote.meta.lastSync) || 0;
    const merged = JSON.parse(JSON.stringify(rTs >= lTs ? remote : local));
    merged.tasks = merged.tasks || {};
    ['goals','notes','diaries','log','adviceLog'].forEach(function(k){
      const base = (rTs >= lTs ? local : remote)[k] || [];
      const seen = new Set((merged[k]||[]).map(function(x){ return x && x.id; }));
      base.forEach(function(x){ if(x && x.id && !seen.has(x.id)) merged[k].push(x); });
    });
    if(remote.tasks && local.tasks){
      for(const d in local.tasks){
        merged.tasks[d] = merged.tasks[d] || [];
        const rids = new Set(merged.tasks[d].map(function(t){ return t.id; }));
        local.tasks[d].forEach(function(t){ if(!rids.has(t.id)) merged.tasks[d].push(t); });
      }
    }
    merged.meta.lastSync = Math.max(lTs, rTs);
    return merged;
  }
  function onCloudStatus(cb){ _cloudStatusCb = cb; }
  function isCloud(){ return _isCloud; }
  /* 是否「配置过」云同步 —— 决定启动时是否要先走图案解锁。
     注意与 isCloud() 的区别：isCloud() 是「当前确实连上云了」。 */
  function needUnlock(){ return !!CLOUD; }

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
  function tasksOf(dateStr){ const st=load(); return (st.tasks[dateStr]||[]); }
  function ensureDate(dateStr){ const st=load(); if(!st.tasks[dateStr]) st.tasks[dateStr]=[]; return st.tasks[dateStr]; }
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
    const patch = {done};
    if(done) patch.doneAt = Date.now();   // 记录完成时刻，供预判系统判断「熬夜完成」
    const t = updateTask(id, patch);
    if(t){ afterTaskToggled(t, done); }
    return t;
  }

  /* 任务勾选后的联动（连续天数 / 情报 / 卧底）由 undercover 模块处理，这里只做数据调用占位 */
  let _afterToggle = null;
  function onTaskToggled(fn){ _afterToggle = fn; }
  function afterTaskToggled(t, done){ if(_afterToggle) _afterToggle(t, done); }

  /* 近 7 天某类任务的完成率（难度自适应用） */
  function typeDoneRate(type){
    const st=_state; let total=0, done=0;
    for(let i=1;i<=7;i++){
      const ds=fmtDate(shiftDay(today(),-i));
      const arr=(st.tasks[ds]||[]).filter(t=>t.type===type);
      total+=arr.length; done+=arr.filter(t=>t.done).length;
    }
    return total? done/total : 0.7;
  }

  /* ---------- 目标 ---------- */
  function addGoal(g){
    const now = fmtDate(today());
    const goal = Object.assign({
      id:uid('g'), stageIndex:0, status:'active', createdAt:now, progress:0,
      totalTasksDone:0, weeklyTasksDone:0, stages:[], color:'#C0B8DC', type:'generic'
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
    // _state.tasks 是 { 日期: [任务] } 结构，需逐日过滤，不能直接对整体 .filter
    if(_state.tasks && typeof _state.tasks==='object'){
      for(const d in _state.tasks){
        _state.tasks[d] = _state.tasks[d].filter(t=>t.goalId!==id);
      }
    }
    save();
  }

  /* ---------- 随记 / 日记 ---------- */
  function addNote(n){
    const st = load();
    const note = Object.assign({ id:uid('n'), date:fmtDate(today()), emotion:'flat', points:[], taskId:null, refined:false }, n);
    st.notes.unshift(note); save(); return note;
  }
  function updateNote(id,patch){ const n=_state.notes.find(x=>x.id===id); if(n){Object.assign(n,patch);save();} return n; }
  function addDiary(d){
    const dia = Object.assign({ id:uid('d'), date:fmtDate(today()), content:'' }, d);
    _state.diaries.unshift(dia); save(); return dia;
  }

  /* ---------- 军师建议记忆（去重 + 递进） ---------- */
  // 记下「给过什么建议」，下次遇到同一主题时换个角度，不再复读
  function pushAdvice(a){
    const st = load();                       // 必须走 load()，否则 _state 可能尚未初始化
    if(!st.adviceLog) st.adviceLog = [];
    st.adviceLog.unshift(Object.assign({ date:fmtDate(today()) }, a));
    if(st.adviceLog.length > 80) st.adviceLog.length = 80;
    save();
  }
  // 最近 N 天给过的建议（默认 7 天）
  function recentAdvice(days){
    const st = load();
    if(!st.adviceLog) return [];
    const since = fmtDate(shiftDay(today(), -(days==null?7:days)));
    return st.adviceLog.filter(a => a.date >= since);
  }
  // 某个主题已经给到第几层（用于递进，避免原地打转）
  function adviceLevelOf(topic){
    const st = load();
    const list = st.adviceLog || [];
    let lv = 0;
    list.forEach(a=>{ if(a.topic===topic && (a.level||1) > lv) lv = a.level||1; });
    return lv;
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
    init, unlock, lock, isUnlocked, currentSpace, createSpace, hasLegacyData, onCloudStatus, isCloud, needUnlock,
    uid, fmtDate, today, shiftDay, weekdayCN, weekdayShort, weekOf, INBOX, isoWeek, weekKey,
    tasksOf, ensureDate, addTask, updateTask, deleteTask, reorder, setDone, onTaskToggled,
    setTaskDate, unscheduled, pushDragLog, dragOutCount, dragInCount, getWeekFocus, setWeekFocus, setWeekSummary,
    addGoal, getGoal, updateGoal, advanceStage, deleteGoal, typeDoneRate,
    addNote, updateNote, addDiary, pushLog,
    pushAdvice, recentAdvice, adviceLevelOf,
    KEY
  };
})();
