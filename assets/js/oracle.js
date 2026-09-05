/* ============================================================
   执棋 · 军师算法中台 (oracle.js)
   ------------------------------------------------------------
   在 brain.js（情境向量 / 规则矩阵 / 话术库）之上，补齐真正"会算"的部分：
     ① 数据底座   日/星期/时段/任务历史 的四维统计
     ② 精力模型   生理节律 × 个人时段效率 × 疲劳衰减
     ③ 负荷指数   今日任务时长 / 可用时长，判断超载还是喂不饱
     ④ 预测引擎   明日完成率 / 本周预测 / 目标达成日期 / 连续天数续接概率
     ⑤ 顺路算法   地点归一 + 多因子打分 + 推荐理由（真算法，不是查表）
     ⑥ 拆解 V2    30+ 语义模板 × 时长自适应 × 难度自适应
     ⑦ 建议 V2    主题扩到 30+，每主题多阻碍层，叠加领域知识
     ⑧ 军师点评   多因子、带数据的复盘点评
     ⑨ 下周布局   按目标健康度分配配额 × 星期效应排布
     ⑩ 扩展预判   在 brain 规则之上再叠 20 条
     ⑪ 意图问答   军师会客厅：识别意图 → 调算法 → 用数据回答
   全部离线确定性计算，飞行模式可用；同一时刻结论稳定。
   ============================================================ */
