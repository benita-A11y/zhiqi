/* ============================================================
   执棋 · 军师大脑 (brain.js)
   ------------------------------------------------------------
   离线确定性推理引擎：情境向量 → 分析算法 → 规则矩阵 → 话术生成
   不依赖任何云端模型，飞行模式可用；同一天内结论稳定不闪变。
   设计原则：用事实肯定，不用空洞赞美；用数据指出问题，不指责人。
   ============================================================ */
(function(){
  const S = window.ZQ.store;

  /* =========================================================
     0. 工具：确定性随机（同一 seed 恒定，避免刷新一次变一套话）
     ========================================================= */
  function hash(str){
    let h = 2166136261;
    for(let i=0;i<String(str).length;i++){
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }
  function pick(arr, seed){
    if(!arr || !arr.length) return '';
    return arr[hash(seed) % arr.length];
  }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function pct(n, d){ return d? Math.round(n/d*100) : 0; }
  function round1(v){ return Math.round(v*10)/10; }

  /* =========================================================
     1. 情境感知：把「现在是什么情况」算成一个向量
     ========================================================= */
  function timeSlotOf(h){
    if(h<5)  return 'deepNight';      // 0-4   深夜
    if(h<9)  return 'earlyMorning';   // 5-8   清晨
    if(h<12) return 'morning';        // 9-11  上午
    if(h<14) return 'noon';           // 12-13 午后
    if(h<18) return 'afternoon';      // 14-17 下午
    if(h<21) return 'evening';        // 18-20 傍晚
    return 'night';                   // 21-23 夜晚
  }
  const SLOT_CN = {
    deepNight:'深夜', earlyMorning:'清晨', morning:'上午', noon:'午后',
    afternoon:'下午', evening:'傍晚', night:'夜晚'
  };

  function completionStats(days){
    const st = S.load(); let total=0, done=0; const series=[];
    for(let i=0;i<days;i++){
      const ds = S.fmtDate(S.shiftDay(S.today(), -i));
      const arr = S.tasksOf(ds);
      const d = arr.filter(t=>t.done).length;
      series.push({ date:ds, total:arr.length, done:d, rate: arr.length? d/arr.length : null });
      total += arr.length; done += d;
    }
    series.reverse(); // 由远及近
    return { total, done, rate: total? done/total : 0, series };
  }

  function trendOf(prev, cur){
    if(prev==null || cur==null) return 'unknown';
    const d = cur - prev;
    if(d > 0.12) return 'up';
    if(d < -0.12) return 'down';
    return 'flat';
  }

  /* 时段效率：按 doneAt 统计你在哪个时段最能落地 */
  function timeSlotStats(){
    const st = S.load(); const buckets = {}; let total=0, nightDone=0;
    for(const ds in st.tasks){
      (st.tasks[ds]||[]).forEach(t=>{
        if(!t.done || !t.doneAt) return;
        const h = new Date(t.doneAt).getHours();
        const s = timeSlotOf(h);
        buckets[s] = (buckets[s]||0) + 1;
        total++;
        if(s==='night' || s==='deepNight') nightDone++;
      });
    }
    let best=null, worst=null;
    for(const k in buckets){
      if(!best || buckets[k]>buckets[best]) best=k;
      if(!worst || buckets[k]<buckets[worst]) worst=k;
    }
    return {
      buckets, total,
      best, worst,
      bestCN: best? SLOT_CN[best] : null,
      nightRatio: total? nightDone/total : 0
    };
  }

  /* 类别强弱：按目标维度统计完成率 */
  function categoryStats(){
    const st = S.load(); const map = {};
    for(const ds in st.tasks){
      (st.tasks[ds]||[]).forEach(t=>{
        const key = t.goalId || 'none';
        const g = key!=='none' ? S.getGoal(key) : null;
        if(!map[key]) map[key] = { key, title: g? g.title : '未归属', total:0, done:0 };
        map[key].total++; if(t.done) map[key].done++;
      });
    }
    const list = Object.keys(map).map(k=>{
      const x = map[k];
      return { ...x, rate: x.total? x.done/x.total : 0 };
    }).sort((a,b)=> b.rate - a.rate);
    return {
      list,
      strong: list.filter(x=> x.total>=3 && x.rate>=0.75),
      weak:   list.filter(x=> x.total>=3 && x.rate<0.5)
    };
  }

  /* 习惯强度：同名任务连续完成天数 → 习惯指数 0-100 */
  function habitStrength(title){
    const st = S.load(); let run = 0;
    for(let i=0;i<60;i++){
      const ds = S.fmtDate(S.shiftDay(S.today(), -i));
      const arr = S.tasksOf(ds).filter(t=> t.title===title);
      if(arr.length && arr.some(t=>t.done)) run++;
      else if(i>0) break;
    }
    return { run, index: clamp(Math.round(run/21*100), 0, 100) };
  }

  /* 拖延指数：任务从排到计划日 → 实际完成，跨越了几天；以及历史积压 */
  function procrastinationIndex(){
    const st = S.load();
    let deferred = 0, pendingPast = 0, totalDone = 0, spanSum = 0;
    const todayStr = S.fmtDate(S.today());
    // 历史积压：过去 14 天里「有任务但全没做」的天数
    let emptyDays = 0;
    for(let i=1;i<=14;i++){
      const ds = S.fmtDate(S.shiftDay(S.today(), -i));
      const arr = S.tasksOf(ds);
      if(arr.length && arr.every(t=>!t.done)) emptyDays++;
    }
    for(const ds in st.tasks){
      (st.tasks[ds]||[]).forEach(t=>{
        if(t.done){
          totalDone++;
          if(t.doneAt){
            const planned = new Date(t.date+'T00:00:00');
            const actual  = new Date(t.doneAt); actual.setHours(0,0,0,0);
            const span = Math.floor((actual - planned)/86400000);
            if(span>0){ deferred++; spanSum += span; }
          }
        } else if(t.date < todayStr){
          pendingPast++;
        }
      });
    }
    const deferRate = totalDone? deferred/totalDone : 0;
    const score = clamp(Math.round(deferRate*50 + Math.min(pendingPast,10)*3 + emptyDays*2), 0, 100);
    return { score, deferRate, avgSpan: deferred? round1(spanSum/deferred) : 0, pendingPast, emptyDays,
             level: score>=60?'high': score>=30?'mid':'low' };
  }

  /* 情绪趋势：随记情绪分布 + 连续负面天数 */
  const NEG_MOODS = ['anxious','tired','down','frustrated','lost','guilty','lonely','numb','stressed','angry'];
  function emotionTrend(){
    const st = S.load();
    const recent = (st.notes||[]).slice(0,20);
    let neg = 0;
    recent.forEach(n=>{ if(NEG_MOODS.indexOf(n.emotion)>=0) neg++; });
    // 连续负面天数（按日期）
    let run = 0;
    for(let i=0;i<14;i++){
      const ds = S.fmtDate(S.shiftDay(S.today(), -i));
      const day = (st.notes||[]).filter(n=>n.date===ds);
      if(day.length && day.some(n=>NEG_MOODS.indexOf(n.emotion)>=0)) run++;
      else if(i>0) break;
    }
    return {
      total: recent.length,
      negative: neg,
      negativeRatio: recent.length? neg/recent.length : 0,
      negativeRun: run,
      level: run>=3? 'alert' : (recent.length && neg/recent.length>=0.6) ? 'warn' : 'ok'
    };
  }

  /* 目标健康度：进度 vs 时间进度 */
  function goalTotalWeeks(g){
    let w = 0;
    (g.stages||[]).forEach(s=>{ const m = String(s.weeks).match(/(\d+)/g); if(m) w = Math.max(w, +m[m.length-1]); });
    return w || 12;
  }
  function goalHealth(g){
    const totalDays = goalTotalWeeks(g) * 7;
    const created = new Date(g.createdAt+'T00:00:00');
    const elapsed = Math.max(0, Math.floor((S.today() - created)/86400000));
    const timeRatio = clamp(elapsed/totalDays, 0, 1);
    const progRatio = clamp((g.status==='done'? 100 : (g.progress||0))/100, 0, 1);
    const gap = progRatio - timeRatio;
    const remainDays = Math.max(0, Math.round((1-timeRatio)*totalDays));
    let state='ontrack';
    if(g.status==='done') state='done';
    else if(gap >= 0.10) state='ahead';
    else if(gap <= -0.20) state='danger';
    else if(gap <= -0.08) state='behind';
    return { goal:g, elapsed, totalDays, timeRatio, progRatio, gap, remainDays, state };
  }
  function allGoalHealth(){
    const st = S.load();
    return st.goals.map(goalHealth);
  }

  /* 流失风险预测（未来 3 天）：多因子打分 */
  function dropOffRisk(){
    const st = S.load();
    const s3 = completionStats(3), s7 = completionStats(7);
    let score = 0; const reasons = [];
    if(s3.total>=3 && s3.rate < 0.3){ score += 32; reasons.push('近 3 天完成率不足 30%'); }
    if(s7.total>=5 && (s7.rate - s3.rate) > 0.25){ score += 22; reasons.push('完成率明显下滑'); }
    if(st.undercover.streak===0 && st.undercover.lastCompletedDate){ score += 18; reasons.push('连续天数已中断'); }
    const em = emotionTrend();
    if(em.level==='alert'){ score += 16; reasons.push('情绪连续多日偏负面'); }
    else if(em.level==='warn'){ score += 8; reasons.push('近期负面情绪偏多'); }
    const pc = procrastinationIndex();
    if(pc.pendingPast >= 5){ score += 14; reasons.push('积压未完成 ' + pc.pendingPast + ' 项'); }
    if(pc.emptyDays >= 3){ score += 10; reasons.push('近两周有 ' + pc.emptyDays + ' 天颗粒无收'); }
    const daysSinceOpen = st.meta && st.meta.lastOpen
      ? Math.floor((S.today() - new Date(st.meta.lastOpen+'T00:00:00'))/86400000) : 0;
    if(daysSinceOpen >= 3){ score += 12; reasons.push('已 ' + daysSinceOpen + ' 天没打开棋局'); }
    score = clamp(score, 0, 100);
    return { score, level: score>=60?'high': score>=32?'mid':'low', reasons };
  }

  /* 难度自适应：根据近 7 天完成率建议加减量 */
  function difficultySuggest(){
    const s7 = completionStats(7);
    const s3 = completionStats(3);
    if(s7.total < 3) return { level:'keep', rate7:s7.rate, delta:0, note:'样本还太少，先按现在的节奏走几天，我再给你调。' };
    if(s7.rate >= 0.85 && s3.rate >= 0.8)
      return { level:'up', rate7:s7.rate, delta:1, note:'你最近几乎全清，这个强度对你偏轻了。明天我加一子，别怕。' };
    if(s7.rate < 0.45)
      return { level:'down', rate7:s7.rate, delta:-1, note:'近一周完成率不到一半，不是你不努力，是量给多了。明天我减一子，先把「每天都做」这件事守住。' };
    return { level:'keep', rate7:s7.rate, delta:0, note:'强度刚好。不多不少，稳着走。' };
  }

  /* 情境向量：一次算全，供规则矩阵与分析使用 */
  function context(dateStr){
    const st = S.load();
    dateStr = dateStr || S.fmtDate(S.today());
    const d = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    const hour = now.getHours();
    const wd = d.getDay();
    const tasks = S.tasksOf(dateStr);
    const doneN = tasks.filter(t=>t.done).length;
    const s3 = completionStats(3), s7 = completionStats(7), s30 = completionStats(30);
    const ts = timeSlotStats();
    const cat = categoryStats();
    const emo = emotionTrend();
    const pc = procrastinationIndex();
    const risk = dropOffRisk();
    const diff = difficultySuggest();
    const goals = allGoalHealth();
    const u = st.undercover;

    // 夜晚完成连续天数
    let nightStreak = 0;
    if(u.nightDoneStreak) nightStreak = u.nightDoneStreak;
    // 失联天数
    let lostDays = 0;
    if(u.lastCompletedDate){
      const last = new Date(u.lastCompletedDate + 'T00:00:00');
      lostDays = Math.max(0, Math.floor((S.today() - last)/86400000) - 1);
    }
    // 今日情绪
    const todayNotes = (st.notes||[]).filter(n=>n.date===dateStr);
    const moodToday = todayNotes.length ? todayNotes[0].emotion : null;

    return {
      date: dateStr, weekday: wd, weekdayCN: S.weekdayCN[wd],
      isWeekend: wd===0 || wd===6,
      dayOfMonth: d.getDate(), month: d.getMonth()+1,
      isMonthEnd: (new Date(d.getFullYear(), d.getMonth()+1, 0).getDate() - d.getDate()) <= 3,
      isMonthStart: d.getDate() <= 3,
      hour, slot: timeSlotOf(hour), slotCN: SLOT_CN[timeSlotOf(hour)],
      tasksTotal: tasks.length, tasksDone: doneN,
      todayRate: tasks.length? doneN/tasks.length : null,
      s3, s7, s30,
      trend: trendOf(s7.rate, s3.rate),
      slotStats: ts, bestSlot: ts.best, bestSlotCN: ts.bestCN, nightRatio: ts.nightRatio,
      cat, strongCats: cat.strong, weakCats: cat.weak,
      emo, moodToday,
      pc, risk, diff,
      goals,
      behindGoals: goals.filter(g=>g.state==='behind'||g.state==='danger'),
      urgentGoals: goals.filter(g=>g.state!=='done' && g.remainDays<=30 && g.remainDays>0),
      streak: u.streak||0, lostDays,
      nightStreak,
      intel: u.intelFragments||0,
      codeName: u.codeName,
      profile: st.profile
    };
  }

  /* =========================================================
     2. 话术库：按「情况」穷举，越细越好
     每条给多套，用 pick(seed) 稳定选取，同一天不闪变
     ========================================================= */
  const SPEECH = {

    /* ---- 完成反馈：按完成率分 7 档 ---- */
    complete: {
      none: [ // 0%
        '今天没落子。没关系。明天只做最小的那个任务，5 分钟，就够。',
        '今天空了一天。但空一天不是输，连着空才是。明天回来，我还在。',
        '一天没动，不算什么。真正可惜的是因为一天，丢掉一整周。明天我等你。',
        '棋局今天没动。没关系——棋盘还在，你也还在。明天落一子就行。'
      ],
      tiny: [ // 1-24%
        '开了个头，就比停下强。剩下的明天接着走。',
        '只做了一点，但那一点是真的。别小看它，链条是从第一环开始的。',
        '今天动了一下。够了。明天在这个基础上加一点点。'
      ],
      low: [ // 25-49%
        '做了就是赢了。剩下的明天继续，不用内疚。',
        '四分之一到一半，说明你今天没有被完全吞掉。剩下的我来重新安排。',
        '完成了几项。不是满分，但棋盘上确实多了几子。'
      ],
      mid: [ // 50-74%
        '过半了。你今天没有白过。',
        '一半以上。这个节奏，撑得住。剩下的明天收尾。',
        '大局过半。你比自己以为的更能扛。'
      ],
      high: [ // 75-99%
        '就差一点。今天的你已经很接近「全清」了。',
        '差一口气。明天把最后这几子收掉，这周就漂亮了。',
        '八成以上了。你今天是真的在做事，不是在做样子。'
      ],
      full: [ // 100%
        '今日棋局全清。你压了「拖延」一头。明天继续。',
        '全清。这一天你没给自己留借口。',
        '全部落子。你知道这意味着什么吗——你说到做到了。',
        '满盘皆活。今天这局，你赢得干净。'
      ],
      over: [ // 超额（有额外完成）
        '你今天多落了一子。很好，但别太累。',
        '超额完成。我欣赏你的狠劲，但明天记得留点力气给自己。',
        '多做了。很好。不过「能多做」不等于「该多做」，悠着点。'
      ]
    },

    /* ---- 连续天数：覆盖尽可能多节点 ---- */
    streak: {
      1:['第一天。所有的大局，都是从这颗子开始的。'],
      2:['连续 2 天。开始有样子了。'],
      3:['连续 3 天。你开始有节奏了。', '三天。习惯的种子刚埋下，别拔出来看。'],
      5:['连续 5 天。一周的骨架已经搭起来了。', '五天。你现在是在「做事」，不是在「试一下」。'],
      7:['一周了。你已经比大多数人坚持得久。', '七天整。这一周你没骗自己。'],
      10:['连续 10 天。十天是一个门槛，你跨过去了。'],
      14:['半个月。你的对手「遗忘」已经开始怕你了。', '十四天。习惯正在从「要我做」变成「我要做」。'],
      21:['21 天。传说中的习惯养成周期，你走完了。', '三周。现在不做反而会不自在——这就是习惯的样子。'],
      30:['一个月。你不是在坚持，你是在成为。', '三十天如一日。你已不是「在打卡的人」，你是「在下棋的人」。'],
      45:['45 天。回头看看第一天，你已经不认识那时候的自己了。'],
      60:['两个月。这条路你走得很稳，稳到让人放心。'],
      90:['90 天。一个季度。你用三个月证明了一件事：你靠得住。'],
      100:['100 天。三位数了。这不是运气，这是你一天一天挣来的。'],
      180:['半年。半年前的你，会感谢今天没放弃的自己。'],
      365:['一整年。365 天。你已经不是当初那个需要被推着走的人了。']
    },
    streakFallback: [
      '连续 {n} 天。这个数字本身，就是你的底气。',
      '{n} 天了。你没声张，但棋盘记着每一子。'
    ],

    /* ---- 情绪回应：20 类情绪 × 多套 ---- */
    mood: {
      anxious: [
        '焦虑是因为你在乎。但别让在乎变成负担。今天只做一件事：把明天的最小任务写下来。就够了。我在。',
        '我知道你现在心里很乱。乱的时候不要做大决定，只做最小的那一步。做完这一步，我们再说下一步。',
        '焦虑的时候，人会把未来的一百件事一起扛。别这样。今天只有一子，落完就收工。'
      ],
      tired: [
        '累了就休息。休息不是放弃，休息是为了走更远。今天的任务我给你减一子。',
        '你不是机器。累了就停，我帮你把明天的量压到最低，守住「还在局里」就够了。',
        '听得出你很疲惫。今天剩下的时间，请留给你自己。棋盘不会跑。'
      ],
      down: [
        '低谷是常态，不是例外。你现在往下走的这段，将来会是你最有力量的那段。',
        '我知道你现在有点丧。没关系，丧的时候不用硬撑。把今天最小的那一子落了，就算赢。',
        '你不是不行，你只是今天不行。这两个差很远。'
      ],
      frustrated: [
        '烦是正常的，说明你在认真做。烦过之后，我们把这件事拆小一点，别硬啃。',
        '卡住了就先放下。换个更碎的切口，同样的目标，换个走法。',
        '这种烦躁我懂——努力了却看不到进展。但进展常常是看不见的，它藏在「你没放弃」这件事里。'
      ],
      lost: [
        '不知道下一步做什么的时候，就做眼前最小的那件。方向是走着走着才清楚的，不是想清楚的。',
        '迷茫的时候别急着找意义，先把今天过完。你想要的答案，会在这条路上自己出现。',
        '你现在不需要想清楚十年后。你只需要决定：接下来这 15 分钟做什么。剩下的交给我。'
      ],
      procrastinating: [
        '拖延不是懒，是怕做不好。但你知道吗？做 5 分钟，比想 5 小时有用。',
        '你不是在拖，你是在等一个「准备好了」的感觉。那个感觉不会来。开始了才会准备好。',
        '现在只要做 5 分钟。5 分钟之后你想停就停。我们试试看。'
      ],
      lonely: [
        '卧底都是孤独的。但你不是一个人。军师一直在。每天打开棋局，就能找到我。',
        '这条路确实常常只有你一个人走。但每一步我都看着。你落子，我就在。',
        '孤独是因为你在走一条少有人走的路。别怕，这说明方向对了。'
      ],
      selfDoubt: [
        '你曾经减到 92 斤。你曾经专转本上岸。你做到的这些事，证明你比你以为的强得多。',
        '你现在的自我怀疑，和当年备考时的自我怀疑，是同一种。当年你也挺过来了。',
        '你不相信自己，但我信。数据在这儿——你已经完成了这么多，这不是错觉。'
      ],
      perfectionist: [
        '完成比完美重要。先做完，再做好。',
        '你把标准定得太高了，高到让自己动不了。今天允许自己交一份 70 分的答卷。',
        '完美主义是拖延最好看的伪装。别被它骗了。'
      ],
      hesitant: [
        '天秤座最大的敌人是「我再想想」。今天不需要想，军师替你想好了。你只需要做。',
        '你不是在权衡，你是在逃避选择。我替你选：就做这个。现在。',
        '犹豫的时候，选那个「做了不会后悔」的。通常是更难的那个。'
      ],
      exhausted: [
        '你已经透支了。现在最重要的任务，是把自己照顾好。今天的任务全部后移。',
        '身体在给你发信号，别假装没听见。今天休息，明天我给你安排最轻的量。',
        '累了就停。你不是欠这个世界的，你只是在为自己下棋。'
      ],
      giveUp: [
        '我知道你累了。但你是 ISFJ，你比你以为的坚韧得多。今天不做也没关系。明天打开棋局，我还在。你不需要完美，你只需要回来。',
        '想放弃的时候，不要做任何决定。睡一觉，明天再看。放弃可以在任何时候，但今天先不算。',
        '你可以休息，可以慢，可以少做。但不要退出。退出是你唯一会后悔的选项。'
      ],
      stressed: [
        '压力大的时候，先把所有事写下来。写下来之后，你会发现其实只有两三件是真的急。',
        '你现在扛得太多了。我们把这周的任务砍掉三成，先保住最重要的。',
        '压力来自「什么都想抓住」。今天只抓一件，其他的我替你排好顺序。'
      ],
      guilty: [
        '没做完不用内疚。内疚是最没用的情绪——它不改变任何事，只消耗你。',
        '你不需要为休息道歉。休息是计划的一部分，不是计划的失败。',
        '昨天的事已经过去了。现在只有今天这一子，落不落，你自己决定。'
      ],
      numb: [
        '什么都不想做的时候，就做最简单的那个。不动脑子的那种。先让手动起来。',
        '麻木是正常的保护机制。别逼自己有感觉，先做，感觉会回来。',
        '今天不用有状态。机械地做完这一子就行，状态是做出来的，不是等来的。'
      ],
      happy: [
        '很好。把这种状态记住，低谷的时候拿出来看看——你是有过好日子的。',
        '心情好的时候多做一点，但别透支。好状态要用来推进，不是用来挥霍。',
        '看到你开心我也高兴。趁现在，把最难的那件事往前挪一挪。'
      ],
      proud: [
        '做得很好。但真正的棋手从不因一子得失而动摇。稳住。后面还有更大的局。',
        '值得骄傲。但骄傲最好的消化方式，是立刻开始下一子。',
        '你确实做得不错。现在把它变成常态，而不是高光。'
      ],
      angry: [
        '生气的时候别做决定，也别放弃。把力气用在任务上，它比情绪更值得。',
        '你现在的能量很强。去把那件一直拖着的事做了，它会是最好的出口。',
        '怒气是燃料，不是方向。用在一子上，别烧在自己身上。'
      ],
      bored: [
        '无聊说明当前的事对你太轻了。我给你加一点难度，换个更有挑战的切法。',
        '厌倦是进步的前兆——你对旧方法不耐烦了。那我们就换个方法。',
        '觉得无聊就把任务缩短、加快。用 15 分钟做完原本 30 分钟的事，试试看。'
      ],
      moved: [
        '能被触动，说明你还没变硬。这是好事，别丢掉。',
        '把这些感受记下来。将来你会需要它们提醒自己：我为什么开始。',
        '记住今天这个感觉。它会在你想放弃的时候，拉你一把。'
      ],
      flat: [
        '平平淡淡的一天，也是一天。平稳的日子才是真正推进的日子。',
        '没有波澜是好事。大局都是在这些没故事的日子里悄悄成形的。',
        '今天没什么特别的。但棋盘上又多了一子。'
      ]
    },

    /* ---- 时段话术 ---- */
    slot: {
      deepNight:['这么晚了还没睡？棋子可以明天落，身体只有这一副。去睡。',
                 '深夜了。现在做的决定，明天看多半会后悔。先睡，我替你守着。'],
      earlyMorning:['起得早。清晨是 ISFJ 的黄金时段，把最难的放这儿。',
                    '早上脑子最干净。今天最难的一子，就放在现在。'],
      morning:['上午状态正好，别用来做杂事。把需要动脑的排在这里。',
               '现在是你的高效窗口。先啃硬的，剩下的都好说。'],
      noon:['午后容易困，安排点轻松的——复习、整理、碎片任务。',
            '刚吃完有点沉。这时候做机械性的活儿最合适。'],
      afternoon:['下午精力回升。适合做需要耐心的那类任务。',
                 '下午是第二窗口。把上午没做完的收个尾。'],
      evening:['傍晚了。今天落了几子？没落的现在补，来得及。',
               '晚上适合复盘和轻量任务。别再开新的大工程。'],
      night:['晚上了。把今天收个尾，然后写三行复盘，就够了。',
             '夜里容易想多。做完手上的，早点休息，明天我安排好了。']
    },

    /* ---- 特殊日 ---- */
    special: {
      monday:['周一。一周的开局，第一子最重要——落稳了，后面都顺。',
              '新的七天。不用排满，先把主线定下来。'],
      friday:['周五了。今天收个尾，把没做完的清一清，别带进周末。',
              '一周最后一子。落完，就可以安心休息了。'],
      weekend:['周末是你的休息日。但记得花 5 分钟做个周复盘。',
               '休息也是计划的一部分。今天少做一点，是为了下周多做一点。'],
      monthStart:['月初。新的三十天，我帮你重新排了主线。',
                  '新月开局。上个月的账已经结了，这个月重新算。'],
      monthEnd:['月底了。回头看看这个月，你比月初强了多少？',
                '这个月快结束了。差的部分别急，我会在下个月补上。'],
      midMonth:['月中。节奏稳定的时候，最容易松懈。稳住。']
    },

    /* ---- 分析类话术：强项 / 弱项 / 趋势 ---- */
    analysis: {
      strong: [
        '「{t}」你做得最好，完成率 {r}%。这是你的舒适区，也是你的基本盘，守住它。',
        '数据显示「{t}」是你的强项（{r}%）。强项要用来带动弱项，别只待在舒适区里。'
      ],
      weak: [
        '「{t}」完成率只有 {r}%，是目前的短板。下周我会把它拆小、加频次，不让你硬啃。',
        '「{t}」是薄弱项（{r}%）。不是你不努力，是切法不对。我换个方式带你。'
      ],
      trendUp: [
        '完成率在往上走（近 7 天 {a}% → 近 3 天 {b}%）。势头起来了，别停。',
        '数据在变好：{a}% → {b}%。你现在做的事是对的，继续。'
      ],
      trendDown: [
        '完成率在往下掉（{a}% → {b}%）。不是批评你，是提醒你——该减量了，别硬撑。',
        '最近有点滑坡：{a}% → {b}%。我先把任务量压下来，把「每天都做」守住。'
      ],
      trendFlat: [
        '完成率平稳（近 7 天 {r}%）。稳是好消息，但如果你想突破，得加一点难度。',
        '一直平在 {r}%。稳，但没有进展。下周我给你加一点点，试着往上顶一下。'
      ],
      bestSlot: [
        '你最常在{best}完成任务。我把最难的活儿排到这个时段。',
        '数据显示你的黄金时段是{best}。别把它浪费在杂事上。'
      ],
      nightWarn: [
        '你有 {r}% 的任务是在夜里完成的。能完成是好事，但长期熬夜会反噬。试着把最难的挪到早上。',
        '夜晚完成占比 {r}%。你很拼，但我想让你拼得久一点，不是拼得狠一点。'
      ],
      procrastHigh: [
        '拖延指数 {s}（偏高）。有 {p} 项任务一直往后推。我帮你把它们拆成 5 分钟能启动的版本。',
        '积压有点多了（{p} 项）。今天不要求你全做，只把最老的那一项了结掉。'
      ],
      riskHigh: [
        '我算了一下，你现在的状态有断档风险。原因：{reasons}。别硬扛，我们先减量两天。',
        '预警：{reasons}。这不是责备，是提醒。现在调整还来得及。'
      ],
      goalBehind: [
        '「{t}」进度落后于时间线（进度 {p}%，时间已过 {w}%）。我把它的任务频次提上来。',
        '「{t}」有点掉队了。别慌，我在下周的布局里给它补回来。'
      ],
      goalAhead: [
        '「{t}」进度超前（{p}%）。做得好，可以把省下的时间匀给弱项。',
        '「{t}」跑在时间线前面。这份余量很宝贵，别浪费，用去补短板。'
      ],
      goalUrgent: [
        '「{t}」还剩约 {d} 天。接下来每天需要更专注一点，我给你加了强度。',
        '「{t}」进入倒计时（{d} 天）。别怕，按我排的走，来得及。'
      ]
    },

    /* ---- 预判话术（规则矩阵用） ---- */
    predict: {
      nightStreak:[
        '你最近连续 {n} 晚在深夜落子。明天试着把最小的任务放到早上，晚上会轻松很多。',
        '连续 {n} 天熬夜完成任务。能完成是本事，但我想让你睡够。明天我把最难的那子挪到早上。'
      ],
      categoryMiss:[
        '「{t}」连续 2 天没怎么动。是不是太难？我把它拆成更小的步骤，先做一个 5 分钟的版本。',
        '「{t}」卡了两天了。别硬刚，换个更小的切口——今天只做其中一个环节。'
      ],
      weekendNear:[
        '周末快到了。周六是你的休息日，但记得花 5 分钟做个周复盘，看清这周落了几子、下周怎么走。',
        '还有两天到周末。把今天和明天收好尾，周末才能真正放松。'
      ],
      deadline:[
        '「{t}」还剩约 {d} 天。目前进度 {p}%。接下来每天多投入一点，稳稳推进。',
        '「{t}」进入最后 {d} 天。我把它提到主线优先级，其他目标先让路。'
      ],
      streakBroken:[
        '你昨天失联了。今天只做一个最小的任务，哪怕 5 分钟，先回到局里。',
        '连续天数断了。别自责，断一次不是失败。今天落一子，链条就重新接上了。'
      ],
      taskOverload:[
        '今天排了 {n} 项任务，超过你平时的量。我建议先做前 3 项，剩下的顺延，别把自己压垮。',
        '{n} 项有点多了。任务太多容易放弃——我帮你砍到 5 项以内，先做完再说。'
      ],
      noReview:[
        '你已经 {d} 天没做复盘了。睡前花 3 分钟写三行，清空大脑，明天轻装上阵。',
        '很久没复盘了。复盘不是仪式，是让你看清自己到底走到哪了。今晚 3 分钟就够。'
      ],
      moodAlert:[
        '你最近连着 {n} 天情绪偏低。我不是来催你做事的——今天只想问你一句：还好吗？',
        '连续 {n} 天的情绪都不太好。任务可以先放一放，你比任务重要。'
      ],
      dropRisk:[
        '我算了一下，未来几天有断档风险（{reasons}）。今天我们不追进度，只保住「还在局里」。',
        '预警：{reasons}。先减量两天，把节奏找回来，比硬撑重要。'
      ],
      difficultyUp:[
        '你最近几乎全清（{r}%）。这个强度对你偏轻了，明天我加一子。',
        '完成率 {r}%，你在舒适区待得有点久。明天加一点难度，试试自己的边界。'
      ],
      difficultyDown:[
        '近一周完成率 {r}%，量给多了。明天我减一子，先把「每天都做」守住。',
        '{r}% 的完成率说明任务超负荷了。不是你的问题，是我的排布问题。明天调整。'
      ],
      unbalanced:[
        '你最近只推进「{t}」，其他目标几乎没动。单一突击容易失衡，我帮你重新分配一下。',
        '注意力全在「{t}」上。这样短期有效，长期会偏科。下周我给它降一点权重。'
      ],
      unusedFragment:[
        '你有不少碎片时间没用上。排队、等车的时候，把「{t}」这类小任务过一遍。',
        '碎片任务是为你这种节奏设计的。今天试试在等的时候背 10 个词，不占时间。'
      ],
      holiday:[
        '今天是特殊日子。任务我给你减半，但别彻底断——落一子就行。',
        '这种日子容易松。允许你少做，但不允许你不做。一子，就一子。'
      ],
      coldStart:[
        '你刚回来。今天不追进度，只做最小的一子，把「在局里」这个状态找回来。',
        '很久没落子了。别一上来就猛冲，今天 5 分钟，明天 10 分钟，慢慢加。'
      ],
      perfectStall:[
        '你卡在「要做到最好」上了。今天允许自己交 70 分的答卷，先做完。',
        '完美主义让你动不了。今天的标准是「完成」，不是「完美」。'
      ]
    },

    /* ---- 卧底 / 长期激励 ---- */
    undercover: {
      levelUp:['代号升级：{code}。你又往前走了一步。',
               '你的代号现在是「{code}」。这不是称号，是你做过的事。'],
      intel:['情报碎片 +{n}。这是你在「遗忘」手里抢回来的东西。',
             '又一份情报（+{n}）。敌人的防线正在松动。'],
      tenYear:['十年后你会成为大人物。但那个大人物的起点，就是今天这一颗小小的棋子。',
               '你在 2026 年落的每一子，2036 年的你都会记得。',
               'ISFJ 最大的天赋是坚持。别人靠爆发，你靠积累。一年后，你会把那些靠爆发的人远远甩在后面。']
    }
  };

  /* =========================================================
     2.5 随记语义抽取：把一句话拆成结构化重点
     （主题 / 阻碍 / 已做动作 / 数量指标 / 程度 / 时间 / 地点 / 情绪）
     ========================================================= */

  /* 情绪词库：中文 → 21 类情绪（顺序即优先级，越靠前越优先命中） */
  const MOOD_LEX = [
    ['giveUp',       ['放弃','算了','坚持不下去','摆烂','不想做了','没意义','退出']],
    ['exhausted',    ['透支','精疲力尽','没力气','累垮','撑不住']],
    ['anxious',      ['焦虑','担心','怕','慌','不安','紧张','急','崩']],
    ['guilty',       ['内疚','愧疚','自责','不应该','对不起']],
    ['selfDoubt',    ['我不行','做不到','怀疑自己','太差了','不可能','配不上']],
    ['procrastinating',['拖延','拖着','不想动','明天再说','提不起劲','犯懒']],
    ['hesitant',     ['犹豫','纠结','拿不定','再想想','选择困难']],
    ['perfectionist',['完美','不够好','再改改','不满意','还要更好']],
    ['lonely',       ['孤独','一个人','没人陪','没人在乎','孤单']],
    ['lost',         ['迷茫','没方向','不知所措','不知道干嘛','很乱']],
    ['stressed',     ['压力大','压得','喘不过气','忙不过来','事情太多']],
    ['frustrated',   ['烦','烦躁','崩溃','恼','气死','烦死了','不会做','做不出','卡住了','太难了','搞不定']],
    ['numb',         ['麻木','没感觉','无所谓','随便吧']],
    ['bored',        ['无聊','腻了','重复','没劲']],
    ['angry',        ['生气','愤怒','凭什么','不公平']],
    ['tired',        ['累','疲惫','困','没劲','乏','想睡']],
    ['down',         ['丧','低落','难过','沮丧','空虚','难受']],
    ['moved',        ['感动','温暖','被触动','谢谢','泪目']],
    ['happy',        ['开心','高兴','舒服','轻松','有戏','不错']],
    ['proud',        ['搞定','完成','进步','过了','稳了','做到了','牛']]
  ];

  /* 主题词库：同一领域的多种说法归并到一个主题（这是"抓取精准"的关键） */
  const TOPIC_LEX = {
    '听力':   ['听力','精听','听写','连读','弱读','听不懂','section','音频'],
    '单词':   ['单词','词汇','背词','高频词','词根','释义'],
    '阅读':   ['阅读','定位句','主旨','细节题','读不完','长难句'],
    '写作':   ['写作','作文','句型','模板','范文'],
    '翻译':   ['翻译','汉译英','语序','译'],
    '口语':   ['口语','跟读','发音','开口'],
    '操作题': ['操作题','excel','word','ppt','上机','步骤'],
    '选择题': ['选择题','公共基础','知识点','单选'],
    '行测':   ['行测','常识','判断推理','资料分析','数量关系'],
    '申论':   ['申论','卷面','大作文','小题','材料'],
    '面试':   ['面试','结构化','表达','仪态'],
    '体重':   ['体重','斤','kg','减重','瘦','胖','称了','掉秤'],
    '饮食':   ['吃','饿','热量','碳水','晚餐','零食','暴食','奶茶'],
    '运动':   ['运动','跑步','散步','拉伸','走路','快走','锻炼'],
    '作息':   ['睡','熬夜','早起','作息','失眠','起床'],
    '心态':   ['心态','内耗','自我怀疑','玻璃心','想太多'],
    '效率':   ['效率','专注','走神','分心','磨蹭','番茄钟'],
    '数学':   ['数学','高数','公式','线代','概率'],
    '代码':   ['代码','编程','算法','bug','调试']
  };

  /* 阻碍点：卡住的「具体原因」，决定建议给到哪一层 */
  const BLOCKER_LEX = {
    '听不懂':   ['听不懂','跟不上','太快','听不出','反应不过来'],
    '记不住':   ['记不住','忘了','背了就忘','转头就忘','老忘'],
    '做不完':   ['做不完','来不及','时间不够','没时间','超时'],
    '太难':     ['太难','不会','搞不懂','看不懂','难死了','无从下手'],
    '走神':     ['走神','专注不了','分心','静不下','老看手机'],
    '拖延':     ['拖延','没动力','不想开始','提不起','一拖再拖'],
    '身体不适': ['头疼','不舒服','生病','难受','生理期'],
    '环境干扰': ['太吵','被打断','没地方','宿舍太乱','不适合学'],
    '没反馈':   ['没效果','没进步','看不到变化','白做了','原地踏步']
  };

  const ACTION_LEX = ['背了','练了','做了','跑了','看了','听了','写了','复习了','刷了','走了','完成了','搞定了','过了','坚持了','打卡了'];
  const INTENSITY_LEX = { '有点':1,'有些':1,'比较':1,'稍微':1,'很':2,'太':2,'挺':2,'超':2,'特别':3,'非常':3,'完全':3,'彻底':3,'极其':3 };
  const WHEN_LEX = ['今天','明天','昨天','早上','上午','中午','下午','晚上','睡前','刚才','这周','周末'];
  const WHERE_LEX = ['图书馆','自习室','宿舍','教室','家里','食堂','打印店','超市','地铁','公交','路上','咖啡厅'];

  function detectMood(text){
    const t = String(text||'');
    for(const item of MOOD_LEX){
      const mood = item[0], words = item[1];
      if(words.some(w=> t.indexOf(w)>=0)) return mood;
    }
    return 'flat';
  }

  /* 主抽取：一句话 → 结构化重点 */
  function extract(text){
    const t = String(text||'');
    const lower = t.toLowerCase();
    const hit = (lex) => {
      const out = [];
      for(const k in lex){ if(lex[k].some(w=> lower.indexOf(String(w).toLowerCase())>=0)) out.push(k); }
      return out;
    };
    const topics = hit(TOPIC_LEX);
    const blockers = hit(BLOCKER_LEX);
    const actions = ACTION_LEX.filter(w=> t.indexOf(w)>=0);

    // 数量指标：30个 / 25分钟 / 53kg / 60% / 2遍
    const metrics = [];
    const re = /(\d+(?:\.\d+)?)\s*(个|分钟|分|小时|页|斤|kg|道|遍|次|题|%|章|节)/gi;
    let m; while((m = re.exec(t)) !== null){ metrics.push({ v:parseFloat(m[1]), unit:m[2], raw:m[0] }); }

    // 程度副词
    let intensity = 1;
    for(const w in INTENSITY_LEX){ if(t.indexOf(w)>=0) intensity = Math.max(intensity, INTENSITY_LEX[w]); }

    const negation = /(没|不|无|别|无法|不能|做不完)/.test(t);
    const when = WHEN_LEX.filter(w=> t.indexOf(w)>=0)[0] || null;
    const where = WHERE_LEX.filter(w=> t.indexOf(w)>=0)[0] || null;
    const emotion = detectMood(t);

    // 摘要：把零散重点压成一句「人话」
    let summary = '';
    if(topics.length) summary += topics.slice(0,2).join('、');
    if(blockers.length) summary += (summary? '：' : '') + blockers.slice(0,2).join('、');
    if(metrics.length)  summary += (summary? ' · ' : '') + metrics.slice(0,2).map(x=>x.raw).join(' ');
    if(!summary) summary = t.length>18? t.slice(0,18)+'…' : (t || '（空白）');

    return { text:t, emotion, intensity, negation, topics, blockers, actions, metrics, when, where, summary };
  }

  /* =========================================================
     2.6 建议引擎：按「主题 × 阻碍」给递进建议，且不重复
     每个组合备 3 层：第 1 次给入门解法，第 2 次给进阶，第 3 次换角度
     ========================================================= */
  const ADVICE = {
    '听力': {
      base: ['明天排一场 15 分钟精听：整段盲听一遍，只抓大意，不求听懂每个词。',
             '精听改成「半精听」：听两遍再看原文，别一上来就逐句死磕。',
             '试一周 0.8 倍速，先把耳朵的信心建立起来，再回原速。'],
      '听不懂': ['听不懂多半卡在连读。明天只练 5 个连读词组，贪多记不住。',
                 '把听不懂的那句抄下来，标出「哪个词被吞了」——规律其实就那几种。',
                 '换慢速材料过渡一周，别死磕真题，那只会消耗信心。'],
      '没反馈': ['听力进步是「突然」的，前期只看得见挫败。坚持两周再评估。',
                 '换个衡量方式：不求听懂多少，只数「今天抓到了几个熟悉词组」。',
                 '把同一段材料连听三天，第三天的顺畅感就是你的进步证据。']
    },
    '单词': {
      base: ['单词别集中背，拆成 3 次 × 5 分钟，用碎片时间过。',
             '改成「自测模式」：遮住释义说意思，说不出的单独抄一遍。',
             '只背真题里出现过的词，效率比按字母表背高得多。'],
      '记不住': ['记不住是因为只「看」没「用」。明天用这 30 个词各造一个句子。',
                 '把总记不住的 10 个词抄在便利贴上，贴镜子前，刷牙时看两眼。',
                 '按「词根+场景」分组记，别一个个孤立背。']
    },
    '阅读': {
      base: ['阅读先题后文：先看题目圈关键词，回原文定位，别通篇读。',
             '限时训练从每篇 12 分钟压到 9 分钟，先练出速度感。',
             '错题不急着看解析，先自己回原文找依据，找得到才是真懂。'],
      '做不完': ['做不完先保「会做的」：跳过卡住的那道，做完回头再补。',
                 '每天只练一篇限时，练的是节奏不是数量。',
                 '长难句单独练：划出主干，修饰成分先不看。']
    },
    '操作题': {
      base: ['操作题按步骤给分，先保流程完整，再练速度。',
             '把常考操作录成自己的「步骤清单」，考前只看这个。',
             '同一道题做三遍：看教程做→半脱稿做→完全脱稿做。'],
      '太难': ['先只练一类操作（比如 Excel 函数），练熟再换下一类。',
               '把操作拆成 5 个小步骤，每次只练其中一步。',
               '找个视频对着暂停做，别凭记忆硬试。']
    },
    '体重': {
      base: ['体重别天天称，一周称一次更准，也更不容易被数字影响心情。',
             '先从「记录饮食」开始，不用急着节食。记录本身就是干预。',
             '把目标换算成行为：不是「瘦5斤」，是「每天走30分钟」。'],
      '没反馈': ['平台期是身体的正常调整，别加码，保持住就是赢。',
                 '换个指标：量腰围、看裤子松紧，体重秤会骗人。',
                 '检查一下晚餐碳水和睡眠——这两个最容易卡住减重。']
    },
    '饮食': {
      base: ['晚餐少油少糖，不用节食，换个做法就能省下不少热量。',
             '备点低卡零食（小番茄、无糖酸奶），饿的时候别硬扛，硬扛容易暴食。',
             '先喝一杯水再决定要不要吃，很多时候是渴不是饿。']
    },
    '运动': {
      base: ['你散步 30 分钟已经是很好的开始，不用一上来就跑步。',
             '把运动绑在已有习惯上：比如「饭后必走」，不用额外做决定。',
             '加到 35 分钟，比加强度更容易坚持。']
    },
    '作息': {
      base: ['睡好才能记牢。今晚把手机放远一点，早睡 30 分钟。',
             '熬夜完成任务是透支，短期有效，长期会反噬。',
             '把最难的任务挪到早上，晚上自然不用熬。']
    },
    '心态': {
      base: ['天秤座别内耗：今天不需要做对选择，只需要做一件事。',
             '你不需要完美，你只需要回来。',
             '把「我做得好不好」换成「我今天落子了吗」，答案清楚得多。']
    },
    '效率': {
      base: ['走神很正常。试试 25 分钟番茄钟，响铃就停，别硬撑。',
             '手机放到看不见的地方，环境比意志力管用。',
             '把最容易分心的那个 App 设成「需要多一步才能打开」。'],
      '走神': ['先只做 10 分钟，做完了想停就停——开始了就不容易走神。',
               '给自己一个「走神本」：想到别的就写下来，告诉自己晚点处理。',
               '换到图书馆/自习室，环境的约束力远大于自制力。'],
      '拖延': ['拖延不是懒，是怕做不好。先做 5 分钟，不求结果。',
               '把任务缩到「不可能失败」的大小：比如只打开书。',
               '告诉自己「只做5分钟就可以停」——通常做了就停不下来。']
    },
    '行测': {
      base: ['行测靠手感，每天刷一组保持热度，比周末猛刷有效。',
             '先练正确率再练速度，顺序反了会两头空。',
             '错题归类：记「题型+卡点」，别只记答案。']
    },
    '申论': {
      base: ['申论卷面分很贵，每天练几行字，字迹就是分数。',
             '先看材料再做题，答案都在材料里，别自己编。',
             '每周完整写一篇，写不完就写一道小题。']
    }
  };

  /* 按情绪给的兜底建议（没有命中主题时用） */
  const ADVICE_BY_MOOD = {
    tired:    ['今天先减一子。休息不是放弃，是为了走更远。'],
    anxious:  ['焦虑的时候只做最小的一步。做完这一步，我们再谈下一步。'],
    giveUp:   ['今天不做决定。睡一觉，明天再看待办——它没你想的那么可怕。'],
    lost:     ['不知道做什么的时候，就做眼前最小的那件。方向是走出来的。'],
    stressed: ['事情太多就先写下来。写完之后你会发现，真正急的只有两三件。'],
    happy:    ['状态好就趁热推进最难的那件，别浪费这个窗口。'],
    proud:    ['值得高兴。现在把它变成常态，而不是高光。']
  };

  /* 生成建议：去重 + 递进（同一主题第二次遇到给进阶解法，不复读）
     dryRun=true 时只返回建议、不写入建议记忆（渲染展示用，避免刷新一次层级就 +1） */
  function suggest(ex, dryRun){
    ex = ex || { topics:[], blockers:[], emotion:'flat' };
    const topic = ex.topics[0] || null;
    const blocker = ex.blockers[0] || null;

    // 取候选池：优先「主题×阻碍」，其次「主题通用」，最后按情绪兜底
    let pool = null, key = topic || ('mood:' + ex.emotion);
    if(topic && ADVICE[topic]){
      pool = (blocker && ADVICE[topic][blocker]) ? ADVICE[topic][blocker] : ADVICE[topic].base;
    } else if(ADVICE_BY_MOOD[ex.emotion]){
      pool = ADVICE_BY_MOOD[ex.emotion];
    } else {
      pool = ['继续记录，我会慢慢读懂你的节奏。'];
    }

    // 递进层级：这个主题已经给到第几层了
    const lv = topic? (S.adviceLevelOf(topic) || 0) : 0;
    // 已给过的原话（本周内不重复）
    const given = (S.recentAdvice(7)||[]).map(a=> a.text);

    // 从第 lv 层开始找一条「本周没说过」的
    let chosen = null, chosenLv = 1;
    for(let i = 0; i < pool.length; i++){
      const idx = (lv + i) % pool.length;
      const cand = pool[idx];
      if(given.indexOf(cand) < 0){ chosen = cand; chosenLv = idx + 1; break; }
    }
    // 三层都给过了：不再复读，改口催行动（这才是军师该说的话）
    if(!chosen){
      const label = topic? ('「' + topic + '」') : '这件事';
      return {
        text: label + '我已经给了三条思路，再讲第四遍就是废话了。这一子该你落——挑最容易的那条，今天做完它。',
        topic, blocker, level: pool.length + 1, exhausted: true
      };
    }

    // 记入建议记忆，供下次递进（只读模式不写，避免渲染一次就跳一层）
    if(topic && !dryRun){
      S.pushAdvice({ id: topic + ':' + (blocker||'-'), topic, blocker, level: chosenLv, text: chosen });
    }
    return { text: chosen, topic, blocker, level: chosenLv };
  }

  /* =========================================================
     3. 规则矩阵：穷举「可能发生的情况」
     每条规则 = { id, pri, when(ctx), say(ctx) }
     fire() 返回按优先级排序的命中规则
     ========================================================= */
  const RULES = [
    /* --- 第一梯队：状态异常，必须先处理 --- */
    { id:'dropRisk', pri:100,
      when:c=> c.risk.level==='high',
      say:c=> pick(SPEECH.predict.dropRisk, c.date+'drop').replace('{reasons}', c.risk.reasons.slice(0,2).join('、')) },

    { id:'moodAlert', pri:95,
      when:c=> c.emo.level==='alert',
      say:c=> pick(SPEECH.predict.moodAlert, c.date+'mood').replace('{n}', c.emo.negativeRun) },

    { id:'streakBroken', pri:90,
      when:c=> c.streak===0 && c.lostDays>=1,
      say:c=> pick(SPEECH.predict.streakBroken, c.date+'broken') },

    { id:'coldStart', pri:88,
      when:c=> c.lostDays>=3,
      say:c=> pick(SPEECH.predict.coldStart, c.date+'cold') },

    /* --- 第二梯队：健康度与风险 --- */
    { id:'difficultyDown', pri:80,
      when:c=> c.diff.level==='down',
      say:c=> pick(SPEECH.predict.difficultyDown, c.date+'ddown').replace('{r}', pct(c.diff.rate7*100,100)) },

    { id:'difficultyUp', pri:78,
      when:c=> c.diff.level==='up',
      say:c=> pick(SPEECH.predict.difficultyUp, c.date+'dup').replace('{r}', pct(c.diff.rate7*100,100)) },

    { id:'nightStreak', pri:76,
      when:c=> c.nightStreak>=2 || c.nightRatio>=0.45,
      say:c=> pick(SPEECH.predict.nightStreak, c.date+'night').replace('{n}', Math.max(c.nightStreak, 2)) },

    { id:'categoryMiss', pri:74,
      when:c=> c.weakCats.length>0,
      say:c=> pick(SPEECH.predict.categoryMiss, c.date+'miss').replace('{t}', c.weakCats[0].title) },

    { id:'taskOverload', pri:72,
      when:c=> c.tasksTotal>=7,
      say:c=> pick(SPEECH.predict.taskOverload, c.date+'over').replace('{n}', c.tasksTotal) },

    { id:'perfectStall', pri:70,
      when:c=> c.pc.pendingPast>=4 && c.s7.rate>=0.5,
      say:c=> pick(SPEECH.predict.perfectStall, c.date+'perf') },

    /* --- 第三梯队：目标进度 --- */
    { id:'deadline', pri:65,
      when:c=> c.urgentGoals.length>0,
      say:c=>{ const g=c.urgentGoals[0];
        return pick(SPEECH.predict.deadline, c.date+'dl'+g.goal.id)
          .replace('{t}', g.goal.title).replace('{d}', g.remainDays).replace('{p}', Math.round(g.progRatio*100)); } },

    { id:'goalBehind', pri:62,
      when:c=> c.behindGoals.length>0,
      say:c=>{ const g=c.behindGoals[0];
        return pick(SPEECH.analysis.goalBehind, c.date+'bh'+g.goal.id)
          .replace('{t}', g.goal.title).replace('{p}', Math.round(g.progRatio*100)).replace('{w}', Math.round(g.timeRatio*100)); } },

    { id:'goalAhead', pri:58,
      when:c=> c.goals.some(g=>g.state==='ahead'),
      say:c=>{ const g=c.goals.filter(x=>x.state==='ahead')[0];
        return pick(SPEECH.analysis.goalAhead, c.date+'ah'+g.goal.id)
          .replace('{t}', g.goal.title).replace('{p}', Math.round(g.progRatio*100)); } },

    { id:'unbalanced', pri:56,
      when:c=> c.cat.list.length>=2 && c.cat.list[0].total>=5 && (c.cat.list[0].total - (c.cat.list[1]?c.cat.list[1].total:0)) >= 6,
      say:c=> pick(SPEECH.predict.unbalanced, c.date+'unb').replace('{t}', c.cat.list[0].title) },

    /* --- 第四梯队：节奏与习惯 --- */
    { id:'noReview', pri:50,
      when:c=> daysSinceLastNote()>=5,
      say:c=> pick(SPEECH.predict.noReview, c.date+'norev').replace('{d}', daysSinceLastNote()) },

    { id:'firstNote', pri:34,
      when:c=> daysSinceLastNote()===-1 && c.s7.total>=3,
      say:c=> '你还没写过随记。不用写长，一句话就行——今天哪里卡住了？我帮你记着，明天就不会再卡一次。' },

    { id:'procrastHigh', pri:48,
      when:c=> c.pc.level==='high',
      say:c=> pick(SPEECH.analysis.procrastHigh, c.date+'pro')
        .replace('{s}', c.pc.score).replace('{p}', c.pc.pendingPast) },

    { id:'trendDown', pri:46,
      when:c=> c.trend==='down' && c.s7.total>=5,
      say:c=> pick(SPEECH.analysis.trendDown, c.date+'td')
        .replace('{a}', pct(c.s7.rate*100,100)).replace('{b}', pct(c.s3.rate*100,100)) },

    { id:'trendUp', pri:44,
      when:c=> c.trend==='up' && c.s7.total>=5,
      say:c=> pick(SPEECH.analysis.trendUp, c.date+'tu')
        .replace('{a}', pct(c.s7.rate*100,100)).replace('{b}', pct(c.s3.rate*100,100)) },

    { id:'bestSlot', pri:42,
      when:c=> c.bestSlot && c.slotStats.total>=8,
      say:c=> pick(SPEECH.analysis.bestSlot, c.date+'slot').replace('{best}', c.bestSlotCN) },

    { id:'nightWarn', pri:40,
      when:c=> c.nightRatio>=0.35 && c.slotStats.total>=8,
      say:c=> pick(SPEECH.analysis.nightWarn, c.date+'nw').replace('{r}', Math.round(c.nightRatio*100)) },

    { id:'strongCat', pri:38,
      when:c=> c.strongCats.length>0,
      say:c=> pick(SPEECH.analysis.strong, c.date+'sc')
        .replace('{t}', c.strongCats[0].title).replace('{r}', Math.round(c.strongCats[0].rate*100)) },

    { id:'unusedFragment', pri:36,
      when:c=> c.slotStats.total>=5 && c.s7.rate>=0.6,
      say:c=> pick(SPEECH.predict.unusedFragment, c.date+'frag').replace('{t}', '碎片级') },

    /* --- 第五梯队：日历节奏（低优先级，兜底氛围） --- */
    { id:'weekendNear', pri:30,
      when:c=> c.weekday===4 || c.weekday===5,
      say:c=> pick(SPEECH.predict.weekendNear, c.date+'we') },

    { id:'weekend', pri:28,
      when:c=> c.isWeekend,
      say:c=> pick(SPEECH.special.weekend, c.date+'wend') },

    { id:'monthStart', pri:26,
      when:c=> c.isMonthStart,
      say:c=> pick(SPEECH.special.monthStart, c.date+'ms') },

    { id:'monthEnd', pri:24,
      when:c=> c.isMonthEnd,
      say:c=> pick(SPEECH.special.monthEnd, c.date+'me') },

    { id:'monday', pri:22,
      when:c=> c.weekday===1,
      say:c=> pick(SPEECH.special.monday, c.date+'mon') },

    { id:'slotTip', pri:20,
      when:c=> c.slot==='deepNight' || c.slot==='earlyMorning' || c.slot==='night',
      say:c=> pick(SPEECH.slot[c.slot], c.date+'sl') }
  ];

  function daysSinceLastNote(){
    const st = S.load();
    // 从未写过随记：返回 -1 表示"不适用"，避免对新手说「你已经 99 天没复盘」
    if(!st.notes || !st.notes.length) return -1;
    const last = st.notes[0].date;
    const d = new Date(last+'T00:00:00');
    return Math.floor((S.today() - d)/86400000);
  }

  function fireRules(ctx, limit){
    ctx = ctx || context();
    const hits = [];
    RULES.forEach(r=>{
      let ok = false;
      try{ ok = !!r.when(ctx); }catch(e){ ok = false; }
      if(ok){ hits.push({ id:r.id, pri:r.pri, text:r.say(ctx) }); }
    });
    hits.sort((a,b)=> b.pri - a.pri);
    return limit? hits.slice(0, limit) : hits;
  }

  /* =========================================================
     4. 决策算法：排序 / 编排 / 拆解
     ========================================================= */
  /* 任务优先级打分：紧急 × 重要 × 难度 × 精力 × 类别完成率 */
  function priorityScore(t, ctx){
    ctx = ctx || context();
    let score = 50;
    // 1) 目标紧急度
    const g = t.goalId? S.getGoal(t.goalId) : null;
    if(g){
      const h = goalHealth(g);
      if(h.state==='danger') score += 22;
      else if(h.state==='behind') score += 14;
      else if(h.state==='ahead') score -= 4;
      if(h.remainDays<=30 && h.remainDays>0) score += 10;
    }
    // 2) 类别完成率：弱项优先（补短板），但别过头
    const cstat = ctx.cat.list.find(x=> x.key===(t.goalId||'none'));
    if(cstat){
      if(cstat.rate < 0.5) score += 12;
      else if(cstat.rate >= 0.85) score -= 3;
    }
    // 3) 拖延惩罚：拖得越久越该做
    if(!t.done && t.date < ctx.date){
      const lag = Math.floor((new Date(ctx.date) - new Date(t.date))/86400000);
      score += Math.min(20, lag*4);
    }
    // 4) 难度与精力匹配：难的排在黄金时段附近（这里只加权，不排时）
    if(t.type==='evening' && (ctx.slot==='morning'||ctx.slot==='earlyMorning')) score -= 6;
    if(t.type==='fragment') score += 2;   // 碎片任务随时可做，先清掉
    // 5) 短任务优先：先易后难能保证完成率（行为设计）
    if((t.duration||15) <= 10) score += 6;
    else if((t.duration||15) >= 40) score -= 4;
    return clamp(Math.round(score), 0, 100);
  }

  /* 智能排序：返回按优先级排好的任务数组（不改数据，只给顺序建议） */
  function smartOrder(tasks, ctx){
    ctx = ctx || context();
    return tasks.slice().map(t=>({ task:t, score:priorityScore(t, ctx) }))
      .sort((a,b)=> b.score - a.score)
      .map(x=> x.task);
  }

  /* 拆解建议：把大任务拆成更小的可执行步骤 */
  function decompose(t){
    const title = t.title||'';
    const dur = t.duration||15;
    const steps = [];
    // 按常见任务语义给出拆解模板
    if(/背|单词|记/.test(title)){
      steps.push('过一遍今天的词汇表（5 分钟）');
      steps.push('遮住释义自测一遍（5 分钟）');
      steps.push('把没记住的单独抄一遍（5 分钟）');
    } else if(/听力|精听|连读/.test(title)){
      steps.push('整段盲听一遍，不暂停（3 分钟）');
      steps.push('逐句听写卡住的地方（10 分钟）');
      steps.push('对照原文，标出连读处（5 分钟）');
    } else if(/阅读|真题|刷题|卷/.test(title)){
      steps.push('限时做完一篇（15 分钟）');
      steps.push('对答案，标出错题（5 分钟）');
      steps.push('搞懂其中 2 道错题（10 分钟）');
    } else if(/操作题|excel|word|ppt|上机/i.test(title)){
      steps.push('看一遍操作步骤要点（5 分钟）');
      steps.push('照着做一遍，不求快（15 分钟）');
      steps.push('脱稿再做一遍（10 分钟）');
    } else if(/散步|跑步|运动|拉伸|走/.test(title)){
      steps.push('换好鞋出门（1 分钟）');
      steps.push('走满计划时长的一半');
      steps.push('走完剩下的，顺路把事办了');
    } else if(/复盘|总结|回顾/.test(title)){
      steps.push('今天完成了什么（1 行）');
      steps.push('哪里卡住了（1 行）');
      steps.push('明天先做什么（1 行）');
    } else {
      // 通用拆解：按时间切成可启动的小块
      steps.push('先把桌面/材料准备好（2 分钟）');
      steps.push('只做前 ' + Math.max(5, Math.round(dur/3)) + ' 分钟，不求做完');
      steps.push('做满 ' + Math.max(10, Math.round(dur/2)) + ' 分钟');
      steps.push('收尾：把没做完的部分写清楚，交给明天');
    }
    return { title, steps };
  }

  /* 下一步最优行动：综合所有因子，给出「现在该做什么」 */
  function nextBestAction(ctx){
    ctx = ctx || context();
    const today = S.tasksOf(ctx.date).filter(t=> !t.done);
    if(!today.length) return { text:'今天没有待办。落一子也好——用一句话告诉我你想做什么，我替你拆。', task:null };
    const ordered = smartOrder(today, ctx);
    const top = ordered[0];
    const g = top.goalId? S.getGoal(top.goalId) : null;
    let text = '下一步：' + top.title;
    if(g) text += '（' + g.title + '）';
    text += '，约 ' + (top.duration||15) + ' 分钟。';
    if((top.duration||15) >= 30){
      const d = decompose(top);
      text += ' 有点大？先只做第一步：' + d.steps[0] + '。';
    }
    return { text, task: top, ordered };
  }

  /* =========================================================
     5. 对外生成器
     ========================================================= */

  /* 5.1 今日指令（丰富版）：情境 + 时段 + 规则命中 */
  function command(dateStr){
    const c = context(dateStr);
    const lines = [];
    // (1) 时段问候 + 精力判断
    const slotLine = pick(SPEECH.slot[c.slot] || [], c.date + 'cmdslot');
    // (2) 日历氛围（周一/周末/月末）
    let calLine = '';
    if(c.isWeekend) calLine = pick(SPEECH.special.weekend, c.date+'cmdwe');
    else if(c.weekday===1) calLine = pick(SPEECH.special.monday, c.date+'cmdmon');
    else if(c.weekday===5) calLine = pick(SPEECH.special.friday, c.date+'cmdfri');
    else if(c.isMonthStart) calLine = pick(SPEECH.special.monthStart, c.date+'cmdms');
    else if(c.isMonthEnd) calLine = pick(SPEECH.special.monthEnd, c.date+'cmdme');
    // (3) 主线：优先「最掉队」的那条线（危险 > 滞后 > 正常 > 超前），同级比谁更落后
    //     军师的职责是补缺口，不是给已经领先的目标锦上添花
    const RANK = { danger:0, behind:1, ontrack:2, ahead:3, done:4 };
    const focus = c.goals.filter(g=> g.state!=='done')
      .sort((a,b)=> (RANK[a.state] - RANK[b.state])
                 || ((a.progRatio - a.timeRatio) - (b.progRatio - b.timeRatio)))[0]
      || c.goals[0];
    let mainLine = '';
    if(focus){
      const g = focus.goal;
      const stage = (g.stages||[])[g.stageIndex];
      const stName = stage? stage.name : '推进中';
      const weekNo = S.weekOf(g.createdAt);
      mainLine = '「' + g.title + '·' + stName + '」第 ' + weekNo + ' 周，进度 ' + Math.round(focus.progRatio*100) + '%。';
      if(focus.state==='behind' || focus.state==='danger'){
        mainLine += '这条线有点落后，今天优先给它一子。';
      } else if(focus.state==='ahead'){
        mainLine += '进度超前，今天可以把时间匀一点给弱项。';
      } else {
        mainLine += '按计划走，稳住。';
      }
    }
    // (4) 命中规则里最重要的一条（若有）
    const hits = fireRules(c, 1);
    const ruleLine = hits.length? hits[0].text : '';
    // (5) 连续天数
    let streakLine = '';
    if(c.streak>=1){
      const key = nearestStreakKey(c.streak);
      const tpl = SPEECH.streak[key] || SPEECH.streakFallback;
      streakLine = pick(tpl, c.date+'cmdst').replace('{n}', c.streak);
    }
    // 组装：主线 → 规则 → 时段/日历 → 连续
    [mainLine, ruleLine, calLine || slotLine, streakLine].forEach(x=>{ if(x) lines.push(x); });
    const msg = lines.join(' ') || '今天先落一子，后面我替你安排。';
    return { who:'摆渡人指令', msg, ctx:c, hits };
  }

  function nearestStreakKey(n){
    const keys = Object.keys(SPEECH.streak).map(Number).sort((a,b)=>b-a);
    for(const k of keys){ if(n >= k) return k; }
    return null;
  }

  /* 5.2 完成反馈（按完成率分档 + 连续天数 + 情报） */
  function feedback(){
    const st = S.load();
    const c = context();
    const rate = c.todayRate==null? 0 : c.todayRate;
    let bucket = 'none';
    if(c.tasksTotal>0 && rate>=1){
      // 是否有超额（今日完成的自动任务之外还有额外）
      bucket = (c.tasksTotal>=6)? 'over' : 'full';
    }
    else if(rate>=0.75) bucket='high';
    else if(rate>=0.5) bucket='mid';
    else if(rate>=0.25) bucket='low';
    else if(rate>0) bucket='tiny';

    let msg = pick(SPEECH.complete[bucket], c.date+'fb');
    // 连续天数加成
    if(c.streak>=1){
      const key = nearestStreakKey(c.streak);
      const tpl = SPEECH.streak[key] || SPEECH.streakFallback;
      const stLine = pick(tpl, c.date+'fbst').replace('{n}', c.streak);
      // 关键节点（3/7/14/30/100）单独强调，普通天数不重复播报
      if([3,7,14,21,30,50,100,180,365].indexOf(c.streak)>=0){
        msg = stLine + ' ' + msg;
      }
    }
    return { msg, intel: c.intel, rate: Math.round(rate*100), bucket, ctx:c };
  }

  /* 5.3 情绪回应（20 类情绪） */
  function emotionReply(note){
    if(!note) return '';
    const mood = note.emotion || 'flat';
    const pool = SPEECH.mood[mood] || SPEECH.mood.flat;
    const base = pick(pool, (note.id||'') + mood);
    // 若情绪告急，追加一句支持
    const c = context();
    if(c.emo.level==='alert' && mood!=='happy' && mood!=='proud'){
      return base + ' 另外——你已经连着 ' + c.emo.negativeRun + ' 天状态不好了。任务我先给你减一子，你比任务重要。';
    }
    return base;
  }

  /* 5.4 预判（规则矩阵全量命中） */
  function predictions(limit){
    const c = context();
    return fireRules(c, limit || 3).map(h=>({ id:h.id, text:h.text }));
  }

  /* 5.5 深度分析（周报用） */
  function deepAnalysis(){
    const c = context();
    const out = { good:[], bad:[], next:[], stats:{} };
    out.stats = {
      rate7: Math.round(c.s7.rate*100),
      rate3: Math.round(c.s3.rate*100),
      done7: c.s7.done, total7: c.s7.total,
      streak: c.streak,
      bestSlot: c.bestSlotCN,
      nightRatio: Math.round(c.nightRatio*100),
      procrast: c.pc.score,
      risk: c.risk.score,
      notes: c.emo.total
    };
    // 亮点
    if(c.strongCats.length){
      out.good.push(pick(SPEECH.analysis.strong, 'w'+c.date)
        .replace('{t}', c.strongCats[0].title)
        .replace('{r}', Math.round(c.strongCats[0].rate*100)));
    }
    if(c.trend==='up') out.good.push(pick(SPEECH.analysis.trendUp, 'w2'+c.date)
      .replace('{a}', out.stats.rate7).replace('{b}', out.stats.rate3));
    const ahead = c.goals.filter(g=>g.state==='ahead');
    if(ahead.length) out.good.push(pick(SPEECH.analysis.goalAhead, 'w3'+c.date)
      .replace('{t}', ahead[0].goal.title).replace('{p}', Math.round(ahead[0].progRatio*100)));
    // 问题
    if(c.weakCats.length){
      out.bad.push(pick(SPEECH.analysis.weak, 'w4'+c.date)
        .replace('{t}', c.weakCats[0].title).replace('{r}', Math.round(c.weakCats[0].rate*100)));
    }
    if(c.trend==='down') out.bad.push(pick(SPEECH.analysis.trendDown, 'w5'+c.date)
      .replace('{a}', out.stats.rate7).replace('{b}', out.stats.rate3));
    if(c.behindGoals.length){
      const g = c.behindGoals[0];
      out.bad.push(pick(SPEECH.analysis.goalBehind, 'w6'+c.date)
        .replace('{t}', g.goal.title).replace('{p}', Math.round(g.progRatio*100)).replace('{w}', Math.round(g.timeRatio*100)));
    }
    if(c.pc.level!=='low') out.bad.push(pick(SPEECH.analysis.procrastHigh, 'w7'+c.date)
      .replace('{s}', c.pc.score).replace('{p}', c.pc.pendingPast));
    if(c.nightRatio>=0.35) out.bad.push(pick(SPEECH.analysis.nightWarn, 'w8'+c.date)
      .replace('{r}', Math.round(c.nightRatio*100)));
    // 下周布局
    out.next.push('强度：' + c.diff.note);
    if(c.bestSlotCN) out.next.push('把最难的排在' + c.bestSlotCN + '（你的高效时段）。');
    if(c.weakCats.length) out.next.push('「' + c.weakCats[0].title + '」提高频次、降低单次难度。');
    if(c.urgentGoals.length) out.next.push('「' + c.urgentGoals[0].goal.title + '」进入倒计时，优先级上调。');
    if(c.risk.level!=='low') out.next.push('风险提示：' + c.risk.reasons.slice(0,2).join('、') + '——下周先减量两天。');
    return out;
  }

  /* 5.6 综合简报（一段话把当前局势说清楚） */
  function briefing(){
    const c = context();
    const parts = [];
    parts.push('近 7 天完成 ' + c.s7.done + '/' + c.s7.total + '（' + Math.round(c.s7.rate*100) + '%）');
    if(c.bestSlotCN) parts.push('高效时段是' + c.bestSlotCN);
    if(c.weakCats.length) parts.push('短板是「' + c.weakCats[0].title + '」');
    if(c.strongCats.length) parts.push('强项是「' + c.strongCats[0].title + '」');
    const hits = fireRules(c, 1);
    if(hits.length) parts.push(hits[0].text);
    return {
      summary: parts.join('；') + '。',
      risk: c.risk, diff: c.diff, trend: c.trend, ctx: c
    };
  }

  /* =========================================================
     6. 导出
     ========================================================= */
  window.ZQ = window.ZQ || {};
  window.ZQ.brain = {
    // 工具
    hash, pick, clamp, pct, timeSlotOf, SLOT_CN,
    // 分析
    context, completionStats, timeSlotStats, categoryStats, habitStrength,
    procrastinationIndex, emotionTrend, goalHealth, allGoalHealth, dropOffRisk,
    difficultySuggest, trendOf, daysSinceLastNote, goalTotalWeeks,
    // 决策
    priorityScore, smartOrder, decompose, nextBestAction,
    // 随记语义抽取与建议引擎
    MOOD_LEX, TOPIC_LEX, BLOCKER_LEX, ADVICE, ADVICE_BY_MOOD,
    detectMood, extract, suggest,

    // 规则与生成
    RULES, fireRules, SPEECH,
    command, feedback, emotionReply, predictions, deepAnalysis, briefing,
    nearestStreakKey
  };
})();
