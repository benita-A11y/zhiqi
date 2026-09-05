/* =========================================================
   执棋 · 军师深度大脑 (mind.js)
   —— 架在 brain.js（规则矩阵）与 oracle.js（预测算法）之上的第三层：

      ① 人格引擎  ：按星座 / MBTI 调整判断阈值与说话口吻
      ② 深度度量  ：动量、倦怠、过度承诺、决策负荷、均衡度、平台期、恢复需求
      ③ 落子规划  ：把一天的任务排成「开局 / 中盘 / 收官」三段棋
      ④ 情境扫描  ：穷举近 30 种可能处境，全部算出并按优先级排序
      ⑤ 话语库    ：按处境分装，每条多套，hash 稳定选取（同一天不闪变）

   三条设计铁律（务必遵守，否则会拖垮整个 App）：
      1. 只读不写 —— 本模块任何函数都【不修改 state】，只做分析与出话，
         避免和 store 的保存 / 云同步逻辑打架。
      2. 永不抛错 —— 所有对外接口包 safe()，最坏返回 null 或兜底句。
         军师可以算不出来，但绝不能让整页白屏。
      3. 完全离线 —— 无网络请求、无外部依赖、无 DOM 操作。
   ========================================================= */
(function(){
  const S = window.ZQ.store;
  const B = window.ZQ.brain;
  const O = window.ZQ.oracle;

  /* =========================================================
     0. 工具
     ========================================================= */
  function num(v, dft){ return (typeof v === 'number' && isFinite(v)) ? v : dft; }
  function clamp01(v){ return Math.max(0, Math.min(1, num(v, 0))); }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, num(v, a))); }
  function todayStr(){ try{ return S.fmtDate(S.today()); }catch(e){ return ''; } }
  function dayStr(off){ try{ return S.fmtDate(S.shiftDay(S.today(), off)); }catch(e){ return ''; } }

  /* 稳定选句：优先复用 brain 的 FNV-1a hash，保证与既有话术同一套「当日不闪变」机制 */
  function pick(arr, seed){
    if(!arr || !arr.length) return '';
    try{ if(B && B.pick) return B.pick(arr, seed); }catch(e){}
    let h = 0; const s = String(seed);
    for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
    return arr[h % arr.length];
  }
  function pct(x){ try{ return (B && B.pct) ? B.pct(x) : Math.round(x); }catch(e){ return Math.round(x); } }
  /* 兜底执行器：任何分析出错都返回 dft，绝不把异常抛给调用方 */
  function safe(fn, dft){ try{ const r = fn(); return (r === undefined || r === null) ? dft : r; }catch(e){ return dft; } }
  function fill(tpl, map){
    let s = String(tpl == null ? '' : tpl);
    for(const k in map) s = s.split('{'+k+'}').join(String(map[k]));
    return s;
  }

  /* =========================================================
     1. 人格引擎
     —— 天秤座 ISFJ 的行为特征，直接翻译成算法的阈值与口径：
        · 天秤：追求平衡、选择困难、厌恶冲突 → 军师要【替他选好】，且各条线都要推进
        · ISFJ：责任感强、怕让人失望、容易硬扛、易自责、内向需独处充电
                → 军师要【主动减量】、【先接住再分析】、【留白】
     ========================================================= */
  function persona(){
    return safe(function(){
      const st = S.load();
      const p  = (st && st.profile) || {};
      const sign = String(p.sign || '天秤座');
      const mbti = String(p.mbti || 'ISFJ').toUpperCase();
      const isLibra = /天秤|天平|LIBRA/.test(sign);
      const isISFJ  = mbti.indexOf('I') === 0 && mbti.indexOf('S') === 1
                   && mbti.indexOf('F') === 2 && mbti.indexOf('J') === 3;
      return {
        sign, mbti, isLibra, isISFJ,
        /* —— 以下开关是军师「性格」的量化，后续算法都会读它 —— */
        decisive:       false,  // 不喜欢自己做选择 → 军师必须给唯一明确答案，不给多选题
        overcommitProne:isISFJ, // 容易硬扛 → 负荷一超标就要主动砍量
        selfBlameProne: isISFJ, // 容易自责 → 没完成时先安抚，再谈改进
        needsBalance:   isLibra,// 天平 → 重视各目标均衡推进，反对单线猛压
        needsSoloTime:  isISFJ, // 内向 → 连续作战后必须安排留白
        gentleTone:     true,   // 全程温和，不催促、不施压、不用红点
        /* 阈值：ISFJ 比一般人更早触发「减量」和「休息」建议 */
        overcommitLimit: isISFJ ? 1.15 : 1.30,  // 承诺 / 可用 超过此倍数即判定过度承诺
        restAfterDays:   isISFJ ? 5    : 7      // 连续作战多少天后建议安排喘息
      };
    }, { sign:'天秤座', mbti:'ISFJ', isLibra:true, isISFJ:true,
         decisive:false, overcommitProne:true, selfBlameProne:true,
         needsBalance:true, needsSoloTime:true, gentleTone:true,
         overcommitLimit:1.15, restAfterDays:5 });
  }

  /* =========================================================
     2. 深度度量
     ========================================================= */

  /* 2.1 当前精力：优先复用 oracle 的生理节律模型，拿不到就用内置曲线兜底 */
  const ENERGY_CURVE = [.30,.25,.28,.35,.50,.65,.78,.88,.90,.86,.82,.78,
                        .62,.66,.72,.78,.82,.86,.82,.74,.64,.54,.44,.35];
  function energyNow(dateStr){
    return safe(function(){
      const ds = dateStr || todayStr();
      let e = null;
      try{
        const m = (O && O.energyModel) ? O.energyModel(ds) : null;
        if(typeof m === 'number') e = m;
        else if(m && typeof m === 'object'){
          if(typeof m.value === 'number')   e = m.value;
          else if(typeof m.now === 'number')e = m.now;
          else if(typeof m.current === 'number') e = m.current;
          else if(m.slots && typeof m.slots === 'object'){
            const k = String(new Date().getHours());
            if(typeof m.slots[k] === 'number') e = m.slots[k];
          }
        }
      }catch(err){ e = null; }
      if(e == null){
        const h = new Date().getHours();
        e = (ENERGY_CURVE[h] != null) ? ENERGY_CURVE[h] : 0.6;
      }
      // oracle 可能返回 0~100 而不是 0~1，统一归一化
      if(e > 1) e = e / 100;
      return clamp01(e);
    }, 0.6);
  }

  /* 2.2 动量：近期完成率的时间加权平均，并与上一个等长窗口比较得出趋势 */
  function momentum(days){
    days = days || 7;
    return safe(function(){
      const st = S.load();
      function windowRate(startOff){
        let num = 0, den = 0;
        for(let i=0;i<days;i++){
          const ds = dayStr(-(startOff + i));
          const arr = (st.tasks && st.tasks[ds]) || [];
          if(!arr.length) continue;
          const r = arr.filter(t=>t.done).length / arr.length;
          const w = Math.pow(0.85, i);          // 越近的权重越高
          num += r * w; den += w;
        }
        return den ? num / den : null;
      }
      const cur = windowRate(0);
      const prv = windowRate(days);
      let trend = 'flat', delta = 0;
      if(cur != null && prv != null){
        delta = cur - prv;
        if(delta >  0.12) trend = 'up';
        else if(delta < -0.12) trend = 'down';
      }
      const activeDays = (function(){
        let n = 0;
        for(let i=0;i<days;i++){ const a = (st.tasks && st.tasks[dayStr(-i)]) || []; if(a.length) n++; }
        return n;
      })();
      return { score: cur, prev: prv, trend, delta, activeDays,
               label: trend === 'up' ? '上扬' : trend === 'down' ? '下滑' : '平稳' };
    }, { score:null, prev:null, trend:'flat', delta:0, activeDays:0, label:'平稳' });
  }

  /* 2.3 今日承诺：任务总时长 vs 可用时长（工作日/周末容量不同） */
  function commitment(dateStr){
    return safe(function(){
      const ds  = dateStr || todayStr();
      const arr = S.tasksOf(ds) || [];
      let planned = 0, done = 0;
      arr.forEach(t=>{
        const d = num(t.duration, 15);
        planned += d;
        if(t.done) done += d;
      });
      const wd = new Date(ds + 'T00:00:00').getDay();
      const isWeekend = (wd === 0 || wd === 6);
      const capacity = isWeekend ? 240 : 180;          // 与 oracle 的 CAPACITY 保持一致
      const ratio = capacity ? planned / capacity : 0;
      return { planned, done, remain: Math.max(0, planned - done), capacity, ratio,
               isWeekend, level: ratio > 1.4 ? 'over' : ratio > 1.0 ? 'tight' : 'ok' };
    }, { planned:0, done:0, remain:0, capacity:180, ratio:0, isWeekend:false, level:'ok' });
  }

  /* 2.4 倦怠风险：五个信号加权 —— 连续作战、深夜、高负荷、情绪走低、动量下滑 */
  function burnoutRisk(dateStr){
    return safe(function(){
      const ds = dateStr || todayStr();
      const pf = persona();
      const st = S.load();
      const u  = (st && st.undercover) || {};
      const cm = commitment(ds);
      const mo = momentum(7);
      const reasons = [];
      let score = 0;

      const streak = num(u.streak, 0);
      if(streak >= pf.restAfterDays){ score += 25; reasons.push('连续' + streak + '天没停过'); }

      const night = num(u.nightDoneStreak, 0);
      if(night >= 2){ score += 20; reasons.push('连着' + night + '天深夜收尾'); }

      if(cm.level === 'over'){ score += 20; reasons.push('今天排得太满'); }
      else if(cm.level === 'tight'){ score += 10; reasons.push('今天的量偏紧'); }

      if(mo.trend === 'down'){ score += 20; reasons.push('完成率在往下走'); }

      // 近 7 天夜间（23点后 / 5点前）完成占比
      let nightCnt = 0, allCnt = 0;
      for(let i=0;i<7;i++){
        const a = (st.tasks && st.tasks[dayStr(-i)]) || [];
        a.forEach(t=>{
          if(!t.done || !t.doneAt) return;
          allCnt++;
          const h = new Date(t.doneAt).getHours();
          if(h >= 23 || h < 5) nightCnt++;
        });
      }
      if(allCnt >= 5 && nightCnt / allCnt >= 0.4){ score += 15; reasons.push('近半任务在深夜完成'); }

      const level = score >= 60 ? 'high' : score >= 35 ? 'mid' : 'low';
      return { score: Math.min(100, score), level, reasons };
    }, { score:0, level:'low', reasons:[] });
  }

  /* 2.5 决策负荷：待排程数量越多，天秤座的「选择困难」越严重。
         军师的正确做法不是列更多选项，而是直接替他定一个。 */
  function decisionLoad(dateStr){
    return safe(function(){
      const ds = dateStr || todayStr();
      const st = S.load();
      const inbox = ((st.tasks && st.tasks.INBOX) || []).filter(t=>!t.done).length;
      const today = S.tasksOf(ds) || [];
      // 没有明确时间的任务 = 需要临场再决定一次，是隐性决策成本
      const noTime = today.filter(t=>!t.done && !t.time).length;
      const goals  = (st.goals || []).filter(g=>g.status !== 'done').length;
      const score  = inbox * 3 + noTime * 2 + goals * 1;
      const level  = score >= 18 ? 'high' : score >= 10 ? 'mid' : 'low';
      return { inbox, noTime, goals, score, level };
    }, { inbox:0, noTime:0, goals:0, score:0, level:'low' });
  }

  /* 2.6 一周均衡度：天秤座在意「各条线都在走」。
         用本周各目标的任务数分布的均衡度衡量（1 = 完全均衡）。 */
  function weekBalance(){
    return safe(function(){
      const st = S.load();
      const counts = {};
      for(let i=0;i<7;i++){
        const a = (st.tasks && st.tasks[dayStr(-i)]) || [];
        a.forEach(t=>{ const k = t.goalId || '__none__'; counts[k] = (counts[k]||0) + 1; });
      }
      const vals = Object.keys(counts).map(k=>counts[k]);
      const total = vals.reduce((a,b)=>a+b, 0);
      if(total === 0) return { balance:1, total:0, top:null, topShare:0, level:'ok' };
      // 基尼式的均衡度：完全集中在一条线 = 0；完全平均 = 1
      const n = vals.length;
      const ideal = total / n;
      let dev = 0;
      vals.forEach(v=>{ dev += Math.abs(v - ideal); });
      const balance = clamp01(1 - (dev / (2 * total * (n - 1) / Math.max(1, n))));
      let topKey = null, topVal = -1;
      Object.keys(counts).forEach(k=>{ if(counts[k] > topVal){ topVal = counts[k]; topKey = k; } });
      const topGoal = (topKey && topKey !== '__none__') ? safe(function(){ return S.getGoal(topKey); }, null) : null;
      return { balance, total,
               top: topGoal ? topGoal.title : (topKey === '__none__' ? '零散事务' : null),
               topShare: total ? topVal / total : 0,
               level: balance < 0.45 ? 'low' : balance < 0.7 ? 'mid' : 'ok' };
    }, { balance:1, total:0, top:null, topShare:0, level:'ok' });
  }

  /* 2.7 平台期：某目标连续多日进度无变化，或长期未触碰 */
  function plateau(days){
    days = days || 10;
    return safe(function(){
      const st = S.load();
      const out = [];
      (st.goals || []).forEach(g=>{
        if(g.status === 'done') return;
        // 该目标最近一次被完成任务是什么时候
        let lastTouch = null;
        for(let i=0;i<days+20 && lastTouch === null;i++){
          const ds = dayStr(-i);
          const a  = (st.tasks && st.tasks[ds]) || [];
          if(a.some(t=>t.goalId === g.id && t.done)) lastTouch = i;
        }
        const idle = (lastTouch === null) ? 999 : lastTouch;
        if(idle >= days){
          out.push({ goal:g, title:g.title, idleDays: idle === 999 ? null : idle,
                     neverTouched: idle === 999 });
        }
      });
      return { list: out, has: out.length > 0, worst: out.length ? out[0] : null };
    }, { list:[], has:false, worst:null });
  }

  /* 2.8 恢复需求：连续作战 + 深夜 + 情绪走低 → 该留白 */
  function recoveryNeed(dateStr){
    return safe(function(){
      const pf = persona();
      const st = S.load();
      const u  = (st && st.undercover) || {};
      const streak = num(u.streak, 0);
      const night  = num(u.nightDoneStreak, 0);
      const bo = burnoutRisk(dateStr);
      let score = 0; const reasons = [];
      if(streak >= pf.restAfterDays){ score += 40; reasons.push('已经连着' + streak + '天'); }
      if(night >= 2){ score += 25; reasons.push('总在深夜收尾'); }
      if(bo.level === 'high'){ score += 25; reasons.push('身体在发信号'); }
      const emo = safe(function(){ return B ? B.emotionTrend() : null; }, null);
      if(emo && emo.level === 'alert'){ score += 20; reasons.push('情绪有点撑不住'); }
      return { score: Math.min(100, score), level: score >= 60 ? 'high' : score >= 35 ? 'mid' : 'low', reasons };
    }, { score:0, level:'low', reasons:[] });
  }

  /* =========================================================
     3. 落子规划 —— 本模块的核心，把「待办清单」升级成「一盘棋」

     下棋的逻辑：没有人开局就攻中路。
       开局（先手）：最短最轻的子，用来破冰、起势、骗过自己的惰性
       中盘       ：最硬的那一步，放在精力最高的时候，定胜负
       收官       ：琐碎但必要的扫尾，低精力也能做
     ========================================================= */
  function movePlan(dateStr){
    return safe(function(){
      const ds = dateStr || todayStr();
      const arr = (S.tasksOf(ds) || []).filter(t=>!t.done);
      if(!arr.length){
        return { opening:[], middlegame:[], endgame:[], total:0, empty:true,
                 why:'今天棋盘是空的。去「谋局」里挑一件事，或者让军师替你排。' };
      }
      // 难度代理：时长越长、越靠后 order 越大 = 越重
      const scored = arr.map(t=>{
        let w = num(t.duration, 15);
        // 有明确时间窗的任务视为「中盘硬子」（通常是正式安排）
        if(t.time) w += 20;
        // 碎片类天然适合开局/收官
        if(t.type === 'fragment') w -= 8;
        if(t.type === 'habit')    w -= 5;
        // 复用 brain 的优先级评分作为重要性参考
        let pri = 50;
        try{ if(B && B.priorityScore){ const c = B.context(ds); pri = B.priorityScore(t, c); } }catch(e){}
        return { t, w, pri };
      });

      const byLight = scored.slice().sort((a,b)=> a.w - b.w);
      const byHeavy = scored.slice().sort((a,b)=> (b.pri*1.0 + b.w*0.6) - (a.pri*1.0 + a.w*0.6));

      const opening = [];
      const middlegame = [];
      const endgame = [];
      const used = {};

      // 开局：取最轻的 1~2 子（总量大时取 2，否则取 1）
      const openN = arr.length >= 4 ? 2 : 1;
      byLight.forEach(x=>{ if(opening.length < openN && !used[x.t.id]){ opening.push(x.t); used[x.t.id]=1; } });

      // 中盘：取最重要的 1~2 子（优先带时间窗的硬任务）
      const midN = arr.length >= 6 ? 2 : 1;
      byHeavy.forEach(x=>{ if(middlegame.length < midN && !used[x.t.id]){ middlegame.push(x.t); used[x.t.id]=1; } });

      // 收官：剩下的，按从轻到重（先扫掉容易的，心理负担递减）
      byLight.forEach(x=>{ if(!used[x.t.id]){ endgame.push(x.t); used[x.t.id]=1; } });

      const mins = a => a.reduce((s,t)=>s + num(t.duration,15), 0);
      return {
        opening, middlegame, endgame,
        total: arr.length,
        empty: false,
        openMin: mins(opening), midMin: mins(middlegame), endMin: mins(endgame),
        why: '先手' + opening.length + '子（约' + mins(opening) + '分钟）起势，中盘啃'
             + middlegame.length + '子（约' + mins(middlegame) + '分钟）定胜负，剩下'
             + endgame.length + '子收官。别打乱顺序——开局就攻中路，是最常见的输法。'
      };
    }, { opening:[], middlegame:[], endgame:[], total:0, empty:true, why:'' });
  }

  /* 3.2 微起步：把任何任务压成「不可能失败」的第一步（专治拖延 + 完美主义） */
  function microStart(task){
    return safe(function(){
      const title = (task && task.title) || '这件事';
      const d = num(task && task.duration, 15);
      const tiny = Math.max(2, Math.min(10, Math.round(d * 0.2)));
      const forms = [
        '只做' + tiny + '分钟：' + title + '。做满就停，不算违约。',
        '先别管做完。把「' + title + '」摆到面前，打开，就算落子。',
        '把「' + title + '」缩到最小：只完成它的第一个动作。',
        '给「' + title + '」' + tiny + '分钟。计时器一响，允许你立刻停下。'
      ];
      return { text: pick(forms, title + todayStr()), minutes: tiny, title };
    }, { text:'先做最小的一步。', minutes:5, title:'这件事' });
  }

  /* 3.3 大局观：把今天的这一子，放回十年棋局里看。
         这是「激励用户越来越好」的关键——让他看见小动作的长远意义。 */
  function bigPicture(dateStr){
    return safe(function(){
      const ds = dateStr || todayStr();
      const st = S.load();
      const u  = (st && st.undercover) || {};
      const goals = (st.goals || []).filter(g=>g.status !== 'done');
      const goal  = goals[0];
      const name  = goal ? goal.title : '你自己';
      const streak = num(u.streak, 0);
      const intel  = num(u.intelFragments, 0);
      const lines = [
        '今天这一子，单看很轻。但同样的子落下' + Math.max(30, streak*7) + '次，就是另一个人。',
        '你不是在「' + name + '」上花时间，你是在把未来的自己一点点兑换出来。',
        '十年后回看今天，你不会记得做了多少，只会记得「那时候我没停」。',
        '情报碎片已攒到' + intel + '片。棋子会丢，棋力不会。',
        '大局不是某天突然漂亮起来的，是很多个「今天先落一子」叠出来的。'
      ];
      return { text: pick(lines, ds + 'big'), goal: goal || null };
    }, { text:'今天先落一子。', goal:null });
  }

  /* =========================================================
     4. 话语库 —— 按处境分装，每条多套
     新增话语请直接往对应数组里 push 字符串即可，
     选句会自动带上「当日稳定」的 hash，不会每次刷新都换一句。
     占位符用 {n} {t} {d} 形式，由 fill() 填充。
     ========================================================= */
  const LINES = {
    /* 开局：今天还没落第一子 */
    firstTask: [
      '今天第一子，别挑难的。挑最短的那个，先让手动起来。',
      '开局不要攻中路。先捡最轻的一子落下，气势一起来，后面就顺了。',
      '还没开始？没关系。现在就挑一件五分钟内能做完的，先落子。',
      '别想着今天要全部做完。先做第一个，棋局就活了。'
    ],
    /* 过度承诺：ISFJ 最容易硬扛，必须主动砍量 */
    overcommit: [
      '今天你给自己排了{n}分钟，超出你实际能扛的。这不是自律，是在预支明天的力气——我替你砍掉一子。',
      '量给多了。完成率掉下来的时候，人最先放弃的不是任务，是自己。今天留一子给明天。',
      '{n}分钟的任务量，对这个作息来说偏重。减一子不是退步，是为了明天还走得动。',
      '你总是答应得太满。今天我先替你划掉最不紧急的那个——你不用什么都做完。'
    ],
    /* 选择困难：天秤座的经典困境，军师要替他定 */
    decisionFatigue: [
      '{n}件事在等你决定。别选了——先做我排在最前面的那个，剩下的今晚我再排。',
      '你的清单太长了，长到让人不想打开。今天只认第一子，其它的我先替你收着。',
      '选择本身就在消耗你。今天不做选择，照我给的顺序走就行。',
      '待安排里有{n}件悬着。悬着最累人——我先把它们按轻重排好，你只看第一个。'
    ],
    /* 失衡：某条线独占，天秤座需要各线推进 */
    imbalance: [
      '近一周「{t}」占了你大半的时间。棋局最怕单边冒进——别的线断了，大局会跟着塌。今天匀一子给其它目标。',
      '你在「{t}」上压得很重，其它目标几乎没动。天平要两边都放东西才稳，今天往另一头加一点。',
      '一条线跑太快，其它线追不上，这盘棋会走形。今天给冷落的那条线落一子。'
    ],
    /* 平台期 */
    plateau: [
      '「{t}」已经{d}天没动了。不是你忘了，是它卡住了。今天只推它一小步，别求多。',
      '「{t}」停在那儿有一阵了。平台期最熬人，但往往再走一步就通——今天给它一子。',
      '有件事你已经很久没碰了：「{t}」。不用补回来，今天只落一子，让它重新进入棋局。'
    ],
    /* 倦怠 */
    burnout: [
      '你在硬撑。{reasons}——现在减量不是放弃，是让这盘棋还能下下去。',
      '身体已经在发信号了：{reasons}。今天只保一子，其余的我来扛。',
      '撑不是本事，撑得住才是。{reasons}，今天先把最要紧的那一子落下就好。'
    ],
    /* 该休息 */
    rest: [
      '连着走了{d}天，该歇一子了。今天只做最轻的那件，剩下的明天补——棋局不会因为你歇一天就输。',
      '你需要留白。今天我给你排到最简，做完就去休息。休息也是落子的一部分。',
      '已经连轴{d}天。真正会下棋的人知道：该收子的时候收子，才有下一局。'
    ],
    /* 自责安抚：ISFJ 最容易自我攻击 */
    selfBlame: [
      '昨天没做完，不是你不行。是量给多了——我今天就调。你不用为一个安排不当的清单自责。',
      '没完成不等于没努力。棋盘上今天少一子，明天补回来就是，别急着否定自己。',
      '你对自己太狠了。换个人拿着你这份清单，未必做得比你好。今天我减量，你照做。',
      '一次没做完，不代表这盘棋输了。真正输的方式只有一个：因为一次没做好，就再也不落子。'
    ],
    /* 断后回归 */
    comeback: [
      '回来了就好。断过{d}天，但棋盘还在——今天只落一子，就算你赢。',
      '你回来了。这比什么都重要。今天不做多的，五分钟，一子，够了。',
      '中间空了几天，没关系。真正可惜的是因为空了几天，就干脆不来。你来了。'
    ],
    /* 动量上扬 */
    momentumUp: [
      '势头起来了。近一周完成率{s}%，比之前明显上扬——这时候别减量，趁势再落一子。',
      '你在走上升段。连续的好状态很珍贵，趁现在把最硬的那件事推掉。',
      '节奏对了。完成率{s}% 且还在往上，按这个走法，这个月会有个像样的收尾。'
    ],
    /* 动量下滑 */
    momentumDown: [
      '近一周完成率{s}%，比之前掉了一截。不是你变懒了，是量该调了——我今天给你减一子。',
      '势头在往下走。这时候硬扛只会更快放弃，我先把清单压短，保住「每天都做」。',
      '完成率从高位掉到{s}%。别急着自责，先把量降到能稳住的程度，再谈回升。'
    ],
    /* 精力低 */
    energyLow: [
      '现在精力只有{s}%，还有{n}件没做。别啃硬的——先挑十分钟内的小任务，把动量捡回来。',
      '状态在往下走。硬骨头留到明天，今天先把轻松的清掉，能清几件是几件。',
      '低精力时段做高难度任务，只会做成「做了一半」。先做小的，把今天的完成感保住。'
    ],
    /* 精力高 */
    energyHigh: [
      '现在精力正旺（{s}%）。这种状态一天不多——把最硬的那件事拿出来，就现在。',
      '状态在线。别浪费在小事上，今天最难的一子，现在落。',
      '精力峰值来了。趁这时候啃硬骨头，等状态过去了，剩下的小事随手就能清。'
    ],
    /* 熬夜 */
    night: [
      '连着{n}天在深夜收尾了。深夜的完成感是假的——它花的是明天的力气。明天试着早上先完成最小一子。',
      '又到这个点了。你不是夜型人，你只是把白天的拖延挪到了晚上。明天我把最难的那件往前挪。',
      '深夜完成任务，短期看是补上了，长期看是在借高利贷。今晚到此为止，明天我重新排。'
    ],
    /* 完美主义 */
    perfection: [
      '你有{n}件一直挂着没动，但整体完成率不低。说明你在等「完美的时机」——可时机是做出来的，不是等来的。',
      '挂太久的事，多半不是难，是你在等一个完整的两小时。先给它十分钟，动起来再说。',
      '别等万事俱备。棋局里从来没有完美的一手，只有落下去的那一手。'
    ],
    /* 人情压力：ISFJ 不擅长拒绝 */
    social: [
      '你最近提到人情、帮忙、不好意思拒绝。你不必让所有人满意——先把自己的棋下完，才有余力帮别人。',
      '答应别人的事如果挤掉了你自己的计划，那不是善良，是在替别人的优先级买单。今天先保你自己的一子。',
      '你习惯把别人的事排在前面。但你的棋局没人替你下——今天把「我的事」放在第一位。'
    ],
    /* 连击里程碑 */
    streak: [
      '连续{d}天了。你不是在打卡，你是在变成那种「说了就做到」的人。',
      '{d}天连续落子。这个数字本身就是筹码——别在今天就把它断掉。',
      '第{d}天。回头看看第一天，你已经不是同一个人了。'
    ],
    /* 全清 */
    allClear: [
      '今天棋局全清。你压了自己一头——这就是「说到做到」的手感，记住它。',
      '满盘皆活。今天你没给自己留退路，也没给自己找借口。',
      '全部落子。别小看这一天：连续三十个这样的日子，就是另一个人。'
    ],
    /* 差一点（收官） */
    closing: [
      '还剩{n}件就全清了。收官阶段最容易松——撑住，今天就能画个完整的句号。',
      '差一口气。最后这几子通常最简单，也最容易被拖到明天。现在清掉。',
      '大局已定，剩个尾巴。今天收干净，明天开局会轻松很多。'
    ],
    /* 今天颗粒无收 */
    zeroProgress: [
      '今天还没落子，天已经不早了。别求全部——就做最小的一件，五分钟，保住今天。',
      '一天快过去了，棋盘还是空的。现在捡最短的那件做掉，别让今天挂零。',
      '零进度没关系，但别让零变成连续两天。现在落一子，什么都不算晚。'
    ],
    /* 目标停滞 */
    goalStall: [
      '「{t}」的进度停在{p}%，时间却过去了{w}%。再不动，它就从目标变成遗憾了。今天给它一子。',
      '「{t}」落后于时间进度了。别想着补回来，从今天开始按新的节奏走就行。',
      '「{t}」已经有点掉队。目标这东西，不怕慢，怕的是停。'
    ],
    /* 周初 / 周末 */
    weekOpen: [
      '新的一周。别一上来就排满——今天先把最重要的那一子定了，剩下的这周慢慢落。',
      '周一不适合冲刺，适合布局。今天定下这周的主线，后面四天照着走。'
    ],
    weekClose: [
      '今天是这周最后一子。收官收得漂亮，下周开局就顺。',
      '周末了。别把今天当成「补作业日」——挑一件最想做的，轻松落一子就好。'
    ],
    /* 独处充电 */
    solo: [
      '你已经连着{d}天在输出了。内向的人靠独处充电——今晚留一小时给自己，什么都不做也算数。',
      '连续作战第{d}天。今晚别安排任何事，让脑子空着。空着的时候，棋才看得清。'
    ],
    /* 微起步 */
    microStart: [
      '别想整件事。就做它的第一个动作——打开、摆好、写下第一行。剩下的交给惯性。',
      '你卡住的不是能力，是「开始」。把起点压到不可能失败：两分钟，就两分钟。'
    ],
    /* 小胜 */
    win: [
      '记一笔：你今天做到了。别急着往前赶，先认下这一分。',
      '这一子落得漂亮。小的胜利攒多了，人就会开始相信自己。'
    ],
    /* 大局观 */
    bigPicture: [
      '今天这一子，单看很轻。但同样的子落下三十次，就是另一个人。',
      '你不是在完成任务，你是在一点点把未来的自己兑换出来。',
      '大局不是某天突然漂亮起来的，是很多个「今天先落一子」叠出来的。'
    ],
    /* 温和兜底（任何时候都可能用，语气最软） */
    gentle: [
      '今天按这个顺序走就行，不用想太多。',
      '我替你排好了。你只管照着做，剩下的是我的事。',
      '不急。一子一子来，棋局还长。',
      '你已经比昨天多走了一步，这就够了。'
    ]
  };

  /* =========================================================
     5. 情境扫描 —— 「把所有可能的情况都算出来」
     每个探测器返回一条 { id, pri, key, text }，全部命中后按 pri 降序。
     新增处境：往 DETECTORS 里加一项即可，不用改别的地方。
     ========================================================= */
  const DETECTORS = [
    /* —— 第一梯队：身体与状态异常，必须优先 —— */
    { id:'burnout', pri:98,
      when:(c,m)=> m.burnout.level === 'high',
      text:(c,m)=> fill(pick(LINES.burnout, c.date+'bo'),
              { reasons: m.burnout.reasons.slice(0,2).join('、') || '连续高强度' }) },

    { id:'rest', pri:96,
      when:(c,m)=> m.recovery.level === 'high',
      text:(c,m)=> fill(pick(LINES.rest, c.date+'rest'), { d: m.streakDays }) },

    { id:'overcommit', pri:94,
      when:(c,m)=> m.commit.ratio > m.persona.overcommitLimit,
      text:(c,m)=> fill(pick(LINES.overcommit, c.date+'oc'), { n: m.commit.planned }) },

    { id:'decisionFatigue', pri:92,
      when:(c,m)=> m.decision.level === 'high',
      text:(c,m)=> fill(pick(LINES.decisionFatigue, c.date+'df'), { n: m.decision.inbox + m.decision.noTime }) },

    /* —— 第二梯队：方向与均衡 —— */
    { id:'imbalance', pri:86,
      when:(c,m)=> m.persona.needsBalance && m.balance.level === 'low' && m.balance.top,
      text:(c,m)=> fill(pick(LINES.imbalance, c.date+'imb'), { t: m.balance.top }) },

    { id:'plateau', pri:84,
      when:(c,m)=> m.plateau.has && m.plateau.worst,
      text:(c,m)=> fill(pick(LINES.plateau, c.date+'pl'+m.plateau.worst.title),
              { t: m.plateau.worst.title, d: m.plateau.worst.idleDays || '十来' }) },

    { id:'goalStall', pri:80,
      when:(c,m)=> c.behindGoals && c.behindGoals.length > 0,
      text:(c,m)=>{ const g = c.behindGoals[0];
        return fill(pick(LINES.goalStall, c.date+'gs'+g.goal.id),
          { t:g.goal.title, p:Math.round(g.progRatio*100), w:Math.round(g.timeRatio*100) }); } },

    /* —— 第三梯队：节奏 —— */
    { id:'momentumDown', pri:74,
      when:(c,m)=> m.momentum.trend === 'down' && m.momentum.score != null,
      text:(c,m)=> fill(pick(LINES.momentumDown, c.date+'md'),
              { s: pct(m.momentum.score*100, 100) }) },

    { id:'momentumUp', pri:72,
      when:(c,m)=> m.momentum.trend === 'up' && m.momentum.score != null,
      text:(c,m)=> fill(pick(LINES.momentumUp, c.date+'mu'),
              { s: pct(m.momentum.score*100, 100) }) },

    { id:'energyLow', pri:70,
      when:(c,m)=> m.energy < 0.38 && c.tasksTotal > 0 && c.tasksDone < c.tasksTotal,
      text:(c,m)=> fill(pick(LINES.energyLow, c.date+'el'),
              { s: Math.round(m.energy*100), n: c.tasksTotal - c.tasksDone }) },

    { id:'energyHigh', pri:68,
      when:(c,m)=> m.energy > 0.78 && c.tasksTotal > 0 && c.tasksDone < c.tasksTotal,
      text:(c,m)=> fill(pick(LINES.energyHigh, c.date+'eh'), { s: Math.round(m.energy*100) }) },

    { id:'night', pri:66,
      when:(c,m)=> c.nightStreak >= 2 || c.nightRatio >= 0.45,
      text:(c,m)=> fill(pick(LINES.night, c.date+'nt'), { n: Math.max(c.nightStreak, 2) }) },

    { id:'perfection', pri:64,
      when:(c,m)=> c.pc && c.pc.pendingPast >= 3 && c.s7 && c.s7.rate >= 0.5,
      text:(c,m)=> fill(pick(LINES.perfection, c.date+'pf'), { n: c.pc.pendingPast }) },

    /* —— 第四梯队：当天进度 —— */
    { id:'allClear', pri:60,
      when:(c,m)=> c.tasksTotal > 0 && c.tasksDone === c.tasksTotal,
      text:(c,m)=> pick(LINES.allClear, c.date+'ac') },

    { id:'closing', pri:58,
      when:(c,m)=> c.tasksTotal > 0 && c.tasksDone >= 1 && c.tasksDone < c.tasksTotal
                   && (c.tasksDone / c.tasksTotal) >= 0.7,
      text:(c,m)=> fill(pick(LINES.closing, c.date+'cl'), { n: c.tasksTotal - c.tasksDone }) },

    { id:'firstTask', pri:56,
      when:(c,m)=> c.tasksTotal > 0 && c.tasksDone === 0 && c.hour >= 9,
      text:(c,m)=> pick(LINES.firstTask, c.date+'ft') },

    { id:'zeroProgress', pri:54,
      when:(c,m)=> c.tasksTotal > 0 && c.tasksDone === 0 && c.hour >= 18,
      text:(c,m)=> pick(LINES.zeroProgress, c.date+'zp') },

    /* —— 第五梯队：情绪、关系、周期 —— */
    { id:'selfBlame', pri:50,
      when:(c,m)=> m.persona.selfBlameProne && c.todayRate === 0
                   && c.emo && c.emo.level === 'alert',
      text:(c,m)=> pick(LINES.selfBlame, c.date+'sb') },

    { id:'comeback', pri:48,
      when:(c,m)=> c.lostDays >= 1 && c.lostDays <= 5 && c.tasksDone > 0,
      text:(c,m)=> fill(pick(LINES.comeback, c.date+'cb'), { d: c.lostDays }) },

    { id:'solo', pri:46,
      when:(c,m)=> m.persona.needsSoloTime && m.streakDays >= m.persona.restAfterDays,
      text:(c,m)=> fill(pick(LINES.solo, c.date+'so'), { d: m.streakDays }) },

    { id:'social', pri:44,
      when:(c,m)=> m.socialPressure,
      text:(c,m)=> pick(LINES.social, c.date+'sc') },

    { id:'streak', pri:42,
      when:(c,m)=> [3,7,14,21,30,50,100].indexOf(c.streak) >= 0,
      text:(c,m)=> fill(pick(LINES.streak, c.date+'st'), { d: c.streak }) },

    { id:'weekOpen', pri:30,
      when:(c,m)=> c.weekday === 1,
      text:(c,m)=> pick(LINES.weekOpen, c.date+'wo') },

    { id:'weekClose', pri:28,
      when:(c,m)=> c.weekday === 0,
      text:(c,m)=> pick(LINES.weekClose, c.date+'wc') },

    { id:'microStart', pri:26,
      when:(c,m)=> m.hardest && c.tasksDone === 0,
      text:(c,m)=> pick(LINES.microStart, c.date+'ms') },

    { id:'bigPicture', pri:20,
      when:(c,m)=> true,     // 永远命中，作为「大局观」的日常一剂
      text:(c,m)=> m.bigPicture.text }
  ];

  /* 5.1 度量汇总：一次算齐全套指标，供扫描器与简报复用（避免各自重复扫描） */
  function metrics(dateStr){
    const ds = dateStr || todayStr();
    const pf = persona();
    const c  = safe(function(){ return B ? B.context(ds) : null; }, null) || {};
    const st = safe(function(){ return S.load(); }, {}) || {};
    const u  = st.undercover || {};

    // 社交 / 人情压力：从近 7 天随记里找关键词（ISFJ 不擅拒绝的信号）
    const socialPressure = safe(function(){
      const kw = /人情|帮忙|不好意思拒绝|不好拒绝|答应了|抹不开|怕他|怕她|怕他们失望|拒绝不了|碍于情面/;
      for(let i=0;i<7;i++){
        const dsx = dayStr(-i);
        const ns = (st.notes||[]).filter(n=>n.date===dsx);
        for(const n of ns){ if(kw.test(String(n.text||''))) return true; }
      }
      return false;
    }, false);

    const pending = (c.tasksTotal != null) ? (c.tasksTotal - (c.tasksDone||0)) : 0;
    const hardest = safe(function(){
      const arr = (S.tasksOf(ds)||[]).filter(t=>!t.done);
      if(!arr.length) return null;
      return arr.slice().sort((a,b)=> num(b.duration,15) - num(a.duration,15))[0];
    }, null);

    return {
      persona: pf,
      energy: energyNow(ds),
      momentum: momentum(7),
      commit: commitment(ds),
      burnout: burnoutRisk(ds),
      decision: decisionLoad(ds),
      balance: weekBalance(),
      plateau: plateau(10),
      recovery: recoveryNeed(ds),
      bigPicture: bigPicture(ds),
      socialPressure, hardest, pending,
      streakDays: num(u.streak, 0)
    };
  }

  /* 5.2 扫描：跑一遍所有探测器，返回命中的处境（已按优先级降序） */
  function scan(dateStr, limit){
    return safe(function(){
      const ds = dateStr || todayStr();
      const c = safe(function(){ return B ? B.context(ds) : {}; }, {});
      const m = metrics(ds);
      const hits = [];
      DETECTORS.forEach(d=>{
        let on = false;
        try{ on = !!d.when(c, m); }catch(e){ on = false; }
        if(!on) return;
        let text = '';
        try{ text = d.text(c, m); }catch(e){ text = ''; }
        if(!text) return;
        hits.push({ id:d.id, pri:d.pri, text });
      });
      hits.sort((a,b)=> b.pri - a.pri);
      return (limit && limit > 0) ? hits.slice(0, limit) : hits;
    }, []);
  }

  /* =========================================================
     6. 综合简报 —— 给 engine 的一句话入口
     ========================================================= */
  function brief(dateStr){
    return safe(function(){
      const ds = dateStr || todayStr();
      const m  = metrics(ds);
      const hits = scan(ds, 1);
      const plan = movePlan(ds);
      return {
        date: ds,
        line: hits.length ? hits[0].text : pick(LINES.gentle, ds+'g'),
        topId: hits.length ? hits[0].id : 'gentle',
        plan, metrics:m,
        all: scan(ds, 5)
      };
    }, { date:dateStr||'', line:'', topId:'gentle', plan:{opening:[],middlegame:[],endgame:[],empty:true},
         metrics:null, all:[] });
  }

  /* 6.1 落子建议文案：把三段棋翻译成一段人话（供「今日指令」追加） */
  function moveLine(dateStr){
    return safe(function(){
      const plan = movePlan(dateStr);
      if(plan.empty) return '';
      const first = plan.opening[0];
      if(!first) return '';
      return '开局先落「' + first.title + '」（约' + num(first.duration,15) + '分钟）。'
           + (plan.middlegame[0] ? '状态上来后，主攻「' + plan.middlegame[0].title + '」。' : '');
    }, '');
  }

  /* =========================================================
     7. 导出
     ========================================================= */
  window.ZQ = window.ZQ || {};
  window.ZQ.mind = {
    persona, energyNow, momentum, commitment, burnoutRisk,
    decisionLoad, weekBalance, plateau, recoveryNeed,
    movePlan, microStart, bigPicture,
    scan, brief, moveLine, metrics,
    LINES, DETECTORS,
    pick, fill
  };
})();