(function(){
  const S = window.ZQ.store;
  const B = window.ZQ.brain;
  const hash = B.hash, pick = B.pick, clamp = B.clamp;
  const r1 = v => Math.round(v*10)/10;
  const pctN = v => Math.round(v*100);

  /* =========================================================
     ①  数据底座：把散落的数据聚成可计算的统计量
     ========================================================= */

  /* 近 N 天逐日统计（含时长维度，不只是条数） */
  function dayStats(days){
    const out = [];
    for(let i=0;i<days;i++){
      const d = S.shiftDay(S.today(), -i);
      const ds = S.fmtDate(d);
      const arr = S.tasksOf(ds);
      const done = arr.filter(t=>t.done);
      const minutes = arr.reduce((s,t)=> s + (t.duration||15), 0);
      const doneMin = done.reduce((s,t)=> s + (t.duration||15), 0);
      out.push({ date:ds, weekday:d.getDay(), total:arr.length, done:done.length,
                 rate: arr.length? done.length/arr.length : null, minutes, doneMin });
    }
    out.reverse();               // 由远及近
    return out;
  }

  /* 星期效应：周一~周日各自的完成率（样本不足时返回 null，避免瞎猜） */
  function weekdayProfile(days){
    days = days || 28;
    const rows = dayStats(days).filter(x=> x.total>0);
    const prof = [];
    let allT=0, allD=0;
    rows.forEach(x=>{ allT+=x.total; allD+=x.done; });
    const allRate = allT? allD/allT : 0;
    for(let w=0; w<7; w++){
      const g = rows.filter(x=> x.weekday===w);
      const t = g.reduce((s,x)=> s+x.total, 0);
      const d = g.reduce((s,x)=> s+x.done, 0);
      prof.push({ wd:w, label:S.weekdayCN[w], samples:g.length, total:t, done:d,
                  rate: t? d/t : null,
                  factor: (t>=4 && allRate>0)? clamp((d/t)/allRate, 0.7, 1.3) : null });
    }
    return { prof, allRate, allTotal:allT, allDone:allD };
  }

  /* ---------- 计算缓存：一次渲染会调用这些统计几十次，用数据指纹避免重复全量遍历 ---------- */
  let _fp = '', _histCache = null, _slotCache = null;
  function fingerprint(){
    const st = S.load();
    let n = 0, d = 0;
    for(const ds in st.tasks){
      const a = st.tasks[ds]||[];
      n += a.length;
      for(let i=0;i<a.length;i++) if(a[i].done) d++;
    }
    return n + ':' + d + ':' + S.fmtDate(S.today());
  }
  function ensureCache(){
    const fp = fingerprint();
    if(fp !== _fp){ _fp = fp; _histCache = null; _slotCache = null; }
    return fp;
  }

  /* 时段画像：7 个时段各自的完成贡献（用于精力模型的个人修正） */
  const SLOT_KEYS = ['deepNight','earlyMorning','morning','noon','afternoon','evening','night'];
  const SLOT_CN = B.SLOT_CN;
  function slotProfile(){
    ensureCache();
    if(_slotCache) return _slotCache;
    const st = S.load(); const b = {}; let total = 0;
    for(const ds in st.tasks){
      (st.tasks[ds]||[]).forEach(t=>{
        if(!t.done || !t.doneAt) return;
        const s = B.timeSlotOf(new Date(t.doneAt).getHours());
        b[s] = (b[s]||0) + 1; total++;
      });
    }
    const avg = total/7 || 0;
    const out = SLOT_KEYS.map(k=>({ slot:k, cn:SLOT_CN[k], done:b[k]||0,
                               share: total? (b[k]||0)/total : 0,
                               lift:  avg>0? clamp(((b[k]||0)/avg - 1) * 12, -14, 16) : 0 }));
    _slotCache = out;
    return out;
  }

  /* 任务标题归一：去掉数量/时间词，让"背30个单词"和"背单词"算同一件事 */
  function normTitle(t){
    return String(t||'')
      .toLowerCase()
      .replace(/[0-9０-９]+\s*(个|分钟|分|小时|页|斤|kg|道|遍|次|题|章|节|%)/g,'')
      .replace(/[，。、；：！？,.;:!?~\s]/g,'')
      .replace(/(今天|明天|后天|早上|上午|中午|下午|晚上|睡前)/g,'')
      .slice(0,20);
  }

  /* 任务历史库：同标题历史上做过几次、完成率多少 —— 「这类任务你八成会做」的数据来源 */
  function taskHistoryMap(days){
    days = days || 45;
    ensureCache();
    if(_histCache && _histCache.days === days) return _histCache.map;
    const since = S.fmtDate(S.shiftDay(S.today(), -days));
    const map = {};
    const st = S.load();
    for(const ds in st.tasks){
      if(ds < since) continue;
      (st.tasks[ds]||[]).forEach(t=>{
        const k = normTitle(t.title);
        if(!k) return;
        if(!map[k]) map[k] = { key:k, total:0, done:0, durs:[], sample:t.title };
        map[k].total++;
        if(t.done) map[k].done++;
        map[k].durs.push(t.duration||15);
      });
    }
    Object.keys(map).forEach(k=>{
      const m = map[k];
      m.rate = m.total? m.done/m.total : 0;
      m.avgDur = m.durs.length? Math.round(m.durs.reduce((a,b)=>a+b,0)/m.durs.length) : 15;
      delete m.durs;
    });
    _histCache = { days, map };
    return map;
  }
  /* 查某任务的历史表现（精确 → 包含匹配 → 无） */
  function historyOf(title){
    const map = taskHistoryMap();
    const k = normTitle(title);
    if(map[k]) return map[k];
    const hit = Object.keys(map).filter(x=> x.indexOf(k)>=0 || k.indexOf(x)>=0);
    if(hit.length){
      let t=0,d=0;
      hit.forEach(x=>{ t+=map[x].total; d+=map[x].done; });
      return { key:k, total:t, done:d, rate: t? d/t : 0, avgDur: map[hit[0]].avgDur, fuzzy:true };
    }
    return null;
  }

  /* =========================================================
     ②  精力模型：生理节律 × 个人时段效率 × 今日疲劳
     ========================================================= */
  const BASE_ENERGY = { deepNight:18, earlyMorning:58, morning:92, noon:52,
                        afternoon:78, evening:68, night:42 };

  function energyModel(dateStr, hour){
    const now = hour==null ? new Date().getHours() : hour;
    const slot = B.timeSlotOf(now);
    const sp = slotProfile();
    const spMap = {}; sp.forEach(x=> spMap[x.slot] = x);
    // 今日已投入时长 → 疲劳衰减
    const ds = dateStr || S.fmtDate(S.today());
    const arr = S.tasksOf(ds);
    const doneMin = arr.filter(t=>t.done).reduce((s,t)=> s + (t.duration||15), 0);
    const fatigue = Math.min(26, Math.round(doneMin/3.2));
    const curve = SLOT_KEYS.map(k=>{
      const base = BASE_ENERGY[k];
      const lift = (spMap[k] && spMap[k].lift) || 0;
      return { slot:k, cn:SLOT_CN[k], base, lift,
               en: clamp(Math.round(base + lift - (k===slot? fatigue : fatigue*0.5)), 5, 100) };
    });
    const cur = curve.find(x=> x.slot===slot) || curve[2];
    const level = cur.en>=75? 'high' : cur.en>=50? 'mid' : cur.en>=30? 'low' : 'depleted';
    const LEVEL_CN = { high:'充沛', mid:'尚可', low:'偏低', depleted:'见底' };
    let peak = curve.slice().sort((a,b)=> b.en-a.en)[0];
    return {
      slot, slotCN:SLOT_CN[slot], energy:cur.en, level, levelCN:LEVEL_CN[level],
      curve, doneMin, fatigue,
      peakSlot: peak.slot, peakCN: peak.cn, peakEn: peak.en,
      note: cur.en>=75 ? '现在精力充沛，适合啃硬骨头。'
          : cur.en>=50 ? '状态还行，按部就班推进即可。'
          : cur.en>=30 ? '精力有点下来了，挑轻的做，别开新的大工程。'
          : '精力见底了。今天剩下的任务要么缩水，要么明天再说。'
    };
  }

  /* =========================================================
     ③  负荷指数：今天排的活儿，是超载还是喂不饱
     ========================================================= */
  const CAPACITY = { weekday:180, weekend:240 };   // 学生作息下的可用专注分钟
  function loadIndex(dateStr){
    const ds = dateStr || S.fmtDate(S.today());
    const d = new Date(ds+'T00:00:00');
    const isWeekend = d.getDay()===0 || d.getDay()===6;
    const arr = S.tasksOf(ds).filter(t=> !t.done);
    const minutes = arr.reduce((s,t)=> s + (t.duration||15), 0);
    const capacity = isWeekend? CAPACITY.weekend : CAPACITY.weekday;
    const ratio = capacity? minutes/capacity : 0;
    const level = ratio>=1.25? 'overload' : ratio>=0.95? 'heavy' : ratio>=0.45? 'fit' : 'light';
    const LEVEL_CN = { overload:'超载', heavy:'偏重', fit:'刚好', light:'偏轻' };
    const NOTE = {
      overload:'今天排的量明显超出能承受的范围，硬撑只会全盘崩。砍掉三成，剩下的才做得完。',
      heavy:'量给得偏重，做的时候记得先挑重要的，做不完别内疚。',
      fit:'今天的量刚刚好，按序推进就能收官。',
      light:'今天排得偏轻，有余力可以加一子，或者把明天的活儿提前挪一点过来。'
    };
    const hist = weekdayProfile(28).prof[d.getDay()];
    return { date:ds, minutes, capacity, ratio:r1(ratio), level, levelCN:LEVEL_CN[level],
             note:NOTE[level], count:arr.length, isWeekend,
             weekdayRate: hist && hist.rate!=null? hist.rate : null };
  }

  /* =========================================================
     ④  预测引擎：用历史推未来（指数衰减加权 + 星期因子 + 负荷 + 趋势）
     ========================================================= */

  /* 指数衰减加权完成率：越近的天权重越大，避免一个月前的表现拖累今天的判断 */
  function weightedRate(days, decay){
    decay = decay || 0.88;
    const rows = dayStats(days).filter(x=> x.total>0);
    if(!rows.length) return null;
    let w=0, wt=0;
    for(let i=rows.length-1, k=0; i>=0; i--, k++){
      const p = Math.pow(decay, k);
      w += p * rows[i].total; wt += p * rows[i].done;
    }
    return w? wt/w : null;
  }

  /* 预测某一天能完成多少（有任务量时给条数，没任务量时给比率） */
  function forecastDay(dateStr){
    const d = new Date(dateStr+'T00:00:00');
    const wd = d.getDay();
    const base = weightedRate(14) || weightedRate(7) || 0.7;
    const wp = weekdayProfile(28);
    const wf = (wp.prof[wd] && wp.prof[wd].factor!=null)? wp.prof[wd].factor : 1;
    const li = loadIndex(dateStr);
    const loadF = li.level==='overload'? 0.78 : li.level==='heavy'? 0.92 : li.level==='light'? 1.06 : 1;
    const c = B.context(dateStr);
    const trendF = c.trend==='up'? 1.06 : c.trend==='down'? 0.9 : 1;
    const emoF = c.emo.level==='alert'? 0.85 : c.emo.level==='warn'? 0.94 : 1;
    const rate = clamp(base * wf * loadF * trendF * emoF, 0.05, 0.98);
    const total = S.tasksOf(dateStr).length;
    const factors = [];
    if(wf!==1) factors.push({k:'星期效应', v:wf, txt: wp.prof[wd].label + (wf>1?'向来比平时稳':'历史上偏容易掉')});
    if(loadF!==1) factors.push({k:'负荷', v:loadF, txt: li.levelCN + '（' + li.minutes + '/' + li.capacity + '分钟）'});
    if(trendF!==1) factors.push({k:'趋势', v:trendF, txt: c.trend==='up'?'近三天在往上走':'近三天在往下掉'});
    if(emoF!==1) factors.push({k:'情绪', v:emoF, txt:'近期情绪偏低'});
    return {
      date:dateStr, rate, expect: total? Math.round(total*rate) : null, total,
      base:pctN(base), level: rate>=0.8?'high': rate>=0.55?'mid':'low',
      factors
    };
  }

  /* 本周剩余天数预测：还差几子、预计能落几子 */
  function forecastWeek(){
    const dow = S.today().getDay();
    const mondayOffset = (dow===0? -6 : 1-dow);
    const mon = S.shiftDay(S.today(), mondayOffset);
    const days = [];
    let doneSum=0, totalSum=0, predSum=0, remainTotal=0;
    for(let i=0;i<7;i++){
      const d = S.shiftDay(mon, i);
      const ds = S.fmtDate(d);
      const arr = S.tasksOf(ds);
      const f = forecastDay(ds);
      const isPast = ds < S.fmtDate(S.today());
      const isToday = ds === S.fmtDate(S.today());
      days.push({ date:ds, label:S.weekdayShort[d.getDay()], total:arr.length,
                  done:arr.filter(t=>t.done).length, pred:f.rate, isPast, isToday });
      doneSum += arr.filter(t=>t.done).length;
      totalSum += arr.length;
      if(!isPast){ remainTotal += arr.length; predSum += arr.length * f.rate; }
    }
    return {
      days, doneSum, totalSum,
      weekRate: totalSum? doneSum/totalSum : 0,
      remainTotal, predRemain: Math.round(predSum),
      predWeekTotal: doneSum + Math.round(predSum),
      predWeekRate: totalSum? (doneSum + predSum)/totalSum : 0,
      verdict: (totalSum && (doneSum+predSum)/totalSum >= 0.8)? '这一周大概率收得漂亮。'
             : (totalSum && (doneSum+predSum)/totalSum >= 0.55)? '这周中规中矩，能过线。'
             : '这周偏悬，建议主动砍掉一部分任务，保住主线。'
    };
  }

  /* 目标达成预测：按当前速度算「还要多久」+「来不来得及」+「需要多快」 */
  function forecastGoal(g){
    if(!g) return null;
    const h = B.goalHealth(g);
    const totalWeeks = B.goalTotalWeeks ? B.goalTotalWeeks(g) : (h.totalDays/7);
    const weeklyDays = g.weeklyDays || 5;
    // 该目标历史完成的任务数（完成量代理进度）
    let doneTasks = 0, totalTasks = 0;
    const st = S.load();
    for(const ds in st.tasks){
      (st.tasks[ds]||[]).forEach(t=>{
        if(t.goalId!==g.id) return;
        totalTasks++; if(t.done) doneTasks++;
      });
    }
    // 近 14 天日均完成速度（条/天）
    let recent = 0;
    for(let i=0;i<14;i++){
      const ds = S.fmtDate(S.shiftDay(S.today(), -i));
      recent += (st.tasks[ds]||[]).filter(t=> t.goalId===g.id && t.done).length;
    }
    const speed = r1(recent/14 || 0.3);
    const needTotal = Math.max(1, Math.round(totalWeeks * weeklyDays));
    const remainTasks = Math.max(0, needTotal - doneTasks);
    const daysNeed = speed>0? Math.round(remainTasks/speed) : 999;
    const arrive = S.fmtDate(S.shiftDay(S.today(), Math.min(daysNeed, 3650)));
    const deadline = S.fmtDate(new Date(new Date(g.createdAt+'T00:00:00').getTime() + totalWeeks*7*86400000));
    const daysToDeadline = Math.max(0, Math.round((new Date(deadline+'T00:00:00') - S.today())/86400000));
    const needSpeed = daysToDeadline>0? r1(remainTasks/daysToDeadline) : remainTasks;
    const late = daysNeed - daysToDeadline;
    const verdict = g.status==='done' ? 'done'
                  : late <= 0 ? 'safe'
                  : late <= Math.max(7, daysToDeadline*0.35) ? 'tight'
                  : 'risk';
    const VERDICT_CN = { done:'已达成', safe:'按当前节奏来得及', tight:'时间紧，得加把劲', risk:'照这个速度会延期' };
    return {
      goal:g, health:h, totalWeeks, weeklyDays,
      doneTasks, needTotal, remainTasks, speed, daysNeed, arrive,
      deadline, daysToDeadline, needSpeed, late, verdict, verdictCN:VERDICT_CN[verdict],
      progress: Math.round(h.progRatio*100), timePast: Math.round(h.timeRatio*100),
      tip: verdict==='safe' ? '按现在的速度走，不用加码，稳住就行。'
         : verdict==='tight' ? ('每天需要完成约 ' + needSpeed + ' 项（你现在是 ' + speed + ' 项/天），差一点点，把碎片时间用上就够了。')
         : verdict==='risk' ? ('要么加量，要么把目标拆小——我建议后者：先把范围缩到最小能交付的样子，别让整条线停摆。')
         : '这个目标已经拿下了。'
    };
  }

  /* 连续天数续接概率：今天还能不能保住「连续」 */
  function forecastStreak(){
    const u = S.load().undercover;
    const ds = S.fmtDate(S.today());
    const arr = S.tasksOf(ds);
    const doneN = arr.filter(t=>t.done).length;
    if(doneN>0) return { hold:true, prob:1, doneN, note:'今天已经落子，连续天数稳了。' };
    // 未完成数 & 剩余精力 & 时段 & 历史「当天至少完成1项」概率
    const undone = arr.filter(t=>!t.done);
    const em = energyModel();
    let daysWithTask=0, daysDone=0;
    for(let i=1;i<=30;i++){
      const d = S.fmtDate(S.shiftDay(S.today(), -i));
      const a = S.tasksOf(d);
      if(a.length){ daysWithTask++; if(a.some(t=>t.done)) daysDone++; }
    }
    const histP = daysWithTask? daysDone/daysWithTask : 0.6;
    const energyF = em.energy>=70? 1.1 : em.energy>=45? 1 : em.energy>=28? 0.8 : 0.55;
    const countF = undone.length===0? 0.2 : undone.length<=3? 1.05 : undone.length<=6? 0.95 : 0.8;
    const prob = clamp(histP * energyF * countF, 0.05, 0.97);
    let note;
    if(!undone.length) note = '今天没有待办，连续天数会断。随手加一个 5 分钟的小任务就能接上。';
    else if(prob>=0.75) note = '今天保住连续天数的概率约 ' + pctN(prob) + '%，把最轻的那一项先做了就稳。';
    else if(prob>=0.45) note = '今天保住连续天数的概率约 ' + pctN(prob) + '%。还剩 ' + undone.length + ' 项，挑最短的那项先落。';
    else note = '今天保住连续天数的概率只有约 ' + pctN(prob) + '%。别硬撑——哪怕只做 5 分钟，也算在局里。';
    return { hold:false, prob, doneN:0, undone:undone.length, histP, energyF, countF, note };
  }

  /* 汇总预测（给周报 / 会客厅用） */
  function forecastAll(){
    const tm = S.fmtDate(S.shiftDay(S.today(), 1));
    return {
      tomorrow: forecastDay(tm),
      week: forecastWeek(),
      streak: forecastStreak(),
      goals: S.load().goals.filter(g=>g.status!=='done').map(forecastGoal),
      energy: energyModel(),
      load: loadIndex()
    };
  }

  /* =========================================================
     ⑤  顺路算法：地点归一 + 多因子打分 + 推荐理由
     ========================================================= */
  const LOC_ALIAS = {
    '图书馆':['图书馆','图书','自习室','图文','借阅','阅览室','书店','书城'],
    '打印店':['打印店','打印','文印','复印','打印资料'],
    '超市':['超市','便利店','商场','市场','菜市场','生鲜','水果店'],
    '健身房':['健身房','操场','体育馆','球场','健身','跑步'],
    '学校':['学校','校区','教室','教学楼','学院','班'],
    '公司':['公司','单位','办公室','工位'],
    '家':['在家','家里','回家','宿舍','寝室','住处'],
    '食堂':['食堂','餐厅','饭堂','吃饭'],
    '地铁':['地铁','公交','车站','路上','通勤','车上'],
    '咖啡厅':['咖啡厅','咖啡','奶茶店','茶室','星巴克']
  };
  function canonLoc(raw){
    const s = String(raw||'').trim();
    if(!s) return '';
    for(const k in LOC_ALIAS){
      if(s === k) return k;
      if(LOC_ALIAS[k].some(a=> s.indexOf(a)>=0)) return k;
    }
    return s;
  }
  /* 地点 → 该做的事（静态库，作为候选池之一，再由算法排序） */
  const BYWAY_LIB = {
    '图书馆':[
      {title:'借/还备考用书', duration:15, type:'byway', kws:['书','资料','真题','备考']},
      {title:'安静处背30个高频词', duration:15, type:'fragment', kws:['单词','背','词汇']},
      {title:'做1篇阅读真题（限时）', duration:25, type:'evening', kws:['阅读','真题']},
      {title:'整理本周错题到笔记', duration:20, type:'fragment', kws:['错题','整理','笔记']},
      {title:'查一份考公岗位信息', duration:15, type:'fragment', kws:['考公','岗位','编制']}
    ],
    '打印店':[
      {title:'打印六级真题 / 资料', duration:10, type:'byway', kws:['打印','真题','资料']},
      {title:'复印笔记 / 错题集', duration:10, type:'byway', kws:['笔记','错题','复印']},
      {title:'打印简历 / 证件照版式', duration:10, type:'byway', kws:['简历','证件']}
    ],
    '超市':[
      {title:'采购低卡零食（酸奶/小番茄）', duration:10, type:'byway', kws:['低卡','零食','酸奶','减重','体重']},
      {title:'买水果与早餐食材', duration:15, type:'byway', kws:['水果','早餐','吃','饮食']},
      {title:'顺路买日用品', duration:10, type:'byway', kws:['日用','生活']}
    ],
    '健身房':[
      {title:'有氧30分钟（快走/椭圆机）', duration:30, type:'byway', kws:['有氧','运动','减重','快走']},
      {title:'拉伸与体态训练10分钟', duration:10, type:'evening', kws:['拉伸','体态','塑形']}
    ],
    '学校':[
      {title:'顺路问老师 / 同学一个疑问', duration:10, type:'fragment', kws:['疑问','问','请教']},
      {title:'交材料 / 办手续', duration:10, type:'byway', kws:['材料','手续','交']}
    ],
    '公司':[
      {title:'碎片时间复盘今日任务', duration:10, type:'fragment', kws:['复盘','任务']},
      {title:'午休时背10个单词', duration:10, type:'fragment', kws:['单词','背']}
    ],
    '家':[
      {title:'居家拉伸 / 靠墙站10分钟', duration:10, type:'evening', kws:['拉伸','体态','运动']},
      {title:'整理桌面与明日材料', duration:10, type:'fragment', kws:['整理','桌面','明日']}
    ],
    '食堂':[
      {title:'记录这餐吃了什么', duration:5, type:'habit', kws:['饮食','记录','吃','体重']},
      {title:'少油少糖，先吃菜再吃饭', duration:5, type:'habit', kws:['饮食','减重','体重']}
    ],
    '地铁':[
      {title:'地铁上过一遍单词（10个）', duration:10, type:'fragment', kws:['单词','背','词汇']},
      {title:'听一段英语音频磨耳朵', duration:15, type:'fragment', kws:['听力','听','英语']},
      {title:'想清楚今天第一件要做的事', duration:5, type:'fragment', kws:['计划','安排','今日']}
    ],
    '咖啡厅':[
      {title:'专注25分钟做最难的一件', duration:25, type:'evening', kws:['专注','番茄','做']},
      {title:'写3行今日复盘', duration:10, type:'habit', kws:['复盘','总结','日记']}
    ]
  };

  /* 顺路引擎：返回带「顺路度 + 推荐理由」的候选列表 */
  function bywayEngine(place){
    const raw = String(place||'').trim();
    if(!raw) return { place:raw, loc:'', items:[], note:'' };
    const loc = canonLoc(raw);
    const lib = BYWAY_LIB[loc] || [];
    const st = S.load();
    const goals = st.goals.filter(g=> g.status!=='done');
    const hist = taskHistoryMap();
    const todayStr = S.fmtDate(S.today());
    const todayTitles = S.tasksOf(todayStr).map(t=> normTitle(t.title));
    const cand = [];

    // 候选 1：静态库（按目标关联度 + 关键词命中打分）
    lib.forEach(item=>{
      cand.push({ title:item.title, duration:item.duration, type:item.type,
                  location:loc, source:'lib', kws:item.kws||[] });
    });
    // 候选 2：未排程清单里提到该地点/关键词的任务
    S.unscheduled().forEach(t=>{
      const hit = (t.location && t.location.indexOf(loc)>=0)
               || t.title.indexOf(loc)>=0
               || (lib.some(l=> (l.kws||[]).some(k=> t.title.indexOf(k)>=0)));
      if(hit) cand.push({ title:t.title, duration:t.duration||15, type:t.type||'fragment',
                          location:t.location||loc, source:'route-inbox', _id:t.id,
                          goalId:t.goalId||null, kws:[] });
    });
    // 候选 3：历史上常做的同地点任务（你在这个地方通常干什么）
    for(const ds in st.tasks){
      (st.tasks[ds]||[]).forEach(t=>{
        if(!t.done) return;
        if(t.location && canonLoc(t.location)===loc){
          cand.push({ title:t.title, duration:t.duration||15, type:t.type||'fragment',
                      location:loc, source:'history', kws:[] });
        }
      });
    }

    // 去重（标题归一后相同只保留分高的）
    const seen = {};
    const uniq = [];
    cand.forEach(c=>{
      const k = normTitle(c.title);
      if(seen[k]) return;
      seen[k] = 1; uniq.push(c);
    });

    const scored = uniq.map(c=>{
      const norm = normTitle(c.title);
      // ① 目标关联度：命中哪个目标 + 该目标紧迫度
      let goalScore = 0, goalName = '', goalId = c.goalId || null;
      goals.forEach(g=>{
        const gh = B.goalHealth(g);
        const nameHit = c.title.indexOf(g.title.slice(0,2))>=0;
        const kwHit = (c.kws||[]).some(k=> (g.title||'').indexOf(k)>=0 || (g.resources||'').indexOf(k)>=0);
        if(nameHit || kwHit){
          const urgency = gh.state==='danger'? 34 : gh.state==='behind'? 26 : gh.state==='ontrack'? 16 : 10;
          if(urgency > goalScore){ goalScore = urgency; goalName = g.title; goalId = g.id; }
        }
      });
      // ② 地点/关键词匹配度
      const kwMatch = (c.kws||[]).some(k=> raw.indexOf(k)>=0)? 22 : 14;
      const locMatch = c.location===loc? 12 : 4;
      // ③ 历史完成率：这类事你过去做得多不多
      const h = historyOf(c.title);
      const histScore = h? Math.round(h.rate*18) : 9;
      // ④ 时长适配：碎片时间优先（顺路做的事不该太久）
      const fitScore = (c.duration<=15)? 12 : (c.duration<=25)? 9 : 5;
      // ⑤ 今日已有则不重复推荐
      const dupPenalty = todayTitles.indexOf(norm)>=0? -30 : 0;

      const score = clamp(Math.round(goalScore + kwMatch + locMatch + histScore + fitScore + dupPenalty), 0, 100);
      const reasons = [];
      if(goalName) reasons.push('推进「' + goalName + '」');
      if(h) reasons.push('这类事你过去完成率 ' + pctN(h.rate) + '%');
      // 候选的 source 只有 'lib' | 'route-inbox' | 'history'（见上面候选池构造），
      // 原来这里写的是 'inbox'，永远不成立，导致「你的待安排清单里已有」这句推荐理由
      // 从来没显示过。改为 'route-inbox' 才对得上 INBOX 里收进来的候选。
      if(c.source==='route-inbox' || c.source==='inbox') reasons.push('你的待安排清单里已有');
      if(c.source==='history') reasons.push('你在这个地方常做');
      if(c.duration<=15) reasons.push(c.duration + ' 分钟可搞定');
      return { ...c, score, goalName, goalId, reason: reasons.join(' · ') };
    })
    .filter(x=> x.score > 20)
    .sort((a,b)=> b.score - a.score)
    .slice(0, 6);

    // 顺路链：把同地点的事打包成一条路线
    const chain = scored.slice(0,3);
    const chainMin = chain.reduce((s,x)=> s + x.duration, 0);
    let note = '';
    if(!scored.length) note = '这个地方我还没有对应的任务模板。说一句话告诉我你要做什么，我给你排进去。';
    else if(chain.length>=2) note = '建议一次性办完前 ' + chain.length + ' 件，约 ' + chainMin + ' 分钟，跑一趟就够。';
    else note = '顺手做掉这一件，不额外占时间。';
    return { place:raw, loc, items:scored, chain, chainMin, note };
  }

  /* =========================================================
     ⑥  拆解 V2：语义模板 × 时长自适应 × 难度自适应
     ========================================================= */
  const DECOMP = [
    { re:/背|单词|词汇|记|默写/, steps:[
      ['先把今天的词表过一遍，只看不背', 0.2],
      ['遮住释义自测一遍，标出卡住的', 0.3],
      ['只攻标出来的那几个，每个造一个句子', 0.3],
      ['收尾：把还没记住的抄一遍，明天优先过', 0.2] ] },
    { re:/听力|精听|连读|听写|磨耳朵/, steps:[
      ['整段盲听一遍，不暂停，只抓大意', 0.15],
      ['第二遍逐句暂停，写下听到的词', 0.35],
      ['对照原文，标出连读和弱读处', 0.25],
      ['跟读标出来的那几句，模仿语音语调', 0.25] ] },
    { re:/阅读|真题|刷题|卷|篇章/, steps:[
      ['先看题干，圈出关键词', 0.15],
      ['回原文定位，找到对应句再做题', 0.45],
      ['对答案，标出错题', 0.15],
      ['挑 2 道错题搞懂，写下卡住的原因', 0.25] ] },
    { re:/写作|作文|句型|模板|仿写/, steps:[
      ['确定题目类型，选一个可用框架', 0.15],
      ['列出 3 个论点/要点，不展开', 0.2],
      ['按框架写出来，先完成再修改', 0.45],
      ['对照范文改 2 处表达', 0.2] ] },
    { re:/翻译|汉译英|语序/, steps:[
      ['通读原句，划出主干', 0.2],
      ['先直译一遍，不管顺不顺', 0.35],
      ['调整语序和用词，让它像人话', 0.3],
      ['对照参考译文，记下 2 个差异点', 0.15] ] },
    { re:/口语|跟读|发音|开口/, steps:[
      ['选一段材料，先听两遍', 0.2],
      ['逐句跟读，录音', 0.4],
      ['回放对比，标出读得不像的地方', 0.2],
      ['再跟读一遍，只练标出来的几句', 0.2] ] },
    { re:/操作题|excel|word|ppt|上机|函数/, steps:[
      ['看一遍操作步骤要点，不急着做', 0.15],
      ['照着教程做一遍，不求快', 0.4],
      ['脱稿重做一遍，卡住的地方记下来', 0.3],
      ['只练卡住的那个步骤 3 遍', 0.15] ] },
    { re:/选择题|公共基础|知识点|常识/, steps:[
      ['快速刷一遍，会的直接过', 0.3],
      ['不确定的做标记，先蒙一个', 0.3],
      ['只看标记题的答案和解析', 0.25],
      ['把错的抄进错题本，写一句为什么', 0.15] ] },
    { re:/行测|判断推理|资料分析|数量关系/, steps:[
      ['先做会做的模块，把分拿到手', 0.35],
      ['回头啃标记题，控制每题时间', 0.35],
      ['对答案，按题型归类错题', 0.2],
      ['挑一类错题，弄懂它的通用解法', 0.1] ] },
    { re:/申论|大作文|卷面|练字|书写/, steps:[
      ['先练 5 行字，把手写热', 0.2],
      ['读材料，划出关键句', 0.25],
      ['按「是什么-为什么-怎么办」列提纲', 0.25],
      ['写成一段，检查有没有落在材料上', 0.3] ] },
    { re:/面试|结构化|仪态|表达/, steps:[
      ['对着镜子练 1 分钟自我介绍', 0.25],
      ['练 2 道结构化题，录音', 0.4],
      ['回听，改掉口头禅和卡顿', 0.2],
      ['站姿练习 3 分钟，靠墙站', 0.15] ] },
    { re:/散步|跑步|快走|运动|锻炼|走路/, steps:[
      ['换好鞋出门，别想太多', 0.05],
      ['前段慢速，让身体热起来', 0.25],
      ['中段保持能说话的强度', 0.5],
      ['收尾放慢，顺手把路过了了', 0.2] ] },
    { re:/拉伸|体态|靠墙站|塑形|核心/, steps:[
      ['热身 2 分钟，别直接拉', 0.15],
      ['按顺序做一遍动作，每个到位', 0.5],
      ['最酸的地方多停 30 秒', 0.2],
      ['结束后靠墙站 3 分钟，找正确的姿势感', 0.15] ] },
    { re:/饮食|记录|热量|吃了什么/, steps:[
      ['回忆今天吃了什么，逐条写下来', 0.4],
      ['标出高油高糖的那几样', 0.25],
      ['给明天的三餐定一个大概', 0.35] ] },
    { re:/复盘|总结|回顾|日记/, steps:[
      ['今天完成了什么（1 行）', 0.3],
      ['哪里卡住了（1 行）', 0.3],
      ['明天先做什么（1 行）', 0.4] ] },
    { re:/整理|收拾|归档|资料/, steps:[
      ['先把所有东西摊开，看清总量', 0.2],
      ['按「留 / 扔 / 待定」分三堆', 0.35],
      ['只处理「留」的这堆，归位', 0.35],
      ['「待定」的装袋，标个日期', 0.1] ] },
    { re:/查|搜索|调研|了解|收集/, steps:[
      ['写下你到底要找什么（一句话）', 0.15],
      ['先查官方/一手来源', 0.4],
      ['再查经验帖交叉验证', 0.3],
      ['把结论记下来，附上来源', 0.15] ] },
    { re:/打印|复印|取|买|寄|办|交/, steps:[
      ['确认要带什么（文件/证件/钱）', 0.25],
      ['顺路去办', 0.5],
      ['办完立刻记一笔，别攒着', 0.25] ] },
    { re:/代码|编程|算法|bug|调试/, steps:[
      ['复现问题，确认现象', 0.2],
      ['定位到最小的一段代码', 0.35],
      ['改掉，验证一次', 0.25],
      ['记下原因，避免再踩', 0.2] ] },
    { re:/数学|高数|公式|线代|概率/, steps:[
      ['先把公式抄一遍，确认记得', 0.2],
      ['做一道最基础的题，找手感', 0.3],
      ['做两道中等题，卡住就看解析', 0.35],
      ['总结这类题的套路，一句话', 0.15] ] },
    { re:/看课|听课|视频|网课|教程/, steps:[
      ['先看目录，知道这节课讲什么', 0.15],
      ['1.2 倍速过一遍，不暂停', 0.4],
      ['卡住的地方倒回去重看', 0.25],
      ['合上视频，自己复述一遍重点', 0.2] ] },
    { re:/笔记|错题本|整理错题/, steps:[
      ['把今天的错题摊开', 0.2],
      ['按「概念错 / 计算错 / 看错题」分类', 0.35],
      ['每类挑 1 道写清楚正确思路', 0.35],
      ['标个复习日期，过几天再看', 0.1] ] },
    { re:/计划|安排|排程|规划|布局/, steps:[
      ['列出所有想做的事，不排序', 0.25],
      ['标出真正重要的三件', 0.25],
      ['把这三件排进具体时段', 0.35],
      ['其余的放进「待安排」，别挤进来', 0.15] ] },
    { re:/睡|作息|早起|休息/, steps:[
      ['定一个上床时间，提前 30 分钟开始收尾', 0.3],
      ['手机放到够不着的地方', 0.2],
      ['躺下后做 5 次深呼吸', 0.25],
      ['明早的闹钟放在必须起身的位置', 0.25] ] }
  ];

  /* 把时长按比例切成每步的分钟数，并做难度自适应 */
  function decomposeV2(t){
    if(!t) return { title:'', steps:[], total:0 };
    const title = t.title||'';
    const dur = t.duration || 15;
    const low = title.toLowerCase();
    let tmpl = null;
    for(const d of DECOMP){ if(d.re.test(low) || d.re.test(title)){ tmpl = d; break; } }
    if(!tmpl){
      tmpl = { steps:[ ['先把要用的东西准备好', 0.15],
                       ['做最容易的那部分，先启动', 0.35],
                       ['啃中间最难的一段', 0.35],
                       ['收尾，把没做完的写清楚交给明天', 0.15] ] };
    }
    // 步数按时长自适应：短任务别拆太碎，长任务多给一层
    let n = dur<=10? 2 : dur<=25? 3 : dur<=45? 4 : 5;
    n = clamp(n, 2, tmpl.steps.length);
    const chosen = tmpl.steps.slice(0, n);
    const wsum = chosen.reduce((s,x)=> s + x[1], 0);
    // 难度自适应：这类任务历史完成率低 → 第一步砍到极小，降低启动门槛
    const h = historyOf(title);
    const hard = h && h.total>=3 && h.rate<0.5;
    const steps = chosen.map((x,i)=>{
      let min = Math.max(1, Math.round(dur * x[1] / wsum));
      if(hard && i===0) min = Math.max(1, Math.min(3, min));
      return { text:x[0], min };
    });
    if(hard) steps[0].text = '只做 2 分钟，把东西摆开就算赢 —— 这类事你过去常卡在开头';
    const total = steps.reduce((s,x)=> s + x.min, 0);
    return {
      title, steps, total,
      hist: h? { total:h.total, rate:h.rate } : null,
      hard: !!hard,
      note: hard? '这类任务你历史完成率只有 ' + pctN(h.rate) + '%，我把第一步砍到最小——只要开始，后面就顺了。'
                : (dur>=40? '任务偏大，先做完第 1 步，别想着一口气干完。' : '')
    };
  }

  /* =========================================================
     ⑦  建议 V2：主题扩到 30+，叠加领域知识与历史表现
     ========================================================= */
  const ADVICE2 = {
    '阅读':{
      base:['阅读先题后文：先圈题干关键词，回原文定位，别通篇读。',
            '限时从 12 分钟压到 9 分钟，先把速度感练出来。',
            '错题先自己回原文找依据，找得到才是真懂。'],
      '做不完':['先保「会做的」：跳过卡住的那道，做完再回头补。','每天只练一篇限时，练节奏不练数量。'],
      '太难':['长难句单独练：先划主干，修饰成分全划掉。','先做最简单的那篇，把正确率的手感找回来。'],
      '没反馈':['改个衡量方式：不数对了几题，数「定位句找对了几次」。','同一篇做第二遍，正确率提升就是进步证据。']
    },
    '写作':{
      base:['先搭框架再填内容，框架占一半分。','积累 2 个万能句型，明天仿写一段。','写完放一小时再改，比当场改有效得多。'],
      '太难':['先只写 3 个要点，不展开，把骨架立起来。','直接套模板写一遍，再想着怎么改。'],
      '没反馈':['找一篇范文，只模仿它的开头和结尾。','把写过的同一题目放一周后重写，对比一下。']
    },
    '翻译':{
      base:['先直译再调语序，别一边译一边改。','每天译一段，控制在 15 分钟内。','译完对照参考，记下 2 个表达差异。'],
      '太难':['先把主干译出来，修饰成分先不管。','拆成两句短句译，别硬凑长句。']
    },
    '口语':{
      base:['每天跟读 10 分钟，比一周一次强得多。','录音回听，进步听得见。','先求流利再求准确，别边说边纠正。'],
      '听不懂':['先听慢速材料，把耳朵的信心建起来。','同一段连听三天，第三天会明显不一样。']
    },
    '操作题':{
      base:['操作题按步骤给分，先保流程完整，再练速度。','把常考操作录成自己的步骤清单，考前只看这个。','同一道题做三遍：看教程做→半脱稿做→完全脱稿做。'],
      '太难':['先只练一类操作，练熟再换下一类。','把操作拆成 5 个小步骤，每次只练一步。','对着视频暂停做，别凭记忆硬试。'],
      '记不住':['把步骤抄一遍，手写比看十遍有用。','连续三天做同一道题，形成肌肉记忆。']
    },
    '选择题':{
      base:['选择题靠碎片积累，每天 15 分钟，别贪多。','错题归类记「知识点」，别只记答案。','考前只过自己的错题本。'],
      '记不住':['把易混知识点写成对比表，一眼看出差别。','每天只攻一类，连攻三天。']
    },
    '行测':{
      base:['行测靠手感，每天刷一组保持热度。','先练正确率再练速度，顺序反了两头空。','错题记「题型+卡点」，不是记答案。'],
      '做不完':['模块顺序调整一下：先做擅长的，把分拿到手。','每题设时间上限，到点就蒙一个走人。'],
      '没反馈':['分模块统计正确率，先补最差的那块。','每周做一次整套，只跟自己上周比。']
    },
    '申论':{
      base:['申论卷面分很贵，每天练几行字。','答案都在材料里，别自己编。','每周完整写一篇，写不完就写一道小题。'],
      '太难':['先练概括题，这是所有题型的基础。','照着参考答案抄一遍，找语感。']
    },
    '面试':{
      base:['每天对着镜子练 1 分钟自我介绍。','录音回听，改掉口头禅。','站姿和笑容也是分数，靠墙站练起来。'],
      '拖延':['先只练一道题，5 分钟就够。','找个同伴模拟，比自己练有压力也有效。']
    },
    '作息':{
      base:['睡好才能记牢，今晚早睡 30 分钟。','熬夜完成任务是透支，短期有效长期反噬。','把最难的任务挪到早上，晚上自然不用熬。'],
      '走神':['睡前 1 小时不刷手机，改看纸质书。','把手机充电器放到离床远的地方。']
    },
    '心态':{
      base:['天秤座别内耗：今天不需要做对选择，只需要做一件事。','你不需要完美，你只需要回来。','把「我做得好不好」换成「我今天落子了吗」。'],
      '拖延':['犹豫超过 30 秒就选第一个，行动会修正判断。','给自己设一个「5 分钟规则」：先做 5 分钟再说。']
    },
    '效率':{
      base:['25 分钟番茄钟，响铃就停，别硬撑。','手机放到看不见的地方，环境比意志力管用。','把最分心的 App 设成多一步才能打开。'],
      '走神':['先做 10 分钟，做完了想停就停。','准备一个「走神本」，想到别的先写下来。','换到图书馆，环境约束力远大于自制力。'],
      '拖延':['把任务缩到「不可能失败」的大小，比如只打开书。','告诉自己「只做 5 分钟就可以停」。']
    },
    '数学':{
      base:['先把公式推导一遍，理解比背诵耐用。','分题型刷，一类一类过，别跳着做。','错题重做三遍，比做新题值。'],
      '太难':['退回上一章，八成是前面的概念没通。','找一道最基础的题，把每一步写清楚。']
    },
    '代码':{
      base:['每天写一点，手感不能凉。','先跑通再优化，别一开始就追求优雅。','把报错信息完整读一遍，答案常在里面。'],
      '太难':['把问题缩小到最小可复现的一段。','先抄一遍能跑的代码，再改成自己的。']
    },
    '饮食':{
      base:['先喝一杯水再决定要不要吃，很多时候是渴不是饿。','备点低卡零食，饿的时候别硬扛。','晚餐少油少糖，换个做法就能省不少热量。'],
      '拖延':['先只记录一天吃了什么，不要求改变。','把零食换成小份装，控制总量不控制欲望。']
    },
    '运动':{
      base:['把运动绑在已有习惯上，比如「饭后必走」。','加到 35 分钟，比加强度更容易坚持。','不想动的时候先换上鞋，出门了就算赢。'],
      '拖延':['把目标降到「出门走 5 分钟」，通常走了就停不下来。','找个固定时间，让它变成日程而不是决定。']
    },
    '体重':{
      base:['一周称一次更准，也不容易被数字影响心情。','先从记录饮食开始，记录本身就是干预。','把目标换成行为：不是「瘦5斤」，是「每天走30分钟」。'],
      '没反馈':['平台期是身体在调整，别加码，保持住就是赢。','换个指标：量腰围、看裤子松紧。','检查晚餐碳水和睡眠，这两个最容易卡住减重。']
    },
    '目标':{
      base:['把大目标拆到「这周做什么」这一层，别停在「我想成为」。','每周定一个唯一重点，多了等于没有。','把进度写下来，看得见才稳得住。'],
      '迷茫':['先不想三年后，先想这周能做完的三件事。','写下「最坏会发生什么」，通常没那么可怕。']
    },
    '人际':{
      base:['ISFJ 容易把别人的情绪背在自己身上，记得划界限。','说不清楚就写下来，文字比当面更容易表达。','不舒服的时候，晚一天再回应，别在情绪里做决定。']
    },
    '金钱':{
      base:['先记一个月流水，知道钱去哪了才知道怎么攒。','把「想要」分三级，只买第一级。','每月固定存一小笔，金额不重要，习惯重要。']
    }
  };

  /* 领域知识：让建议带一点"为什么"，而不是只给动作 */
  const DOMAIN = {
    '听力':{ curve:'听力进步是台阶式的：前两周只听得见挫败，第三周会突然通一截。',
             metric:'别数听懂多少，数「抓到了几个熟悉词组」。' },
    '单词':{ curve:'单词靠重复次数，不靠单次时长。一天三次 5 分钟，胜过一次 30 分钟。',
             metric:'衡量标准：能主动想起来的词有几个，不是看过几遍。' },
    '阅读':{ curve:'阅读先提速度再提正确率，反过来会卡死。',
             metric:'每篇用时 + 定位句命中率。' },
    '写作':{ curve:'写作先有量再有质，前 10 篇只求写完。',
             metric:'每周写几段，比每篇改几遍更重要。' },
    '操作题':{ curve:'操作题是肌肉记忆，重复次数决定熟练度。',
             metric:'脱稿能做完几道题。' },
    '行测':{ curve:'行测正确率先到瓶颈，再靠速度拉开差距。',
             metric:'分模块正确率，而不是整套分数。' },
    '体重':{ curve:'减重前两周掉得快（水分），之后是平台期，别慌。',
             metric:'一周均值，别看单日数字。' },
    '运动':{ curve:'运动效果滞后 3-4 周才显现，前两周全靠习惯撑。',
             metric:'每周运动天数，而不是单次强度。' },
    '作息':{ curve:'作息调整需要 7-10 天，前三天会很难受。',
             metric:'固定起床时间，比入睡时间更重要。' },
    '效率':{ curve:'专注力是消耗品，每天真正高效的时间大约 4 小时。',
             metric:'每天完成的番茄数，不是坐在桌前的小时数。' }
  };

  /* 建议 V2：主题 → 阻碍 → 递进 → 领域知识加成 */
  function suggestV2(ex, dryRun){
    ex = ex || {};
    const topic = (ex.topics && ex.topics[0]) || null;
    const blocker = (ex.blockers && ex.blockers[0]) || null;

    let pool = null;
    if(topic && ADVICE2[topic]){
      pool = (blocker && ADVICE2[topic][blocker]) ? ADVICE2[topic][blocker] : ADVICE2[topic].base;
    }
    // brain 的旧库作为补充（覆盖 ADVICE2 没写的主题）
    if(!pool && topic && B.ADVICE && B.ADVICE[topic]){
      pool = (blocker && B.ADVICE[topic][blocker]) ? B.ADVICE[topic][blocker] : B.ADVICE[topic].base;
    }
    if(!pool && B.ADVICE_BY_MOOD && B.ADVICE_BY_MOOD[ex.emotion]) pool = B.ADVICE_BY_MOOD[ex.emotion];
    if(!pool) pool = ['继续记录，我会慢慢读懂你的节奏。'];

    const lv = topic? (S.adviceLevelOf(topic) || 0) : 0;
    const given = (S.recentAdvice(7)||[]).map(a=> a.text);
    let chosen = null, chosenLv = 1;
    for(let i=0;i<pool.length;i++){
      const idx = (lv + i) % pool.length;
      if(given.indexOf(pool[idx]) < 0){ chosen = pool[idx]; chosenLv = idx + 1; break; }
    }
    if(!chosen){
      const label = topic? ('「' + topic + '」') : '这件事';
      return { text: label + '我已经给了三条思路，再讲第四遍就是废话了。这一子该你落——挑最容易的那条，今天做完它。',
               topic, blocker, level: pool.length + 1, exhausted:true };
    }
    if(topic && !dryRun){
      S.pushAdvice({ id: topic + ':' + (blocker||'-'), topic, blocker, level: chosenLv, text: chosen });
    }
    // 领域知识加成：每三次给一次「为什么」，避免每天都复读同一句
    const dom = (topic && DOMAIN[topic]) ? (chosenLv % 2 === 0 ? DOMAIN[topic].curve : DOMAIN[topic].metric) : '';
    return { text: chosen, topic, blocker, level: chosenLv, domain: dom };
  }

  /* 主题词库扩充（brain 的 TOPIC_LEX 之外的补充） */
  const TOPIC_LEX2 = {
    '目标':  ['目标','计划','规划','方向','想成为','长远','人生'],
    '人际':  ['朋友','同学','室友','家人','爸妈','对象','吵架','关系','社交'],
    '金钱':  ['钱','花钱','存钱','记账','开销','生活费','兼职','赚钱'],
    '课程':  ['课','上课','网课','课件','作业','考试','期末','学分'],
    '资料':  ['资料','笔记','错题本','pdf','文档','文件','素材'],
    '身体':  ['身体','头疼','胃','生理期','不舒服','生病','药'],
    '环境':  ['宿舍','太吵','被打断','没地方','图书馆没位'],
    '娱乐':  ['刷手机','追剧','游戏','短视频','抖音','b站','摸鱼']
  };
  /* 抽取 V2：在 brain 抽取之上补充新主题 + 命中计数 */
  function extractV2(text){
    const ex = B.extract(text);
    const lower = String(text||'').toLowerCase();
    for(const k in TOPIC_LEX2){
      if(TOPIC_LEX2[k].some(w=> lower.indexOf(w)>=0)){
        if(ex.topics.indexOf(k)<0) ex.topics.push(k);
      }
    }
    ex.topicCount = ex.topics.length;
    ex.blockerCount = ex.blockers.length;
    return ex;
  }

  /* =========================================================
     ⑧  军师点评：多因子、带数据的复盘点评（替代原来的 4 句 if/else）
     ========================================================= */
  function reviewComment(dateStr){
    const ds = dateStr || S.fmtDate(S.today());
    const arr = S.tasksOf(ds);
    const done = arr.filter(t=>t.done);
    const undone = arr.filter(t=>!t.done);
    const rate = arr.length? done.length/arr.length : 0;
    const minutes = done.reduce((s,t)=> s + (t.duration||15), 0);
    const out = [];

    // (1) 完成度：跟自己近 14 天均值比，才知道今天是好是坏
    const base = weightedRate(14);
    if(arr.length===0){
      out.push({kind:'hint', text:'今天没有排任何任务。空一天不可怕，可怕的是连着空——明天至少排一子。'});
    } else if(base!=null){
      const diff = rate - base;
      if(diff >= 0.15) out.push({kind:'good', text:'今天完成 ' + done.length + '/' + arr.length + '（' + pctN(rate) + '%），比近两周的均值 ' + pctN(base) + '% 高出 ' + pctN(diff) + ' 个点。这是实打实的进步。'});
      else if(diff <= -0.2) out.push({kind:'bad', text:'今天完成 ' + done.length + '/' + arr.length + '（' + pctN(rate) + '%），比近两周的均值 ' + pctN(base) + '% 低了 ' + pctN(-diff) + ' 个点。不是批评，是提醒——明天减量，先守住节奏。'});
      else out.push({kind:'good', text:'今天完成 ' + done.length + '/' + arr.length + '（' + pctN(rate) + '%），跟你的常态 ' + pctN(base) + '% 基本持平。稳，就是最好的状态。'});
    } else {
      out.push({kind:'good', text:'今天完成 ' + done.length + '/' + arr.length + '。样本还少，我先记下这一笔。'});
    }

    // (2) 投入时长：做了多久，比做了几件更能说明问题
    if(minutes>0){
      const h = Math.floor(minutes/60), m = minutes%60;
      const timeTxt = h? (h + ' 小时 ' + m + ' 分') : (m + ' 分钟');
      out.push({kind:'good', text:'今天实际投入约 ' + timeTxt + '。' + (minutes>=90?'这个量已经超过大多数人一整天的专注时间。':minutes>=40?'够扎实，不用再苛责自己。':'量不大，但开始了就比停在原地强。')});
    }

    // (3) 时段分布：今天主要在什么时候做
    const slots = {};
    done.forEach(t=>{ if(t.doneAt){ const s = SLOT_CN[B.timeSlotOf(new Date(t.doneAt).getHours())]; slots[s]=(slots[s]||0)+1; } });
    const slotKeys = Object.keys(slots);
    if(slotKeys.length){
      const top = slotKeys.sort((a,b)=> slots[b]-slots[a])[0];
      out.push({kind:'hint', text:'今天主要在' + top + '落子（' + slots[top] + ' 项）。' + ((top==='夜晚'||top==='深夜')?'夜里能完成任务是本事，但代价是明天的状态。试着把最难的一件挪到早上。':'这个时段适合你，明天继续把硬骨头排在这里。')});
    }

    // (4) 未完成项：给出处理建议，而不是单纯列出来
    if(undone.length){
      const minTask = undone.slice().sort((a,b)=>(a.duration||15)-(b.duration||15))[0];
      out.push({kind:'hint', text:'还剩 ' + undone.length + ' 项没落。最短的是「' + minTask.title + '」（' + (minTask.duration||15) + ' 分钟）——想收个尾就先做它，不想做就明天再说，别硬撑。'});
    }

    // (5) 连续天数与预测
    const sf = forecastStreak();
    if(sf.hold){
      out.push({kind:'good', text:'连续落子 ' + (S.load().undercover.streak||0) + ' 天，今天已经保住了。'});
    } else {
      out.push({kind:'hint', text:sf.note});
    }

    // (6) 目标推进：今天动了哪条线
    const byGoal = {};
    done.forEach(t=>{ if(t.goalId) byGoal[t.goalId] = (byGoal[t.goalId]||0)+1; });
    const goalKeys = Object.keys(byGoal);
    if(goalKeys.length){
      const g = S.getGoal(goalKeys[0]);
      if(g) out.push({kind:'good', text:'「' + g.title + '」今天推进了 ' + byGoal[goalKeys[0]] + ' 子。' + (goalKeys.length>1?'另外还有 ' + (goalKeys.length-1) + ' 条线也动了，没有偏科。':'其他目标今天没动，明天匀一点过去。')});
    } else if(done.length){
      out.push({kind:'hint', text:'今天做的事没有挂在任何目标下。如果它们有意义，就立个目标；如果是杂事，那也该做——但别让它占满你的棋盘。'});
    }

    // (7) 情绪
    const notes = (S.load().notes||[]).filter(n=> n.date===ds);
    if(notes.length){
      const emo = notes[0].emotion;
      const NEG = ['anxious','tired','down','frustrated','lost','guilty','lonely','numb','stressed','angry','giveUp','exhausted'];
      out.push({kind: NEG.indexOf(emo)>=0? 'bad':'good',
        text: NEG.indexOf(emo)>=0 ? '今天的随记里情绪偏低。任务之外，也照顾一下自己——你比任何一子都重要。'
                                  : '今天的情绪是稳的。状态好的时候记住这个感觉，低谷时拿出来看看。'});
    }
    return out;
  }

  /* =========================================================
     ⑨  下周布局：按目标健康度分配配额 × 星期效应排布
     ========================================================= */
  function nextWeekLayout(baseDate){
    const base = baseDate || S.today();
    const dow = base.getDay();
    const mondayOffset = (dow===0? -6 : 1-dow);
    // 下一周的周一
    const nextMon = S.shiftDay(base, mondayOffset + 7);
    const wp = weekdayProfile(28);
    const goals = S.load().goals.filter(g=> g.status!=='done');

    // ① 目标配额：掉队的、会延期的目标多分配几天
    const fg = goals.map(forecastGoal).filter(Boolean);
    const W = { risk:4, tight:3, safe:2 };
    const weightSum = fg.reduce((s,x)=> s + (W[x.verdict]||2), 0) || 1;
    const alloc = fg.map(x=>{
      const w = W[x.verdict]||2;
      const days = Math.max(1, Math.round(w/weightSum * 6));
      return { goal:x.goal, title:x.goal.title, verdict:x.verdict, verdictCN:x.verdictCN,
               days, share: Math.round(w/weightSum*100),
               reason: x.verdict==='risk' ? ('照当前 ' + x.speed + ' 项/天的速度会延期约 ' + x.late + ' 天，下周必须多给它几天。')
                     : x.verdict==='tight' ? ('时间紧，需要日均 ' + x.needSpeed + ' 项，保持住现在的投入。')
                     : ('节奏健康，按常规排程即可，余量可以匀给别的线。') };
    }).sort((a,b)=> b.days - a.days);

    // ② 星期排布：历史低谷日减量，高效日压重担
    const days = [];
    for(let i=0;i<7;i++){
      const d = S.shiftDay(nextMon, i);
      const ds = S.fmtDate(d);
      const wd = d.getDay();
      const p = wp.prof[wd];
      const factor = (p && p.factor!=null)? p.factor : 1;
      const isWeekend = wd===0 || wd===6;
      let quota = isWeekend? 2 : 4;
      if(factor < 0.9) quota -= 1;
      if(factor > 1.1) quota += 1;
      quota = clamp(quota, 1, 6);
      let note;
      if(p && p.factor!=null && factor < 0.9) note = S.weekdayCN[wd] + '是你的历史低谷（' + pctN(p.rate) + '%），下周这天只排 ' + quota + " 项，别硬塞。";
      else if(p && p.factor!=null && factor > 1.1) note = S.weekdayCN[wd] + '你向来稳（' + pctN(p.rate) + '%），把最难的一件放这天。';
      else if(isWeekend) note = S.weekdayCN[wd] + '是休息日，只留 ' + quota + " 项轻量任务，别把周末也塞满。";
      else note = S.weekdayCN[wd] + '按常规排 ' + quota + ' 项。';
      days.push({ date:ds, label:S.weekdayCN[wd], wd, quota, factor, note, isWeekend });
    }

    // ③ 附加策略
    const notes = [];
    const diff = B.difficultySuggest();
    notes.push('强度：' + diff.note);
    const em = B.context();
    if(em.bestSlotCN) notes.push('把需要动脑的排在' + em.bestSlotCN + '——数据显示那是你的黄金时段。');
    if(em.nightRatio >= 0.35) notes.push('夜间完成占比 ' + pctN(em.nightRatio) + '%，下周试着把最难的一件挪到早上，把睡眠还给自己。');
    if(em.weakCats && em.weakCats.length) notes.push('「' + em.weakCats[0].title + '」完成率 ' + pctN(em.weakCats[0].rate) + '%，下周提高频次、降低单次难度，不硬啃。');
    if(em.pc && em.pc.pendingPast >= 3) notes.push('有 ' + em.pc.pendingPast + ' 项一直往后推，下周第一天先了结最老的那一项，别让它继续滚。');
    return { monday:S.fmtDate(nextMon), days, alloc, notes, weekProfile:wp.prof };
  }

  /* =========================================================
     ⑩  扩展预判规则：在 brain 的 26 条之上再叠一层
     ========================================================= */
  const SPEECH_X = {
    energyMismatch:['现在精力只有 {e}，但你今天还有 {n} 项没做。先挑 10 分钟以内的小任务，把动量捡回来。',
                   '状态在往下走了（精力 {e}）。别啃硬骨头，先把轻松的清掉，剩下的交给明天。'],
    loadOverload:['今天排了 {m} 分钟的量，超出你能承受的 {c} 分钟不少。砍掉三成再开始，做不完比不做更伤。',
                  '负荷 {r} 倍，超载了。我把最不重要的几项往后挪，你先保住主线。'],
    loadLight:['今天只排了 {m} 分钟，对你来说偏轻。要不要把明天的提前挪一子过来？',
               '量偏轻（{m}/{c} 分钟）。有余力的话，今天可以多推进一点。'],
    weekdayWeak:['{w}是你的历史低谷日（完成率 {r}%）。今天别排太满，能把主线守住就算赢。',
                 '数据显示你{w}容易掉（{r}%）。今天重点不是多做，是别断。'],
    streakRisk:['今天保住连续天数的概率只有 {p}%。别硬撑，挑最短的那一项先落。',
                '连续天数今天有点悬（{p}%）。5 分钟就能接上，别让它断。'],
    goalSpeedRisk:['「{t}」按当前 {s} 项/天的速度追得有点吃力。要么加量，要么把目标拆小——我建议后者，先保住主线。',
                   '「{t}」还需要 {n} 项、剩 {dd} 天，按现在速度来不及。接下来每天得完成约 {need} 项，或者把范围缩到最小能交付的样子。'],
    goalSpeedSafe:['「{t}」按现在的速度能如期拿下，保持住就行，不用加码。',
                   '「{t}」节奏健康，还有 {n} 项待推进，时间够用。'],
    tomorrowHeavy:['明天排了 {n} 项，比今天重。今晚先把材料准备好，明天不至于手忙脚乱。',
                   '明天的量偏大（{n} 项）。今天如果还有余力，先做掉明天的一件。'],
    histLowTask:['今天有「{t}」——这类任务你过去完成率只有 {r}%。我把它排在精力最好的时候，别放到最后。',
                 '「{t}」是你常卡的一项（历史 {r}%）。今天先做它，别拖到晚上。'],
    histHighTask:['「{t}」你过去完成率 {r}%，是稳拿的一项。用它开局，把动量带起来。',
                  '先做「{t}」（历史完成率 {r}%），用最顺手的一件把状态打开。'],
    weekDrop:['本周完成率 {a}%，比上周的 {b}% 掉了 {d} 个点。不是你变懒了，多半是量给多了——下周我调。',
              '这周 {a}%，上周 {b}%。掉得有点多，本周最后几天先减量，把节奏找回来。'],
    noNoteToday:['今天还没写随记。不用长，一句话就行——把卡住的地方记下来，明天就不会再卡一次。',
                 '今天有 {n} 项任务在跑，但还没记一笔。睡前花 1 分钟，写下今天最卡的那件事。'],
    weekendGap:['你周末的完成率是 {r}%，明显低于工作日。周末可以少做，但别彻底停——留一子就够了。',
                '周末是你最容易断的地方（{r}%）。这周六日各留一个 5 分钟的小任务，把链条接住。'],
    goalNeglect:['「{t}」已经 {d} 天没落子了。再放着就要变摆设——今天给它一子，哪怕最小的一子。',
                 '「{t}」冷了 {d} 天。目标不怕慢，怕的是被忘掉。今天匀 10 分钟给它。'],
    quickWin:['今天有 {n} 项 10 分钟以内的小任务。先花 10 分钟清掉它们，动量一起来，后面就顺了。',
              '{n} 项小任务在前，先扫掉——做大事之前，先让自己进入「在做事」的状态。'],
    chainOpportunity:['今天有 {n} 项任务在同一个地方（{loc}）。打包一起做，跑一趟就够，省下的是精力。',
                      '{loc} 那里你有 {n} 件事可以顺手办掉，约 {m} 分钟。别分几趟跑。'],
    progressCeiling:['你的完成率长期卡在 {r}%，不上不下。不是不够努力，是任务切法该换了——下周我把它拆得更碎。',
                     '一直平在 {r}%。稳是稳，但没有突破。下周加一点难度，试着往上顶一下。'],
    sleepDebt:['近 {n} 天你有 {r}% 的任务是在夜里完成的。完成度上去了，但睡眠在亏空。这周试试把最难的一件挪到早上。',
               '夜里完成占 {r}%。你在用明天的精神换今天的进度，短期赚，长期亏。'],
    monthEndPush:['这个月还有 {d} 天收尾。回头看看月初定的主线，还差多少？差的这几天补，别拖到下个月。',
                  '月末了（还剩 {d} 天）。把本月欠的账清一清，新月才能轻装上阵。']
  };

  function goalLastTouch(gid){
    const st = S.load();
    for(let i=0;i<30;i++){
      const ds = S.fmtDate(S.shiftDay(S.today(), -i));
      const arr = (st.tasks[ds]||[]).filter(t=> t.goalId===gid && t.done);
      if(arr.length) return i;
    }
    return 99;
  }

  function fireExtra(limit){
    const c = B.context();
    const ds = c.date;
    const hits = [];
    const add = (id, pri, text) => hits.push({ id, pri, text });

    // ① 精力与当下不匹配
    const em = energyModel(ds);
    const undone = S.tasksOf(ds).filter(t=> !t.done);
    if(em.energy < 45 && undone.length >= 2){
      add('energyMismatch', 86, pick(SPEECH_X.energyMismatch, ds+'x_em')
        .replace('{e}', em.energy).replace('{n}', undone.length));
    }
    // ② 负荷超载 / 过轻
    const li = loadIndex(ds);
    if(li.level==='overload'){
      add('loadOverload', 84, pick(SPEECH_X.loadOverload, ds+'x_lo')
        .replace('{m}', li.minutes).replace('{c}', li.capacity).replace('{r}', li.ratio));
    } else if(li.level==='light' && undone.length>0 && li.minutes>0){
      add('loadLight', 32, pick(SPEECH_X.loadLight, ds+'x_ll')
        .replace('{m}', li.minutes).replace('{c}', li.capacity));
    }
    // ③ 历史低谷日
    const wp = weekdayProfile(28);
    const todayProf = wp.prof[c.weekday];
    if(todayProf && todayProf.factor!=null && todayProf.factor < 0.9 && todayProf.samples>=3){
      add('weekdayWeak', 66, pick(SPEECH_X.weekdayWeak, ds+'x_ww')
        .replace('{w}', todayProf.label).replace('{r}', pctN(todayProf.rate)));
    }
    // ④ 连续天数续接风险
    const sf = forecastStreak();
    if(!sf.hold && sf.prob < 0.6 && c.streak >= 3){
      add('streakRisk', 82, pick(SPEECH_X.streakRisk, ds+'x_sr').replace('{p}', pctN(sf.prob)));
    }
    // ⑤ 目标速度：会延期 / 来得及
    const fg = S.load().goals.filter(g=> g.status!=='done').map(forecastGoal).filter(Boolean);
    const risky = fg.filter(x=> x.verdict==='risk' || x.verdict==='tight')
                    .sort((a,b)=> (b.late||0)-(a.late||0))[0];
    if(risky){
      add('goalSpeedRisk', 79, pick(SPEECH_X.goalSpeedRisk, ds+'x_gr'+risky.goal.id)
        .replace('{t}', risky.goal.title).replace('{s}', risky.speed)
        .replace('{d}', risky.late).replace('{n}', risky.remainTasks)
        .replace('{dd}', risky.daysToDeadline).replace('{need}', risky.needSpeed));
    } else if(fg.length){
      const safe = fg.filter(x=> x.verdict==='safe')[0];
      if(safe) add('goalSpeedSafe', 40, pick(SPEECH_X.goalSpeedSafe, ds+'x_gs'+safe.goal.id)
        .replace('{t}', safe.goal.title).replace('{a}', safe.arrive).replace('{n}', safe.remainTasks));
    }
    // ⑥ 明日偏重
    const tm = S.fmtDate(S.shiftDay(S.today(), 1));
    const tmA = S.tasksOf(tm);
    if(tmA.length >= (S.tasksOf(ds).length + 2) && tmA.length >= 5){
      add('tomorrowHeavy', 34, pick(SPEECH_X.tomorrowHeavy, ds+'x_th').replace('{n}', tmA.length));
    }
    // ⑦ 今日任务的历史表现
    if(undone.length){
      const withHist = undone.map(t=>({ t, h:historyOf(t.title) })).filter(x=> x.h && x.h.total>=2);
      const low = withHist.filter(x=> x.h.rate < 0.4).sort((a,b)=> a.h.rate-b.h.rate)[0];
      const high = withHist.filter(x=> x.h.rate >= 0.8).sort((a,b)=> b.h.rate-a.h.rate)[0];
      if(low) add('histLowTask', 68, pick(SPEECH_X.histLowTask, ds+'x_hl'+low.t.id)
        .replace('{t}', low.t.title).replace('{r}', pctN(low.h.rate)));
      if(high && !low) add('histHighTask', 30, pick(SPEECH_X.histHighTask, ds+'x_hh'+high.t.id)
        .replace('{t}', high.t.title).replace('{r}', pctN(high.h.rate)));
    }
    // ⑧ 本周 vs 上周
    const thisW = weekRateOf(0), lastW = weekRateOf(-7);
    if(thisW!=null && lastW!=null && (lastW - thisW) >= 0.15 && c.s7.total>=5){
      add('weekDrop', 64, pick(SPEECH_X.weekDrop, ds+'x_wd')
        .replace('{a}', pctN(thisW)).replace('{b}', pctN(lastW)).replace('{d}', pctN(lastW-thisW)));
    }
    // ⑨ 今天还没写随记
    const hasNote = (S.load().notes||[]).some(n=> n.date===ds);
    if(!hasNote && S.tasksOf(ds).length >= 2 && new Date().getHours() >= 15){
      add('noNoteToday', 26, pick(SPEECH_X.noNoteToday, ds+'x_nn').replace('{n}', S.tasksOf(ds).length));
    }
    // ⑩ 周末断层
    const weRate = weekendRate();
    if((c.weekday===5 || c.weekday===6) && weRate!=null && weRate < 0.5){
      add('weekendGap', 52, pick(SPEECH_X.weekendGap, ds+'x_wg').replace('{r}', pctN(weRate)));
    }
    // ⑪ 目标被冷落
    const neglected = S.load().goals.filter(g=> g.status!=='done')
      .map(g=>({g, d:goalLastTouch(g.id)})).filter(x=> x.d>=5).sort((a,b)=> b.d-a.d)[0];
    if(neglected && neglected.d < 30){
      add('goalNeglect', 60, pick(SPEECH_X.goalNeglect, ds+'x_gn'+neglected.g.id)
        .replace('{t}', neglected.g.title).replace('{d}', neglected.d));
    }
    // ⑫ 小任务快速清场
    const quick = undone.filter(t=> (t.duration||15) <= 10);
    if(quick.length >= 2){
      add('quickWin', 44, pick(SPEECH_X.quickWin, ds+'x_qw').replace('{n}', quick.length));
    }
    // ⑬ 同地点任务可打包
    const locMap = {};
    undone.forEach(t=>{ if(t.location){ const k = canonLoc(t.location); locMap[k]=(locMap[k]||0)+1; } });
    const locTop = Object.keys(locMap).sort((a,b)=> locMap[b]-locMap[a])[0];
    if(locTop && locMap[locTop] >= 2){
      const mins = undone.filter(t=> t.location && canonLoc(t.location)===locTop)
                         .reduce((s,t)=> s + (t.duration||15), 0);
      add('chainOpportunity', 42, pick(SPEECH_X.chainOpportunity, ds+'x_co'+locTop)
        .replace('{n}', locMap[locTop]).replace('{loc}', locTop).replace('{m}', mins));
    }
    // ⑭ 完成率天花板（长期平在 55-75）
    const w14 = weightedRate(14);
    if(w14!=null && w14>=0.55 && w14<=0.78 && c.s30.total>=20){
      add('progressCeiling', 38, pick(SPEECH_X.progressCeiling, ds+'x_pc').replace('{r}', pctN(w14)));
    }
    // ⑮ 睡眠亏空
    if(c.nightRatio >= 0.3 || c.nightStreak >= 2){
      add('sleepDebt', 58, pick(SPEECH_X.sleepDebt, ds+'x_sd')
        .replace('{n}', Math.max(2, c.nightStreak)).replace('{r}', pctN(c.nightRatio)));
    }
    // ⑯ 月末冲刺
    if(c.isMonthEnd){
      const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate() - new Date().getDate();
      add('monthEndPush', 24, pick(SPEECH_X.monthEndPush, ds+'x_me').replace('{d}', daysLeft));
    }

    hits.sort((a,b)=> b.pri - a.pri);
    return limit? hits.slice(0, limit) : hits;
  }

  function weekRateOf(weekOffset){
    const dow = S.today().getDay();
    const mon = S.shiftDay(S.today(), (dow===0? -6 : 1-dow) + weekOffset);
    let t=0, d=0;
    for(let i=0;i<7;i++){
      const ds = S.fmtDate(S.shiftDay(mon, i));
      const arr = S.tasksOf(ds);
      t += arr.length; d += arr.filter(x=>x.done).length;
    }
    return t? d/t : null;
  }
  function weekendRate(){
    let t=0, d=0;
    for(let i=1;i<=28;i++){
      const day = S.shiftDay(S.today(), -i);
      if(day.getDay()!==0 && day.getDay()!==6) continue;
      const arr = S.tasksOf(S.fmtDate(day));
      t += arr.length; d += arr.filter(x=>x.done).length;
    }
    return t>=4? d/t : null;
  }

  /* 合并 brain 规则 + 扩展规则（去重后按优先级取） */
  function predictionsV2(limit){
    limit = limit || 5;
    const base = B.predictions(8) || [];
    const extra = fireExtra(10);
    const seen = {};
    const out = [];
    // 修复（原缺陷 B3）：brain 的 fireRules 本就按 pri 降序返回，但 B.predictions()
    // 只带出 id / text，原来这里统一赋 pri:70 —— 结果「断档风险(100)」和「时段提示(20)」
    // 变成同级，扩展规则几乎总是压过基础规则，最该先说的预警反而被挤到后面。
    // 现在按下标还原优先级：越靠前分越高（95 起，每项 -7，下限 35）。
    base.forEach((h, idx)=>{ if(!seen[h.id]){ seen[h.id]=1;
      out.push({ id:h.id, text:h.text,
                 pri: (typeof h.pri === 'number') ? h.pri : Math.max(35, 95 - idx*7), src:'base' }); } });
    extra.forEach(h=>{ if(!seen[h.id]){ seen[h.id]=1; out.push({ id:h.id, text:h.text, pri:h.pri, src:'x' }); } });
    // 基础规则按下标还原优先级；扩展规则自带优先级 —— 高的排前面
    out.sort((a,b)=> b.pri - a.pri);
    return out.slice(0, limit);
  }

  /* =========================================================
     ⑪  意图问答：军师会客厅（识别意图 → 调算法 → 用数据回答）
     ========================================================= */
  const INTENTS = [
    { id:'progress', kws:['进度','怎么样','如何','情况','多少','几成','到哪了','进展'] },
    { id:'forecast', kws:['预测','能不能','来得及','会怎样','多久','还要多久','什么时候能','能不能过','有希望吗'] },
    { id:'advice',   kws:['怎么办','怎么弄','如何做','建议','该做什么','下一步','做什么','帮我想想'] },
    { id:'why',      kws:['为什么','为啥','怎么会','咋回事','原因'] },
    { id:'comfort',  kws:['累','不想','放弃','难','烦','焦虑','撑不住','做不完','完了','崩溃','丧'] },
    { id:'stats',    kws:['完成率','统计','数据','几项','多少次','几天'] },
    { id:'goal',     kws:['目标','六级','计算机','减重','考公','英语','体重'] },
    { id:'time',     kws:['几点','今天','明天','本周','这周','剩下','还有多少'] },
    { id:'decompose',kws:['拆解','拆一下','怎么拆','拆成','分几步','分步','怎么做','步骤','从哪开始'] },
    { id:'plan',     kws:['下周','计划','安排','布局','排一下','规划'] }
  ];
  function detectIntent(q){
    const t = String(q||'');
    let best = null, bestN = 0;
    INTENTS.forEach(it=>{
      const n = it.kws.filter(k=> t.indexOf(k)>=0).length;
      if(n > bestN){ bestN = n; best = it.id; }
    });
    return best || 'brief';
  }

  function ask(q){
    const intent = detectIntent(q);
    const c = B.context();
    const ds = c.date;
    const arr = S.tasksOf(ds);
    const done = arr.filter(t=>t.done).length;
    const undone = arr.filter(t=>!t.done);
    let text = '';

    if(intent==='progress'){
      const fg = S.load().goals.filter(g=>g.status!=='done').map(forecastGoal).filter(Boolean);
      text = '今天 ' + done + '/' + arr.length + '（' + pctN(arr.length? done/arr.length : 0) + '%），近 7 天 ' + c.s7.done + '/' + c.s7.total + '（' + pctN(c.s7.rate) + '%）。';
      if(fg.length){
        text += ' 各条线：' + fg.map(x=> '「' + x.goal.title + '」已落 ' + x.doneTasks + '/' + x.needTotal +
                 ' 子（' + x.speed + ' 项/天，' + x.verdictCN + '）').join('；') + '。';
      }
      text += ' 连续 ' + c.streak + ' 天。';
    }
    else if(intent==='forecast'){
      const fa = forecastAll();
      text = '明天预计完成率 ' + pctN(fa.tomorrow.rate) + '%';
      if(fa.tomorrow.expect!=null) text += '（约 ' + fa.tomorrow.expect + '/' + fa.tomorrow.total + ' 项）';
      text += '；本周预计 ' + fa.week.predWeekTotal + '/' + fa.week.totalSum + '（' + pctN(fa.week.predWeekRate) + '%）。' + fa.week.verdict;
      if(fa.goals.length){
        // 问句里点名了哪个目标就先答哪个，没点名才说最悬的那条
        const named = fa.goals.find(g=>{
          const ti = String(g.goal.title).replace(/[\s\/·]/g,'');
          for(let i=0;i<ti.length-1;i++){ if(String(q||'').indexOf(ti.substr(i,2))>=0) return true; }
          return false;
        });
        const g0 = named || fa.goals.slice().sort((a,b)=> (b.late||0)-(a.late||0))[0];
        text += (named? ' 关于「' : ' 最悬的是「') + g0.goal.title + '」：' + g0.verdictCN +
                '，预计 ' + g0.arrive + ' 完成' + (g0.late>0? ('（晚 ' + g0.late + ' 天）') : '') + '。' + g0.tip;
      }
      if(!fa.streak.hold) text += ' ' + fa.streak.note;
    }
    else if(intent==='advice'){
      const nba = B.nextBestAction();
      const em = energyModel();
      text = em.note + ' ' + nba.text;
      const li = loadIndex();
      if(li.level==='overload') text += ' 另外今天排的量超载了（' + li.minutes + '/' + li.capacity + ' 分钟），先砍掉三成再开始。';
    }
    else if(intent==='why'){
      const wp = weekdayProfile(28);
      const low = wp.prof.filter(x=> x.factor!=null).sort((a,b)=> a.factor-b.factor)[0];
      const reasons = c.risk.reasons && c.risk.reasons.length? c.risk.reasons.join('、') : '';
      text = '我看了下数据。';
      if(reasons) text += '主要问题：' + reasons + '。';
      if(low) text += ' ' + low.label + '是你的历史低谷（' + pctN(low.rate) + '%），这类日子掉链子不是你的错，是排程没避开。';
      if(c.nightRatio>=0.35) text += ' 另外你有 ' + pctN(c.nightRatio) + '% 的任务在夜里完成，睡不够会直接压低第二天的完成率。';
      const li = loadIndex();
      if(li.level==='overload') text += ' 今天的量也确实排多了（' + li.minutes + '/' + li.capacity + ' 分钟）。';
      if(!reasons && !low) text = '数据上没有明显异常。完成率这种东西本来就有波动，别拿单天的好坏下结论——看两周均线更准。';
    }
    else if(intent==='comfort'){
      const mood = B.extract(q).emotion;
      text = B.emotionReply({ id:'ask_'+Date.now(), text:q, emotion:mood });
      const li = loadIndex();
      if(li.level==='overload' || li.level==='heavy') text += ' 今天的量我给你压下来了，剩下的明天再说。你比任务重要。';
    }
    else if(intent==='stats'){
      const w14 = weightedRate(14);
      text = '近 14 天加权完成率 ' + (w14!=null? pctN(w14)+'%' : '样本不足') + '，累计 ' + c.s30.done + '/' + c.s30.total + '（近 30 天）。';
      text += ' 高效时段是' + (c.bestSlotCN || '还没积累够数据') + '，夜间完成占比 ' + pctN(c.nightRatio) + '%。';
      text += ' 拖延指数 ' + c.pc.score + '（' + (c.pc.level==='high'?'偏高':c.pc.level==='mid'?'中等':'低') + '），断档风险 ' + c.risk.score + '。';
    }
    else if(intent==='goal'){
      const t = String(q||'');
      const gs = S.load().goals.filter(g=> g.status!=='done');
      const hit = gs.find(g=> t.indexOf(g.title.slice(0,2))>=0) || gs[0];
      if(hit){
        const f = forecastGoal(hit);
        text = '「' + hit.title + '」进度 ' + f.progress + '%，时间已过 ' + f.timePast + '%。' +
               '已完成 ' + f.doneTasks + '/' + f.needTotal + ' 项，速度 ' + f.speed + ' 项/天。' +
               '预计 ' + f.arrive + ' 完成，' + f.verdictCN + '。' + f.tip;
      } else text = '你还没有进行中的目标。立一个吧，我帮你拆成每天能落的子。';
    }
    else if(intent==='time'){
      const em = energyModel();
      const li = loadIndex();
      text = '现在是' + em.slotCN + '，精力 ' + em.energy + '（' + em.levelCN + '）。今天还剩 ' + undone.length + ' 项，约 ' + li.minutes + ' 分钟。';
      text += ' ' + em.note;
      const fw = forecastWeek();
      text += ' 本周预计能落 ' + fw.predWeekTotal + '/' + fw.totalSum + ' 项。';
    }
    else if(intent==='decompose'){
      // 优先匹配用户提到的具体任务（今天未做→已做→任意）
      const qn = normTitle(q);
      const todayAll = arr;
      const match = todayAll.find(t=> normTitle(t.title).indexOf(qn)>=0 || qn.indexOf(normTitle(t.title))>=0)
                  || undone.slice().sort((a,b)=> (b.duration||15)-(a.duration||15))[0];
      if(match){
        const d = decomposeV2(match);
        text = '「' + match.title + '」我给你拆成 ' + d.steps.length + ' 步：' +
               d.steps.map((s,i)=> (i+1) + '. ' + s.text + '（约 ' + s.min + ' 分钟）').join('；') + '。';
        if(d.note) text += ' ' + d.note;
      } else text = '今天没有待办可以拆。说一句话，我帮你把想做的事排进去。';
    }
    else if(intent==='plan'){
      const nw = nextWeekLayout();
      text = '下周布局：' + nw.alloc.map(a=> '「' + a.title + '」占 ' + a.share + '%').join('，') + '。';
      const weak = nw.days.slice().sort((a,b)=> a.factor-b.factor)[0];
      if(weak) text += ' ' + weak.note;
      text += ' ' + nw.notes[0];
    }
    else {
      const bf = B.briefing();
      text = bf.summary;
      const fa = forecastAll();
      text += ' 明天预计完成率 ' + pctN(fa.tomorrow.rate) + '%，' + fa.streak.note;
    }

    return { intent, text, q };
  }

  /* 会客厅的推荐问题（降低提问门槛：不知道问什么时点一下） */
  function suggestedQuestions(){
    const c = B.context();
    const undone = S.tasksOf(c.date).filter(t=> !t.done);
    const q = [];
    q.push('我今天该先做什么？');
    if(undone.length) q.push('「' + undone[0].title + '」怎么拆？');
    q.push('我这周能完成多少？');
    const gs = S.load().goals.filter(g=> g.status!=='done');
    if(gs.length) q.push('「' + gs[0].title + '」来得及吗？');
    q.push('我最近为什么总完不成？');
    q.push('下周怎么安排？');
    return q.slice(0,5);
  }

  window.ZQ = window.ZQ || {};
  window.ZQ.oracle = {
    dayStats, weekdayProfile, slotProfile, normTitle, taskHistoryMap, historyOf,
    energyModel, loadIndex,
    weightedRate, forecastDay, forecastWeek, forecastGoal, forecastStreak, forecastAll,
    canonLoc, bywayEngine, BYWAY_LIB, LOC_ALIAS,
    decomposeV2, DECOMP,
    ADVICE2, DOMAIN, TOPIC_LEX2, suggestV2, extractV2,
    reviewComment, nextWeekLayout, weekRateOf, weekendRate, goalLastTouch,
    fireExtra, predictionsV2, SPEECH_X,
    detectIntent, ask, suggestedQuestions,
    SLOT_KEYS, SLOT_CN
  };
})();
