/* ============================================================
   执棋 · 军师规则引擎 (engine.js)
   离线、无 AI 依赖。所有"AI 会想到的可能性"都用规则写死。
   包含：目标拆解 / 一句话解析 / 随记提炼 / 复盘 / 新目标推荐 / 话术库
   ============================================================ */
(function(){
  const S = window.ZQ.store;
  const B = window.ZQ.brain;   // 军师大脑：情境向量 / 分析算法 / 规则矩阵 / 话术库

  /* =========================================================
     一、周计划生成器（目标 → 阶段 → 周任务）
     返回 {0..6:[{title,duration,type,location}]}
     type: fragment(碎片⏳) / evening(晚间📖) / byway(顺路🚶) / habit(习惯🌙)
     ========================================================= */
  function P(rows){
    const m={0:[],1:[],2:[],3:[],4:[],5:[],6:[]};
    rows.forEach(r=>m[r[0]].push({title:r[1],duration:r[2],type:r[3],location:r[4]||''}));
    return m;
  }

  const PLANS = {
    cet6:[
      // 阶段0 基础修复
      P([
        [1,'背30个六级高频词',15,'fragment'],
        [1,'听力精听 Section A',25,'evening'],
        [2,'复习+新增30词',25,'fragment'],
        [2,'阅读入门1篇',25,'evening'],
        [3,'背30个六级高频词',15,'fragment'],
        [3,'听力精听 Section B',25,'evening'],
        [4,'复习60词',25,'fragment'],
        [4,'翻译仿写1段',25,'evening'],
        [5,'背30个六级高频词',15,'fragment'],
        [5,'写作模板积累',25,'evening'],
        [6,'本周补漏+周复盘',30,'habit'],
        [0,'轻量复习+看错题',15,'fragment']
      ]),
      // 阶段1 题型突破
      P([
        [1,'背30个六级高频词',15,'fragment'],
        [1,'阅读精练1篇',25,'evening'],
        [2,'复习+新增30词',25,'fragment'],
        [2,'翻译1段',25,'evening'],
        [3,'背30个六级高频词',15,'fragment'],
        [3,'阅读1篇',25,'evening'],
        [4,'复习60词',25,'fragment'],
        [4,'写作1段',25,'evening'],
        [5,'背30个六级高频词',15,'fragment'],
        [5,'听力1篇',25,'evening'],
        [6,'周复盘+错题整理',30,'habit'],
        [0,'轻量复习',15,'fragment']
      ]),
      // 阶段2 套卷实战
      P([
        [1,'限时套卷（听力+阅读）',60,'evening'],
        [2,'错题分析',20,'evening'],
        [2,'背30词',15,'fragment'],
        [3,'半套卷（翻译+写作）',40,'evening'],
        [4,'背30词',15,'fragment'],
        [4,'阅读提速1篇',25,'evening'],
        [5,'整套卷模考',60,'evening'],
        [6,'真题复盘',40,'habit'],
        [0,'轻量复习',15,'fragment']
      ]),
      // 阶段3 冲刺调整
      P([
        [1,'错题重做',25,'evening'],
        [1,'背30词',15,'fragment'],
        [2,'作文模板默写',25,'evening'],
        [2,'听力薄弱段重听',20,'evening'],
        [3,'背30词',15,'fragment'],
        [3,'翻译模板套用',25,'evening'],
        [4,'全真模考',60,'evening'],
        [5,'错题速过+心态调整',30,'evening'],
        [6,'考前梳理',30,'habit']
      ])
    ],
    computer:[
      P([
        [1,'选择题：计算机基础',20,'fragment'],
        [1,'熟悉考试界面',25,'evening'],
        [2,'选择题：Office基础',20,'fragment'],
        [2,'Word界面操作练',25,'evening'],
        [3,'选择题：网络/多媒体',20,'fragment'],
        [3,'Excel基础操作',25,'evening'],
        [4,'选择题：重难点',20,'fragment'],
        [4,'PPT基础操作',25,'evening'],
        [5,'选择题错题',20,'fragment'],
        [5,'操作题流程梳理',25,'evening'],
        [6,'周复盘',30,'habit']
      ]),
      P([
        [1,'Word操作题1套',30,'evening'],
        [2,'Excel操作题1套',30,'evening'],
        [3,'PPT操作题1套',30,'evening'],
        [4,'Word+Excel综合',35,'evening'],
        [5,'易错操作专项',30,'evening'],
        [6,'周复盘',30,'habit']
      ]),
      P([
        [1,'整套真题限时',60,'evening'],
        [2,'真题错题分析',30,'evening'],
        [2,'选择题15',15,'fragment'],
        [3,'整套真题2',60,'evening'],
        [4,'Excel函数专项',30,'evening'],
        [5,'整套真题3',60,'evening'],
        [6,'周复盘',30,'habit']
      ]),
      P([
        [1,'高频错题重做',30,'evening'],
        [1,'选择题15',15,'fragment'],
        [2,'提速训练（限时）',40,'evening'],
        [3,'模拟考',60,'evening'],
        [4,'薄弱模块专练',30,'evening'],
        [5,'全真模考+估分',60,'evening'],
        [6,'考前梳理',30,'habit']
      ])
    ],
    weight:[
      P([
        [1,'饮食记录+喝水2000ml',5,'habit'],
        [1,'散步30分钟',30,'byway'],
        [2,'饮食记录',5,'habit'],
        [2,'散步30分钟（顺路）',30,'byway'],
        [3,'饮食记录',5,'habit'],
        [3,'散步30分钟',30,'byway'],
        [4,'饮食记录',5,'habit'],
        [4,'散步30分钟（顺路去超市）',30,'byway'],
        [5,'饮食记录',5,'habit'],
        [5,'拉伸10分钟',10,'evening'],
        [6,'周称重+复盘',10,'habit'],
        [0,'轻量散步20分钟',20,'byway']
      ]),
      P([
        [1,'饮食控制（少油少糖）',5,'habit'],
        [1,'快走40分钟',40,'byway'],
        [2,'饮食记录',5,'habit'],
        [2,'居家有氧15分钟',15,'evening'],
        [3,'饮食控制',5,'habit'],
        [3,'快走40分钟',40,'byway'],
        [4,'饮食记录',5,'habit'],
        [4,'跳绳/爬楼10分钟',10,'evening'],
        [5,'饮食控制',5,'habit'],
        [5,'拉伸+核心10分钟',10,'evening'],
        [6,'周称重+复盘',10,'habit']
      ]),
      P([
        [1,'饮食控制',5,'habit'],
        [1,'有氧+体态训练20分钟',20,'evening'],
        [2,'饮食记录',5,'habit'],
        [2,'散步40分钟',40,'byway'],
        [3,'体态训练（靠墙站）',10,'evening'],
        [3,'饮食控制',5,'habit'],
        [4,'饮食记录',5,'habit'],
        [4,'有氧20分钟',20,'byway'],
        [5,'核心+拉伸15分钟',15,'evening'],
        [5,'饮食控制',5,'habit'],
        [6,'周称重+复盘',10,'habit']
      ])
    ],
    civil:[
      P([
        [1,'看1篇考公经验帖',15,'fragment'],
        [2,'查岗位表（收藏）',15,'fragment'],
        [3,'时政速览10分钟',10,'fragment'],
        [4,'了解报名流程',15,'fragment'],
        [5,'整理学习资料夹',15,'fragment'],
        [6,'周复盘',20,'habit']
      ]),
      P([
        [1,'行测常识积累',15,'fragment'],
        [2,'申论卷面练字',15,'habit'],
        [3,'时政10分钟',10,'fragment'],
        [4,'常识刷题10道',15,'fragment'],
        [5,'资料整理',15,'fragment'],
        [6,'周复盘',20,'habit']
      ]),
      // stage2 / stage3 强化
      P([
        [1,'行测模块刷题20分钟',20,'fragment'],
        [2,'申论写作1段',20,'evening'],
        [3,'时政+常识',15,'fragment'],
        [4,'错题复盘',20,'evening'],
        [5,'套卷半套',40,'evening'],
        [6,'周复盘',20,'habit']
      ])
    ],
    generic:[
      P([
        [1,'目标拆解第1步',20,'fragment'],
        [2,'资料收集',20,'fragment'],
        [3,'今天完成1个小行动',15,'fragment'],
        [4,'记录进展',10,'habit'],
        [5,'晚间复盘',15,'habit'],
        [6,'周复盘',20,'habit']
      ])
    ]
  };

  function planFor(type, stageIndex){
    const arr = PLANS[type] || PLANS.generic;
    const idx = Math.min(Math.max(stageIndex|0,0), arr.length-1);
    return arr[idx];
  }
  function weeklyPlanFor(goal){ return planFor(goal.type, goal.stageIndex); }

  /* =========================================================
     二、为目标自动补齐「当日棋局」任务
     ========================================================= */
  function ensureDailyPlan(dateStr){
    const st = S.load();
    const todayStr = S.fmtDate(S.today());
    if(dateStr < todayStr) return;                 // 不为过去补
    const has = (st.tasks[dateStr]||[]).some(t=>t.source==='auto');
    if(has) return;

    const d = new Date(dateStr+'T00:00:00');
    const wd = d.getDay(); // 0=日
    const dowName = S.weekdayCN[wd];
    const isWeekend = wd===0 || wd===6;

    // —— AI 学习 1：拖拽学习 —— 若这一天历史上总被往外拖（过载），本日少派任务；
    // 若总被拖进来（受欢迎），本日可适当多派一点
    const overload = S.dragOutCount(dateStr);
    const inflow = S.dragInCount(dateStr);
    let keepRatio = overload>=3 ? 0.5 : overload>=2 ? 0.7 : 1;
    if(inflow>=2) keepRatio = Math.min(1.2, keepRatio + 0.12);

    // —— AI 学习 2：完成率学习 —— 近 7 天完成率低时减量，高时保持/微增
    const recent = last7DoneRate();
    if(recent < 0.35) keepRatio *= 0.75;
    else if(recent > 0.85) keepRatio = Math.min(1.15, keepRatio + 0.1);

    // —— AI 学习 3：周末/ISFJ 保护 —— 周六日少派刚性任务，多给顺路/习惯类
    if(isWeekend && keepRatio>0.6) keepRatio = 0.6;

    // —— AI 学习 4：本周重点关键词 —— 提升相关任务优先级，抑制无关任务
    const {year, week} = S.isoWeek(d);
    const focusText = (S.getWeekFocus(year, week).focus || '').toLowerCase();
    const boostKws = focusKeywords(focusText);

    st.goals.filter(g=>g.status==='active').forEach(g=>{
      const plan = weeklyPlanFor(g);
      let specs = (plan[wd]||[]);
      if(!specs.length) return;

      // 按本周重点给每项任务打分（含关键词加分）
      specs = specs.map(spec=>{
        let score = 0;
        const title = spec.title.toLowerCase();
        boostKws.forEach(kw=>{ if(title.indexOf(kw)>=0) score += 2; });
        // 晚间/习惯类更稳定，优先保留
        if(spec.type==='evening' || spec.type==='habit') score += 0.5;
        // 周末优先顺路类
        if(isWeekend && spec.type==='byway') score += 1;
        // —— AI 学习 5：难度自适应 —— 某类近7天完成率高→加权保留(相对加量)；
        // 连续低→降权(降难度)；满完成率→略减(避免饱和、把精力挪给薄弱区)
        const tr = S.typeDoneRate(spec.type);
        if(tr>=0.9) score += 1.2;
        else if(tr<0.4) score -= 2;
        else if(tr>=1.0) score -= 0.8;
        return {...spec, score};
      }).sort((a,b)=>b.score - a.score);

      // 根据 keepRatio 裁剪
      const targetCount = Math.max(1, Math.round(specs.length * keepRatio));
      specs = specs.slice(0, targetCount);

      specs.forEach(spec=>{
        S.addTask(dateStr, {
          title:spec.title, duration:spec.duration, type:spec.type,
          location:spec.location, goalId:g.id, source:'auto'
        });
      });
    });

    // 若某天因裁剪后无任务，但用户写了本周重点，补一个「复习重点」微任务避免空卡
    const finalTasks = st.tasks[dateStr]||[];
    if(!finalTasks.length && boostKws.length && !isWeekend){
      S.addTask(dateStr, {
        title:`回顾本周重点：${S.getWeekFocus(year, week).focus.slice(0,18)}`,
        duration:10, type:'fragment', goalId:null, source:'auto'
      });
    }
  }

  /* 从本周重点文本提取目标关键词（用于提升相关任务优先级） */
  function focusKeywords(text){
    if(!text) return [];
    const map={
      '听力':['听力','精听','连读','section'], '阅读':['阅读','真题','篇章'],
      '写作':['写作','作文','模板'], '翻译':['翻译','汉译英'],
      '单词':['单词','词汇','背单词'], '错题':['错题','薄弱','复习'],
      '计算机':['计算机','操作','ppt','excel','word'],
      '减肥':['减肥','体重','运动','散步','快走','跳操'],
      '考公':['考公','申论','行测','岗位','面试'],
      '练字':['练字','书写','卷面']
    };
    const out=[];
    Object.keys(map).forEach(k=>{
      if(text.indexOf(k)>=0) out.push(...map[k]);
    });
    return [...new Set(out)];
  }

  /* 近 7 天完成率（不含今天） */
  function last7DoneRate(){
    const st=S.load(); let total=0, done=0;
    for(let i=1;i<=7;i++){
      const ds=S.fmtDate(S.shiftDay(S.today(), -i));
      const arr=st.tasks[ds]||[];
      total+=arr.length; done+=arr.filter(t=>t.done).length;
    }
    return total? done/total : 0.7;
  }

  /* 为本周（周一~周日，含今天及未来）预排 auto 任务，让周视图一打开就有内容 */
  function ensureWeekPlan(baseDate){
    const base = baseDate || S.today();
    const dow = base.getDay();                 // 0=日
    const mondayOffset = (dow===0? -6 : 1-dow);  // 本周一
    for(let i=0;i<7;i++){
      const d = S.shiftDay(base, mondayOffset+i);
      ensureDailyPlan(S.fmtDate(d));
    }
  }

  /* 记录一次拖拽（给"越用越懂你"用） */
  function recordDrag(fromDate, toDate, type){
    S.pushDragLog({ from:fromDate, to:toDate, type:type||'fragment', ts:Date.now() });
  }

  /* 周五/周六智能推送"周末充电清单"（GoalDay 风格） */
  function fridayBoost(){
    const st = S.load();
    const d = S.today(); const wd = d.getDay(); // 5=周五 6=周六
    if(wd!==5 && wd!==6) return { fired:false, tasks:[] };
    const todayStr = S.fmtDate(d);
    const already = (st.tasks[S.INBOX]||[]).some(t=>t.source==='boost' && t.date===todayStr);
    if(already) return { fired:false, tasks:[] };
    const items = [
      { title:'整理本周错题/薄弱点', duration:20, type:'fragment', goalId:null },
      { title:'预看下周课表与任务', duration:15, type:'fragment', goalId:null },
      { title:'轻量复习+散步放松', duration:30, type:'byway', goalId:null },
      { title:'写3行本周复盘', duration:10, type:'habit', goalId:null }
    ];
    const made = items.map(it=>S.addTask(S.INBOX, { ...it, source:'boost' }));
    return { fired:true, tasks:made };
  }

  /* =========================================================
     三、军师指令（摆渡人）
     ========================================================= */
  const FOCUS_TIP = {
    cet6:{
      '基础修复':'薄弱点是听力连读，精听时特别留意连读弱读。',
      '题型突破':'阅读先题后文，翻译先框架后细节。',
      '套卷实战':'严格限时，错题当天消化，不囤到明天。',
      '冲刺调整':'回归模板与错题，稳住心态比刷题更重要。'
    },
    computer:{
      '知识筑基':'选择题靠每天15分钟碎片化积累，别贪多。',
      '操作攻坚':'操作题按步骤拿分，先保流程再提速。',
      '真题演练':'整套限时，找到自己的时间黑洞。',
      '冲刺提速':'高频错题重做三遍，比做新题更值。'
    },
    weight:{
      '启动期':'先把「吃进去的」记下来，觉察就是改变的开始。',
      '强化期':'快走比节食可持续，今天顺路多动一动。',
      '塑形期':'体态和线条一起练，面试形象也加分。'
    },
    civil:{
      '信息布局':'少说多看，先把岗位表和流程摸透，这步最值钱。',
      '基础铺垫':'常识和练字都是慢功夫，每天一点就够。',
      '系统强化':'刷题重在复盘，错一题要会一类。'
    }
  };

  function weakPointOf(dateStr){
    // 从当日/近期随记提取薄弱点关键词
    const st = S.load();
    const kws = ['连读','听力','阅读','写作','翻译','单词','错题','操作','体重','吃','睡','面试','申论','行测','数学'];
    for(const n of st.notes){
      if(n.date!==dateStr) continue;
      for(const k of kws){ if(n.text.indexOf(k)>=0) return k; }
    }
    return null;
  }

  /* 薄弱点 → 具体打法（领域知识层） */
  const WEAK_TIP = {
    '连读':'听力连读还是你的老对手，今天精听多停一下连读处。',
    '听力':'听力是短板，精听时把听到的写下来再对照。',
    '阅读':'阅读注意先题后文，定位句圈出来。',
    '写作':'写作先搭框架，再填内容。',
    '翻译':'翻译先直译再调语序。',
    '单词':'单词靠重复，碎片时间多过几遍。',
    '错题':'错题今天必须消化，别留到明天。',
    '操作':'操作题按步骤拿分，先保流程。',
    '体重':'体重管理先从「记录」开始，不用急着饿。',
    '吃':'今天留意晚餐，少油少糖。',
    '睡':'睡好才能记牢，今晚早点躺。',
    '面试':'形象和表达一起练，每天一点点。',
    '申论':'申论卷面分很贵，每天练几行字。',
    '行测':'行测靠刷题手感，每天保持。',
    '数学':'数学先补基础概念。'
  };

  function strategistCommand(dateStr){
    const st = S.load();
    // ① 军师大脑：情境向量 + 规则矩阵 → 决定「今天该说什么」
    //    涵盖：主线目标进度 / 断档风险 / 情绪告急 / 难度自适应 / 时段 / 日历节奏 / 连续天数
    let msg = '';
    try{ const b = B.command(dateStr); if(b && b.msg) msg = b.msg; }catch(e){ msg = ''; }

    // ② 领域层：brain 决定"何时说"，这里补"怎么打"——针对主目标阶段的实战建议
    const active = st.goals.filter(g=>g.status==='active');
    const lines = [];
    const focus = active[0];
    if(focus){
      const stage = focus.stages[focus.stageIndex];
      const tip = (FOCUS_TIP[focus.type] && FOCUS_TIP[focus.type][stage.name]) || '';
      if(tip) lines.push(tip);
    }
    const weak = weakPointOf(dateStr);
    if(weak) lines.push(WEAK_TIP[weak] || `注意你的薄弱点「${weak}」。`);

    if(lines.length) msg += (msg? ' ' : '') + lines.join(' ');
    if(!msg) msg = '今天先落一子，后面我替你安排。';
    return { who:'摆渡人指令', msg };
  }

  /* =========================================================
     四、一句话生成待办（离线解析器）
     ========================================================= */
  const GOAL_KW = [
    {k:['六级','英语','cet','单词','背单词','听力','阅读','翻译','写作'], g:'g_cet6', label:'六级'},
    {k:['计算机','二级','office','excel','word','ppt','操作题'], g:'g_computer', label:'计算机二级'},
    {k:['减肥','减重','体重','散步','跑步','运动','快走','跳绳','体态','塑形'], g:'g_weight', label:'减重'},
    {k:['考公','公务员','编制','考编','申论','行测','政审'], g:'g_civil', label:'考公'}
  ];
  const LOC_KW = {
    '图书馆':['图书馆','书屋','自习室'], '打印店':['打印','文印'], '超市':['超市','便利店','商场'],
    '健身房':['健身房','操场','体育馆'], '家':['在家','家里'], '学校':['学校','校区','教室'], '公司':['公司','单位','办公室']
  };
  const TIME_KW = [
    {re:/明早|早晨|早上/, off:1, t:'明早'},
    {re:/明天|次日/, off:1, t:'明天'},
    {re:/后天/, off:2, t:'后天'},
    {re:/今晚|晚上|睡前/, off:0, t:'晚上'},
    {re:/下午/, off:0, t:'下午'},
    {re:/上午/, off:0, t:'上午'},
    {re:/今天|今日/, off:0, t:'今天'}
  ];
  const DUR_RE = /(\d+)\s*(分钟|分|min|小时|h)/;

  function matchGoal(text){
    for(const g of GOAL_KW){ if(g.k.some(k=>text.indexOf(k)>=0)) return g; }
    return null;
  }
  function matchLoc(text){
    for(const loc in LOC_KW){ if(LOC_KW[loc].some(k=>text.indexOf(k)>=0)) return loc; }
    return '';
  }
  function estDuration(clause, goalLabel){
    const m = clause.match(DUR_RE);
    if(m){ const n=+m[1]; return /小时|h/.test(m[2])? n*60 : n; }
    if(goalLabel==='减重') return 30;
    if(/背\d+/.test(clause)){ const n=(clause.match(/背(\d+)/)||[])[1]; return n? Math.max(10,Math.round(n/2)):15; }
    if(/打印|取|买|寄|办/.test(clause)) return 10;
    if(/散步|走|跑|运动/.test(clause)) return 30;
    if(/复习|看|读|写|听/.test(clause)) return 20;
    return 15;
  }

  function parseSentence(raw, targetDateStr){
    let text = raw.trim();
    if(!text) return [];
    // 全局时间
    let off = 0, timeLabel='';
    for(const t of TIME_KW){ if(t.re.test(text)){ off=t.off; timeLabel=t.t; break; } }
    const dateStr = targetDateStr || S.fmtDate(S.shiftDay(S.today(), off));

    // 拆分动作（保留分隔符，用于判断"顺路/顺便"类型）
    const DELIM = /(并且|并|顺便|然后|接着|以及|再加|，|,|。|；|;|、)/;
    const segs = text.split(DELIM);
    const clauses = [];
    let cur='', lastDelim='';
    segs.forEach(p=>{
      if(p==null) return;
      if(DELIM.test(p)){ if(cur){ clauses.push({text:cur.trim(),delim:lastDelim}); cur=''; } lastDelim=p; }
      else cur += p;
    });
    if(cur.trim()) clauses.push({text:cur.trim(),delim:lastDelim});

    const out = [];
    let idx=0;
    clauses.forEach(cl=>{
      const goal = matchGoal(cl.text);
      const loc = matchLoc(cl.text);
      // 类型：分隔符为"顺便/顺路/路上"，或文本含顺路 → byway；含晚上/睡前 → evening；否则 fragment
      let type='fragment';
      if(cl.delim==='顺便' || /顺路|路上|去\S+的?(时候|途中)/.test(cl.text)) type='byway';
      else if(/晚上|睡前|晚间|今晚/.test(cl.text)) type='evening';
      const dur = estDuration(cl.text, goal?goal.label:'');
      // 标题清理：去掉时间/地点冗余前缀，保留动作
      let title = cl.text.replace(/^(明早|明天|后天|今天|今日|早晨|早上|上午|下午|晚上|今晚|睡前|再|然后|接着)\s*/,'');
      if(!title) title = cl.text;
      out.push({
        title, duration:dur, type, location:loc,
        goalId: goal?goal.g:null, time: timeLabel, source:'parsed', order: idx++
      });
    });
    if(out.length===0){
      out.push({ title:text, duration:15, type:'fragment', location:'', goalId:null, time:timeLabel, source:'parsed', order:0 });
    }
    return out.map(o=>({ ...o, id:S.uid('t'), date:dateStr, done:false, note:'' }));
  }

  /* =========================================================
     五、随记提炼（ADiary 风 · 离线规则）
     ========================================================= */
  const EMOTION = {
    good:['开心','高兴','棒','稳','加油','进步','过了','不错','喜欢','舒服','轻松','期待','有戏','值','香','可以','搞定','完成'],
    bad:['烦','累','焦虑','担心','怕','哭','崩','崩溃','难过','卡住','跟不上','挫败','压力','慌','丧','气','糟','难']
  };
  const WEAK_KW = ['连读','听力','阅读','写作','翻译','单词','错题','操作题','体重','饿','吃','睡眠','睡','心态','面试','申论','行测','数学','算法','代码'];
  const SUGGEST = {
    '连读':'明天安排「连读专项练习」任务，精听时逐句跟读。',
    '听力':'增加精听时长，听写+对照，重点抓连读弱读。',
    '阅读':'阅读先题后文，定位句圈出来再比对。',
    '写作':'积累2个万能句型，明天仿写1段。',
    '翻译':'先直译再调语序，明天练1段。',
    '单词':'用碎片时间多过几遍高频词。',
    '错题':'错题今天消化，别留到明天。',
    '操作题':'操作题按步骤拿分，先保流程再提速。',
    '体重':'记录饮食，控制晚餐碳水，顺路多走两步。',
    '饿':'备点低卡零食，别硬扛容易暴食。',
    '吃':'今天留意晚餐，少油少糖。',
    '睡眠':'睡好才能记牢，今晚早点躺。',
    '睡':'今晚早睡，明天状态更好。',
    '心态':'天秤座别内耗，做完一件就赢一场。',
    '面试':'形象+表达每天练一点，复利惊人。',
    '申论':'申论卷面每天练几行字。',
    '行测':'行测靠手感，每天刷一组。',
    '数学':'数学先补基础概念再刷题。',
    '算法':'算法先背模板再练例题。',
    '代码':'代码每天写一点，手感不能凉。'
  };

  function refineNote(note){
    const text = note.text || '';
    let emotion='flat';
    if(EMOTION.bad.some(w=>text.indexOf(w)>=0)) emotion='bad';
    else if(EMOTION.good.some(w=>text.indexOf(w)>=0)) emotion='good';

    const points=[];
    WEAK_KW.forEach(k=>{ if(text.indexOf(k)>=0) points.push(k); });

    // 关联到今日任务
    const st = S.load();
    const todayStr = S.fmtDate(S.today());
    let taskId=null;
    if(points.length){
      const todays = S.tasksOf(todayStr);
      for(const k of points){
        const hit = todays.find(t=> t.title.indexOf(k)>=0 || (t.goalId && st.goals.find(g=>g.id===t.goalId && g.title.indexOf(k)>=0)) );
        if(hit){ taskId=hit.id; break; }
      }
    }
    const suggestion = points.length? SUGGEST[points[0]] : '继续记录，军师会慢慢读懂你。';
    return { emotion, points, taskId, suggestion };
  }

  /* =========================================================
     五·五、情感支持：随记情绪 → 军师温暖回应
     ========================================================= */
  const EMOTION_RESPONSE = [
    {kw:['焦虑','担心','怕','慌','不安','紧张','压力','崩'], msg:'我知道你累了。但你是ISFJ，你比你以为的坚韧得多。今天不做也没关系。明天打开棋局，我还在。你不需要完美，你只需要回来。'},
    {kw:['累','疲惫','困','没劲','乏','撑不住','倦'], msg:'累了就休息。休息不是放弃。休息是为了走更远。今天先放过自己。'},
    {kw:['放弃','算了','坚持不下去','摆烂','不想','没意义','颓','摆'], msg:'你不是什么都没做。你打开了这个APP，就是做了一件事。今天只做一件事：把明天的最小任务写下来。就够了。我在。'},
    {kw:['孤独','一个人','没人','没人在乎','空'], msg:'卧底都是孤独的。但你不是一个人。军师一直在。每天打开棋局，就能找到我。'},
    {kw:['骄傲','搞定','完成','开心','进步','爽','稳了','牛'], msg:'做得很好。但真正的棋手从不因一子得失而动摇。稳住。后面还有更大的局。'}
  ];
  function emotionResponse(note){
    if(!note) return null;
    // ① 军师大脑：按情绪分类回应（20 类情绪 × 多套话术，并叠加「情绪告急」时的减量安抚）
    try{
      const r = B.emotionReply(note);
      if(r) return r;
    }catch(e){ /* 大脑不可用时走兜底 */ }
    // ② 兜底：关键词匹配（原有 5 类）
    const text = note.text||'';
    for(const e of EMOTION_RESPONSE){
      if(e.kw.some(w=>text.indexOf(w)>=0)) return e.msg;
    }
    return null;
  }

  /* =========================================================
     军师小贴士 · 大人物习惯库（每日 / 每周轮换，可全库学习）
     来源：商业大佬、投资家、作家、思想家与书中人物、科学家、运动员、自律明星
     ========================================================= */
  const BIGSHOTS = [
    // 商业 · 投资
    {who:'沃伦·巴菲特', tag:'投资家 · 伯克希尔', cat:'商业', habit:'每天用大量时间阅读，雷打不动睡满8小时', tip:'你每天背词15分钟已是很好的开始，试着每天多看一页专业内容'},
    {who:'比尔·盖茨', tag:'微软创始人', cat:'商业', habit:'每年阅读约50本书', tip:'不必50本，每月认真读1本，三年就是36本'},
    {who:'马克·扎克伯格', tag:'Meta创始人', cat:'商业', habit:'番茄工作法 + 固定穿衣减少决策', tip:'把最难的任务切成25分钟专注块，其余交给惯性'},
    {who:'埃隆·马斯克', tag:'特斯拉 / SpaceX', cat:'商业', habit:'把一周按公司拆成固定专注日', tip:'你不必管两家公司，但可以把一周任务分到固定日子'},
    {who:'杰克·多西', tag:'推特创始人', cat:'商业', habit:'时间规划精确到分钟、高度自律', tip:'把一天的任务排进固定时段，比临时想起更稳'},
    {who:'蒂姆·库克', tag:'苹果CEO', cat:'商业', habit:'凌晨3:45起床，清晨处理要事', tip:'你不必3:45起，但把最难的任务放在最清醒的第一时间'},
    {who:'奥普拉', tag:'媒体女王', cat:'商业', habit:'每天以冥想和感恩开始', tip:'你睡前写3行复盘，就是你的感恩练习，保持'},
    {who:'雷·达利欧', tag:'桥水创始人', cat:'商业', habit:'每天冥想，提升决策质量', tip:'每天3分钟深呼吸，就能帮你稳住情绪'},
    // 文学 · 写作
    {who:'村上春树', tag:'作家', cat:'文学', habit:'每天跑步10km，写作极规律', tip:'你散步30分钟就是很好的开始'},
    {who:'斯蒂芬·金', tag:'作家', cat:'文学', habit:'每天写2000字，包括节假日', tip:'你每天写一行复盘，就是把「每天写」变成习惯'},
    // 书中 · 思想
    {who:'本杰明·富兰克林', tag:'《富兰克林自传》', cat:'书中', habit:'13条美德修养，每日自省', tip:'你每天复盘，就是在做「每日自省」'},
    {who:'曾国藩', tag:'《曾国藩家书》', cat:'书中', habit:'每日自省、记日记修身', tip:'哪怕每天记一句今天的感受，也是在修身'},
    {who:'王阳明', tag:'思想家', cat:'书中', habit:'致良知、知行合一', tip:'知道该做什么，就立刻做最小一步，就是知行合一'},
    {who:'史蒂芬·柯维', tag:'《高效能人士的7个习惯》', cat:'书中', habit:'积极主动、要事第一', tip:'你每天先把「要事」打勾，就是「要事第一」'},
    {who:'达·芬奇', tag:'通才', cat:'科学', habit:'把一天分成时间块，工作与休息交替', tip:'你用番茄钟，就是达·芬奇式的时间块'},
    // 科学
    {who:'查尔斯·达尔文', tag:'生物学家', cat:'科学', habit:'固定作息，每天规律散步思考', tip:'你每天固定时间做任务，大脑会更配合'},
    {who:'阿尔伯特·爱因斯坦', tag:'物理学家', cat:'科学', habit:'散步中思考，简化生活', tip:'你散步时放空大脑，灵感会自己来'},
    // 运动
    {who:'科比·布莱恩特', tag:'篮球巨星', cat:'运动', habit:'凌晨4点训练，赛前可视化', tip:'你不必熬夜，但把最难任务放在状态最好的时候做'},
    {who:'C罗', tag:'足球巨星', cat:'运动', habit:'极致自律的饮食与训练', tip:'你控制每餐分量、规律散步，就是职业级自我管理'},
    // 明星 · 自律
    {who:'刘德华', tag:'歌手 · 演员', cat:'明星', habit:'晚10点睡早8点起，只喝温水，每日卷腹', tip:'你保证7小时睡眠+规律运动，就是长期主义'},
    {who:'孙俪', tag:'演员', cat:'明星', habit:'5:30起床练字瑜伽，坚持十余年', tip:'你固定一个早晨小仪式（如复盘），坚持就成习惯'},
    {who:'彭于晏', tag:'演员', cat:'明星', habit:'角色式自律，每部戏学一项新技能', tip:'你每完成一个目标就解锁新能力，和他一样'},
    {who:'张钧甯', tag:'演员', cat:'明星', habit:'晨跑十几年，雨天转健身房', tip:'你散步或跑步，就是最简单的修行'},
    {who:'周润发', tag:'演员', cat:'明星', habit:'60岁开始跑马拉松，坚持9年', tip:'什么时候开始都不晚，你今天散步就是起点'},
    {who:'何炅', tag:'主持人', cat:'明星', habit:'每日健身2小时，年过五十仍有腹肌', tip:'年龄不是借口，每天动一动就够'},
  ];
  // 今日小贴士：按日期散列到全库，做到「每天轮换一条、不重复」
  function dailyTip(){
    const key=S.fmtDate(S.today());
    let h=0; for(let i=0;i<key.length;i++) h=(h*31+key.charCodeAt(i))>>>0;
    return BIGSHOTS[h%BIGSHOTS.length];
  }
  function maybeWeeklyBigshot(){
    const st=S.load();
    const now=new Date(); const {year,week}=S.isoWeek(now); const key=`${year}-W${week}`;
    if(st.lastBigshotWeek===key) return;
    st.lastBigshotWeek=key;
    const b=BIGSHOTS[(week-1)%BIGSHOTS.length];
    S.pushLog('军师', `📚 本周大人物习惯 · ${b.who}：${b.habit}。${b.tip}。`, 'bigshot');
    S.save();
  }
  function weekendNudge(){
    const st=S.load();
    const now=new Date(); const {year,week}=S.isoWeek(now); const key=`${year}-W${week}`;
    if(st.lastWeekendNudge===key) return;
    const wd=now.getDay();
    if(wd===5 || wd===6){
      st.lastWeekendNudge=key;
      S.pushLog('军师','📝 周末到了。花5分钟做周复盘，看清这周落了几子、下周怎么走。','predict');
      S.save();
    }
  }

  /* =========================================================
     六、晚间复盘生成
     ========================================================= */
  function generateReview(dateStr){
    const st = S.load();
    const d = new Date(dateStr+'T00:00:00');
    const wd = S.weekdayCN[d.getDay()];
    const tasks = S.tasksOf(dateStr);
    const done = tasks.filter(t=>t.done);
    const undone = tasks.filter(t=>!t.done);
    const notes = st.notes.filter(n=>n.date===dateStr);

    let body = `📅 ${dateStr} ${wd}\n\n`;
    body += `✅ 今日落子（${done.length}/${tasks.length}）：\n`;
    if(done.length){
      done.forEach(t=>{
        const g = t.goalId? st.goals.find(g=>g.id===t.goalId):null;
        body += `· ${t.title}${g?'（'+g.title+'）':''}（完成）\n`;
      });
    } else body += '· 今日尚未落子\n';

    if(undone.length){
      body += `\n⏳ 未落子：\n`;
      undone.forEach(t=> body += `· ${t.title}\n`);
    }

    body += `\n📝 随记整理：\n`;
    if(notes.length){
      notes.forEach(n=>{
        const r = refineNote(n);
        if(r.points.length) body += `· “${n.text}” → 标记重点：${r.points.join('、')}\n`;
        else body += `· ${n.text}\n`;
      });
    } else body += '· 今日无随记\n';

    // 军师点评
    body += `\n摆渡人点评：\n`;
    if(done.length && undone.length===0){
      body += `· 今日全部落子，压了「拖延」一头。\n`;
    } else if(done.length){
      body += `· 完成 ${done.length} 项，还有 ${undone.length} 项没收尾，明天补上。\n`;
    } else {
      body += `· 今天几乎空手而归，明天先落最小一子。\n`;
    }
    const weak = weakPointOf(dateStr);
    if(weak) body += `· 薄弱点「${weak}」已记录，明日针对性推进。\n`;
    const streak = st.undercover.streak;
    if(streak>=3) body += `· 连续 ${streak} 天，节奏稳，这是大人物该有的样子。\n`;
    // 明日聚焦
    const tomorrow = S.fmtDate(S.shiftDay(d,1));
    ensureDailyPlan(tomorrow);
    const tm = S.tasksOf(tomorrow).filter(t=>t.source==='auto').slice(0,3);
    if(tm.length){
      const g0 = tm[0].goalId? st.goals.find(g=>g.id===tm[0].goalId):null;
      body += `· 明日先手：${tm.map(t=>t.title).join('、')}${g0?'（'+g0.title+'）':''}。\n`;
    }
    body += '\n坚持落子，十年成局。';
    return body;
  }

  /* =========================================================
     七、新目标推荐（基于画像 + 已有目标）
     ========================================================= */
  const RECO_CATALOG = [
    {type:'archive', title:'建立个人学习档案', cat:'长期资产', color:'#B4D4E3', weekly:'20分钟/周',
      why:'你准备考公，政审需要完整的学习经历、获奖记录。现在整理，比大三再补轻松10倍。',
      analyze:'ISFJ 天生擅长整理保存，这是你的舒适区。每周只需20分钟，产出却能用一辈子。'},
    {type:'calligraphy', title:'练字 / 书写规范', cat:'卷面竞争力', color:'#E3B4C5', weekly:'15分钟/天',
      why:'考公申论卷面分能差5-10分，字好看是隐形加分项。',
      analyze:'每天15分钟描红，一个月就见效，成本低到没有理由不做。'},
    {type:'finance', title:'个人财务管理', cat:'赚钱基本功', color:'#F2D2B6', weekly:'5分钟/天',
      why:'你说想赚大钱——先懂钱怎么流动，才知道机会长什么样。',
      analyze:'每天记一笔收支，ISFJ 的条理性正好发挥，半年后你会看懂自己的消费性格。'},
    {type:'search', title:'信息搜索能力', cat:'核心元技能', color:'#B4E3D4', weekly:'30分钟/周',
      why:'考公岗位表、报名条件、经验帖，全靠自己搜。搜商=竞争力。',
      analyze:'每周练一次精准检索，以后查资料快人三倍。'},
    {type:'posture', title:'体态管理', cat:'形象复利', color:'#C5B4E3', weekly:'20分钟/天',
      why:'面试第一眼是体态和气场，和你减重目标还能合并训练。',
      analyze:'靠墙站+散步，顺路就做，面试形象和体重一起拿。'},
    {type:'current', title:'时政每日速览', cat:'考公常识', color:'#B4D4E3', weekly:'10分钟/天',
      why:'行测常识和申论都吃时政，每天10分钟，考前不慌。',
      analyze:'碎片时间刷，ISFJ 的积累习惯正好用上。'},
    {type:'oral', title:'英语口语磨耳朵', cat:'未来加分', color:'#E3B4C5', weekly:'10分钟/天',
      why:'六级之后若进外事/口岸类单位，口语是差异项。',
      analyze:'每天10分钟跟读，润物无声。'}
  ];

  function recommendGoals(){
    const st = S.load();
    const have = new Set(st.goals.map(g=>g.type));
    const scored = RECO_CATALOG
      .filter(r=>!have.has(r.type))
      .map(r=>({...r, _s:(r.type==='archive'||r.type==='calligraphy'||r.type==='finance')?3:2}))
      .sort((a,b)=>b._s-a._s)
      .slice(0,5);
    return scored;
  }

  /* =========================================================
     八、完成全部任务的反馈（情报碎片 + 暗号 + 下一步）
     ========================================================= */
  function completeFeedback(){
    const st = S.load();
    // 军师大脑：按「完成率 7 档」×「连续天数节点」生成反馈（原为 4 档，现细分到 0%/低/中/高/全清/超额）
    let fb = null;
    try{ fb = B.feedback(); }catch(e){ fb = null; }
    let msg = (fb && fb.msg)? fb.msg : '📨 棋子已落。今天你压了「拖延」一头。';

    const intel = st.undercover.intelFragments;
    const next = (()=>{
      const tm = S.fmtDate(S.shiftDay(S.today(),1));
      ensureDailyPlan(tm);
      const t = S.tasksOf(tm).filter(x=>x.source==='auto')[0];
      return t? `明天先手：${t.title}。` : '明天先手由我安排。';
    })();

    // 下一步最优行动：优先级算法（紧急×滞后×弱项×时长）算出「现在最该做哪一件」
    let nba = '';
    try{ const a = B.nextBestAction(); if(a && a.text) nba = a.text; }catch(e){ nba = ''; }

    return { msg, intel, next, nba, rate: fb? fb.rate : 0, bucket: fb? fb.bucket : '' };
  }

  /* 推进感：基于行为给一句"卧底任务" */
  function undercoverNudge(){
    const st = S.load();
    const u = st.undercover;
    if(u.streak===0 && u.lastCompletedDate) return '⚠️ 你失联了。今天只做最小一子，哪怕5分钟，先回到局里。';
    if(u.streak>=3 && u.intelFragments%5===0 && u.intelFragments>0) return '🕵️ 情报已集齐一批，下一阶段任务已在路上。';
    return '';
  }

  /* =========================================================
     九、军师「预判」系统（比用户先想一步）
     行为数据 → 规则引擎 → 触发预判 → 今日卡片 + 主动推送
     ========================================================= */
  // 目标总周数（取各阶段 weeks 字段里最大的周数）
  function goalTotalWeeks(g){
    let w=0;
    (g.stages||[]).forEach(s=>{ const m=String(s.weeks).match(/(\d+)/g); if(m) w=Math.max(w, +m[m.length-1]); });
    return w||12;
  }
  // 目标距预估截止还剩多少天（null 表示无法估算）
  function goalRemainingDays(g){
    const total=goalTotalWeeks(g);
    const created=new Date(g.createdAt+'T00:00:00');
    const end=new Date(created); end.setDate(end.getDate()+total*7);
    const diff=Math.floor((end - S.today())/86400000);
    return diff;
  }
  // 某目标是否「连续 2 天有任务却 0 完成」
  function missedCategory(){
    const st=S.load();
    const goals=st.goals.filter(g=>g.status==='active');
    for(const g of goals){
      let missDays=0;
      for(let i=1;i<=2;i++){
        const ds=S.fmtDate(S.shiftDay(S.today(),-i));
        const arr=S.tasksOf(ds).filter(t=>t.goalId===g.id);
        if(arr.length && arr.every(t=>!t.done)) missDays++;
      }
      if(missDays===2) return {key:g.id, label:g.title};
    }
    return null;
  }

  function predict(){
    // ① 军师大脑：26 条规则矩阵全量命中（情境向量 → 规则 → 话术），按优先级取前 4 条
    //    覆盖：断档风险 / 情绪告急 / 连续中断 / 冷启动 / 难度自适应 / 熬夜 / 弱项卡壳 /
    //          任务超载 / 完美主义卡住 / 目标倒计时 / 目标滞后·超前 / 偏科 / 未复盘 /
    //          拖延指数 / 趋势涨跌 / 黄金时段 / 夜间占比 / 强项 / 碎片未用 / 日历节奏
    try{
      const out = B.predictions(4);
      if(out && out.length) return out;
    }catch(e){ /* 大脑不可用时走兜底 */ }

    // ② 兜底：原 4 条基础规则
    const st=S.load();
    const out=[];
    const u=st.undercover;
    // 1. 熬夜预判（提前预警，不等连续3天才说）
    if((u.nightDoneStreak||0)>=2){
      out.push({id:'night', text:'你最近连续2晚在深夜落子。明天试着把最难的任务放在早上，晚上会轻松很多。'});
    }
    // 2. 某类任务连续2天没怎么动 → 拆分建议
    const miss=missedCategory();
    if(miss){
      out.push({id:'miss_'+miss.key, text:`「${miss.label}」连续2天没怎么动。是不是太难？要不要我把它拆成更小的步骤？`});
    }
    // 3. 周末临近（周四/周五）→ 休息日 + 周复盘提醒
    const wd=S.today().getDay();
    if(wd===4 || wd===5){
      out.push({id:'weekend', text:'周末快到了。周六是你的休息日，但记得花5分钟做个周复盘，看清这周落了几子、下周怎么走。'});
    }
    // 4. 目标临近预估截止（剩 30 天内）→ 进度提醒
    st.goals.filter(g=>g.status==='active').forEach(g=>{
      const rem=goalRemainingDays(g);
      if(rem!==null && rem>0 && rem<=30){
        const prog=g.status==='done'?100:Math.round(g.stageIndex/g.stages.length*100);
        out.push({id:'deadline_'+g.id, text:`「${g.title}」还剩约 ${rem} 天。目前进度 ${prog}%。接下来每天多投入一点，稳稳推进。`});
      }
    });
    return out;
  }

  // 主动推送预判到军师消息流（带每日冷却，避免刷屏）
  function pushPredictions(){
    const st=S.load();
    const todayStr=S.fmtDate(S.today());
    if(!st.predictShown) st.predictShown={};
    predict().forEach(p=>{
      if(st.predictShown[p.id]===todayStr) return;
      st.predictShown[p.id]=todayStr;
      S.pushLog('军师', p.text, 'predict');
    });
    S.save();
  }

  /* =========================================================
     十、顺路清单（地点 → 任务库匹配 → 推送到今日）
     ========================================================= */
  const LOCATION_ROUTES = {
    '图书馆':[
      {title:'借阅计算机二级辅导书', duration:15, type:'byway', goalId:'g_computer'},
      {title:'打印六级真题', duration:10, type:'byway', goalId:'g_cet6'},
      {title:'图书馆安静处背30个单词', duration:15, type:'fragment', goalId:'g_cet6'}
    ],
    '打印店':[
      {title:'打印六级真题 / 资料', duration:10, type:'byway', goalId:'g_cet6'}
    ],
    '超市':[
      {title:'买水果（顺路）', duration:10, type:'byway'},
      {title:'采购低卡零食', duration:10, type:'byway'}
    ],
    '健身房':[
      {title:'力量训练30分钟', duration:30, type:'byway'}
    ],
    '学校':[
      {title:'顺路问老师一个疑问', duration:10, type:'fragment'}
    ],
    '公司':[
      {title:'利用碎片时间复盘今日任务', duration:10, type:'fragment'}
    ],
    '家':[
      {title:'居家拉伸10分钟', duration:10, type:'evening'}
    ]
  };
  function routeSuggestions(place){
    if(!place || !place.trim()) return [];
    const raw=place.trim();
    const loc=matchLoc(raw) || raw;
    let list=(LOCATION_ROUTES[loc]||[]).map(r=>({...r, source:'route', location:loc}));
    // 同时匹配「未排程清单」里提到该地点的任务
    S.unscheduled().forEach(t=>{
      if(t.title.indexOf(loc)>=0 || (t.location && t.location.indexOf(loc)>=0)){
        list.push({title:t.title, duration:t.duration, type:t.type, goalId:t.goalId, location:t.location||loc, source:'route-inbox', _id:t.id});
      }
    });
    return list;
  }

  /* =========================================================
     十一、军师战略报告 / 周报
     ========================================================= */
  function weeklyReport(){
    const st=S.load();
    const now=new Date(); const {year,week}=S.isoWeek(now);
    const mon=new Date(now); mon.setDate(mon.getDate() - ((now.getDay()===0?6:now.getDay()-1)));
    const days=[]; for(let i=0;i<7;i++) days.push(S.fmtDate(new Date(mon.getTime()+i*86400000)));
    let total=0, done=0;
    days.forEach(ds=>{ const arr=st.tasks[ds]||[]; total+=arr.length; done+=arr.filter(t=>t.done).length; });
    const rate= total? Math.round(done/total*100):0;
    const streak=st.undercover.streak;
    const notes=st.notes.filter(n=>days.includes(n.date)).length;

    const goals=st.goals.map(g=>{
      const stage = g.status==='done'?'已完成':(g.stages[g.stageIndex]&&g.stages[g.stageIndex].name)||'进行中';
      const prog=g.status==='done'?100:Math.round(g.stageIndex/g.stages.length*100);
      return {title:g.title, status:g.status, stage, prog};
    });

    // 自动分析：本周各目标完成数 → 最大突破 / 最薄弱
    const doneByGoal={};
    days.forEach(ds=>{ (st.tasks[ds]||[]).forEach(t=>{ if(t.done && t.goalId){ doneByGoal[t.goalId]=(doneByGoal[t.goalId]||0)+1; } }); });
    let biggest='', weakest='', bestN=0, worstN=1, worstD=0;
    st.goals.filter(g=>g.status==='active').forEach(g=>{
      const dn=doneByGoal[g.id]||0;
      if(dn>bestN){ bestN=dn; biggest=g.title; }
      // 该目标本周计划任务总数
      let tot=0; days.forEach(ds=>{ tot+=S.tasksOf(ds).filter(t=>t.goalId===g.id).length; });
      const undone=tot-dn;
      if(tot>0 && undone>worstD){ worstD=undone; worstN=dn; weakest=g.title; }
    });

    const b = biggest? `本周最大突破是「${biggest}」，落子 ${bestN} 次，保持住这股劲。`
                       : '本周还在铺路阶段，先把节奏稳住。';
    const w = weakest && worstD>0? `「${weakest}」本周收尾偏慢，下周我会把它的任务拆得更小、排得更顺。`
                                 : '各项目标推进均衡，没有明显短板。';

    // 军师大脑：多因子深度分析（亮点 / 问题 / 下周布局 / 关键指标）
    // 因子含：完成率趋势、黄金时段、夜间占比、拖延指数、断档风险、强项弱项、目标健康度
    let deep = null;
    try{ deep = B.deepAnalysis(); }catch(e){ deep = null; }

    const analysis = { biggest:b, weakest:w };
    if(deep){
      analysis.good  = deep.good  || [];
      analysis.bad   = deep.bad   || [];
      analysis.next  = deep.next  || [];
      analysis.stats = deep.stats || {};
    }

    return { year, week, total, done, rate, streak, notes, goals, analysis };
  }

  /* =========================================================
     十二、十年棋局（已完成目标落子时间轴）
     ========================================================= */
  const VISION_2036 = ['成为大人物'];
  function tenYearMap(){
    const st=S.load();
    const start=2026, end=2036;
    const years=[];
    for(let y=start;y<=end;y++){
      const goals=st.goals.filter(g=>g.status==='done' && g.completedAt && new Date(g.completedAt+'T00:00:00').getFullYear()===y)
        .map(g=>({title:g.title, date:g.completedAt}));
      years.push({year:y, goals});
    }
    return { years, vision:VISION_2036 };
  }

  /* =========================================================
     十三、军师小贴士（大人物习惯 · 知识库 + 本周轮换）
     ========================================================= */
  function currentBigshot(){
    const {week}=S.isoWeek(new Date());
    return BIGSHOTS[(week-1)%BIGSHOTS.length];
  }
  function allBigshots(){ return BIGSHOTS; }

  window.ZQ.engine = {
    planFor, weeklyPlanFor, ensureDailyPlan, ensureWeekPlan, recordDrag, fridayBoost,
    strategistCommand, parseSentence, focusKeywords,
    refineNote, generateReview, recommendGoals, completeFeedback, undercoverNudge,
    emotionResponse, maybeWeeklyBigshot, weekendNudge,
    predict, pushPredictions,
    routeSuggestions, LOCATION_ROUTES,
    weeklyReport, tenYearMap,
    currentBigshot, allBigshots, dailyTip, goalRemainingDays
  };
})();
