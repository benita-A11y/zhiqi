/* =========================================================
   执棋 · 卧底系统 (undercover.js)
   游戏化 + 推进感。所有状态落在 store，离线可用。
   ========================================================= */
(function(){
  const S = window.ZQ.store;

  const CODE_NAMES = ['执棋者·新兵','执棋者·渗透','执棋者·暗行','执棋者·无影','执棋者·觉醒','执棋者·入局'];

  const TITLES = {
    opener:'开局者',      // 首次完成任务
    keeper:'不辍者',      // 连续7天
    breaker:'破局者',     // 完成第一个目标
    tristar:'三连星',     // 完成三个目标
    nightowl:'夜行者',    // 夜间复盘≥3次
    collector:'情报官',   // 集齐12情报
    listener:'听令者'     // 连续完成全部任务3次
  };

  function daysBetween(a,b){
    const da=new Date(a+'T00:00:00'), db=new Date(b+'T00:00:00');
    return Math.floor((db-da)/86400000);
  }

  function getLevelInfo(){
    const st=S.load(); const u=st.undercover;
    const goalsDone = st.goals.filter(g=>g.status==='done').length;
    const goalLevel = goalsDone>=3?5 : goalsDone>=1?4 : 0;
    const streakLevel = u.streak>=30?3 : u.streak>=7?2 : u.streak>=3?1 : 0;
    const level = Math.max(goalLevel, streakLevel);
    return { level, name:CODE_NAMES[level], goalsDone };
  }

  function progressToNext(){
    const st=S.load(); const u=st.undercover;
    // 计算升级所需（取 streak 与 目标 两条线中较近的一条）
    const goalsDone = st.goals.filter(g=>g.status==='done').length;
    let need, cur, label;
    if(goalsDone<1){ need=3; cur=u.streak; label='连续3天落子 → 执棋者·渗透'; }
    else if(goalsDone<3){ need=7; cur=u.streak; label='连续7天落子 → 执棋者·暗行'; }
    else { need=30; cur=u.streak; label='连续30天 → 执棋者·无影'; }
    return { cur, need, label, pct:Math.min(100,Math.round(cur/need*100)) };
  }

  function awardTitle(key){
    const st=S.load(); const u=st.undercover;
    if(!u.titles.includes(TITLES[key])){
      u.titles.push(TITLES[key]);
      S.pushLog('军师',`🏅 解锁称号「${TITLES[key]}」。你在棋局里，已不只是新手。`,'secret');
      return TITLES[key];
    }
    return null;
  }

  function pushSecret(text){
    const st=S.load();
    st.undercover.secrets.unshift({ date:S.fmtDate(S.today()), text });
    if(st.undercover.secrets.length>40) st.undercover.secrets.length=40;
  }

  /* 任务勾选后的联动 */
  function onToggle(task, done){
    if(!done) return; // 只处理"完成"动作
    const st=S.load(); const u=st.undercover;
    const dateStr = task.date;
    const todays = S.tasksOf(dateStr);
    if(todays.length===0) return;
    const allDone = todays.every(t=>t.done);
    const todayStr = S.fmtDate(S.today());
    const yest = S.fmtDate(S.shiftDay(S.today(),-1));

    // 目标计数 + 自动推进阶段
    if(task.goalId){
      const g=S.getGoal(task.goalId);
      if(g){ g.totalTasksDone=(g.totalTasksDone||0)+1;
        if(g.totalTasksDone >= (g.stageIndex+1)*14 && g.stageIndex < g.stages.length-1){
          S.advanceStage(g.id);
          pushSecret(`🔓 阶段推进：${g.title} 进入「${g.stages[g.stageIndex].name}」。新指令已就位。`);
          S.pushLog('军师',`基础已牢。${g.title}解锁新阶段「${g.stages[g.stageIndex].name}」，任务我已替你换上。`,'secret');
        }
      }
    }

    if(dateStr===todayStr && allDone && u.lastCompletedDate!==todayStr){
      if(u.lastCompletedDate===yest || u.lastCompletedDate===null) u.streak = (u.lastCompletedDate===yest)? u.streak+1 : 1;
      else u.streak = 1; // 断过，但今天收尾，重新计
      u.lastCompletedDate = todayStr;
      u.intelFragments = Math.min(u.intelMax, u.intelFragments+1);
      u.lostDays = 0;

      // 称号
      if(!st.undercover.titles.includes(TITLES.opener)) awardTitle('opener');
      if(u.streak>=7) awardTitle('keeper');
      if(u.intelFragments>=12) awardTitle('collector');
      u._allDoneCount=(u._allDoneCount||0)+1;
      if(u._allDoneCount>=3) awardTitle('listener');

      // 升级提醒
      const before = getLevelInfo().level;
      // (level 由 streak/goals 推导，无需显存)
      if(u.streak===3) S.pushLog('军师','📨 连续3天完成。你已解锁下一阶段任务的底气，新指令已推送。','secret');
      if(u.streak===7) S.pushLog('军师','📨 连续7天，暗行无阻。这股劲，十年后回头看就是分水岭。','secret');
      if(u.streak===30) S.pushLog('军师','📨 三十天如一日。你已不是"在打卡的人"，是"在下棋的人"。','secret');

      pushSecret(`🕵️ 情报碎片 +1（共${u.intelFragments}）。今日棋局已清空，明日先手由我安排。`);
      S.save();
    }
  }

  /* 跨天失联检测（应用启动时调用） */
  function checkDateTransition(){
    const st=S.load(); const u=st.undercover;
    const todayStr=S.fmtDate(S.today());
    if(u.lastCompletedDate && u.lastCompletedDate!==todayStr){
      const gap = daysBetween(u.lastCompletedDate, todayStr);
      if(gap>=2 && u.streak>0){
        u.streak=0; u.lostDays=(u.lostDays||0)+1;
        S.pushLog('军师','⚠️ 你失联了。今天只做最小一子，哪怕5分钟，先回到局里。','warn');
        pushSecret('⚠️ 断线一次。别让一次松懈变成习惯——今天先落一子。');
        S.save();
      }
    }
  }

  /* 记录夜间复盘（用于夜行者称号） */
  function recordReview(){
    const h=new Date().getHours();
    if(h>=21 || h<5){
      const st=S.load(); const u=st.undercover;
      u._nightReviews=(u._nightReviews||0)+1;
      if(u._nightReviews>=3) awardTitle('nightowl');
      S.save();
    }
  }

  /* 完成目标（由棋谱"完成目标"触发） */
  function completeGoal(goalId){
    const g=S.getGoal(goalId); if(!g) return;
    S.updateGoal(goalId,{status:'done', progress:100});
    const st=S.load();
    const goalsDone=st.goals.filter(x=>x.status==='done').length;
    if(goalsDone>=1) awardTitle('breaker');
    if(goalsDone>=3) awardTitle('tristar');
    pushSecret(`🏆 目标「${g.title}」达成。代号升级为「${getLevelInfo().name}」。下一颗棋，我替你想好了。`);
    S.pushLog('军师',`你做到了。代号升级为「${getLevelInfo().name}」。下一个棋局我等你。`,'secret');
    S.save();
  }

  function init(){
    S.onTaskToggled(onToggle);
  }

  window.ZQ.undercover = {
    init, checkDateTransition, recordReview, completeGoal,
    getLevelInfo, progressToNext, awardTitle, CODE_NAMES, TITLES
  };
})();
