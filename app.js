const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const SUPABASE_URL='https://wcnmufiabeftlsregamh.supabase.co',SUPABASE_KEY='sb_publishable_FHlEZrROrCVM1WLdoij5Cw_7Ue64M1X';
const db=window.supabase?.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'shiguang-quiz-auth'}});
let user=null,questions=[],practiceQuestions=[],activeBank='中华文化题库',answered=false,currentQ=null,sessionRecent=[],session=null,practiceMode='free',taskIds=[],taskTotal=0,practiceKind='choice',practiceArmed=false;
const titles={home:'主页',history:'历史刷题',bank:'我的题库',detail:'题库详情',settings:'账号与设置',practice:'开始刷题'};
// ---------- per-user namespaced local storage ----------
const NS=()=>user?.id||'anon';
// ---------- practice session (enter -> exit = one record) ----------
function dayKey(ts){const d=new Date(ts||Date.now());return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function fmtMin(sec){sec=Math.max(0,Math.round(sec||0));return sec>=60?`${Math.floor(sec/60)}分${sec%60}秒`:`${sec}秒`}
function ensureSession(){if(!session||session.bank!==activeBank){session={id:'s'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),bank:activeBank,start:Date.now(),qCount:0,correct:0}}}
function bumpSession(ok){ensureSession();session.qCount++;if(ok)session.correct++}
function closeSession(){
  if(!session)return;
  if(session.qCount===0){session=null;return}
  const rec={bank:session.bank,start:session.start,sec:Math.max(1,Math.round((Date.now()-session.start)/1000)),qCount:session.qCount,correct:session.correct};
  session=null;
  const list=read('sessions');list.push(rec);write('sessions',list);
  if(user&&db)db.from('practice_sessions').insert({user_id:user.id,bank:rec.bank,started_at:new Date(rec.start).toISOString(),ended_at:new Date().toISOString(),duration_sec:rec.sec,q_count:rec.qCount,correct:rec.correct}).then(()=>{}).catch(()=>{});
  updateStats();
}
function migrateLegacy(){
  for(const oldKey of ['practice-history','wrong-questions','uploaded-questions']){
    const raw=localStorage.getItem(oldKey);
    if(raw){localStorage.setItem(`sg:anon:${oldKey}`,raw);localStorage.removeItem(oldKey)}
  }
}
const read=(k,d=[])=>{try{return JSON.parse(localStorage.getItem(`sg:${NS()}:${k}`)||JSON.stringify(d))}catch{return d}};
const write=(k,v)=>localStorage.setItem(`sg:${NS()}:${k}`,JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function normalize(q,i){const legacy=q.options?.length===3&&q.options[0]&&q.options[1]&&q.options[2]&&(!q.answer||q.answer==='');return legacy?{...q,id:`${q.source}-${i}`,question:q.options[0],answer:'A',answerText:q.options[1],options:[],explanation:q.options[2],type:'single'}:{...q,id:`${q.source}-${i}`,question:q.question||'未命名题目',options:q.options?.length?q.options:['正确','错误'],answer:q.answer||'A',explanation:q.explanation||''}}
function enrichQuestions(list){const pool=list.map(q=>q.answerText||'').filter(Boolean);return list.map((q,i)=>{if(!q.answerText||q.type==='fill'||(q.type==='judge'&&/^[AB]$/i.test(q.answer||'')))return q;const wrong=[];for(let n=1;n<pool.length&&wrong.length<3;n++){const v=pool[(i+n*17)%pool.length];if(v!==q.answerText&&!wrong.includes(v))wrong.push(v)}const opts=[q.answerText,...wrong],shift=i%4,rot=opts.slice(shift).concat(opts.slice(0,shift));return {...q,options:rot,answer:String.fromCharCode(65+rot.indexOf(q.answerText))}})}
// ---------- spaced-repetition (Leitner) state ----------
const BOX_DAY=[1,3,7,15,30,60,120,240]; // box 1..8 = days until next review after consecutive corrects
const MAX_BOX=BOX_DAY.length;
function srsStore(){return read('srs',{qs:{}})}
function srsSave(s){write('srs',s)}
function srsCard(s,qid){return s.qs[qid]||{box:0,last:0,due:0,wrong:0,ok:0,wrongStreak:0}}
function applyResult(qid,ok){
  const s=srsStore(),c=srsCard(s,qid),now=Date.now();
  if(ok){
    c.ok++;
    c.wrongStreak=0;
    c.box=Math.min(c.box+1,MAX_BOX);
    c.last=now;
    c.due=now+BOX_DAY[Math.max(0,c.box-1)]*86400000; // box1 -> 1 day, box2 -> 3 days, ...
  }else{
    c.wrong=(c.wrong||0)+1;
    c.wrongStreak=(c.wrongStreak||0)+1;
    c.box=0;
    c.last=now;
    const gapMin=Math.min(60,Math.max(5,5*c.wrongStreak)); // re-appears for review after 5..60 min
    c.due=now+gapMin*60000;
  }
  s.qs[qid]=c;srsSave(s);
}
function pickQuestion(){
  const all=practiceQuestions.filter(q=>!q.needsReview);
  if(!all.length)return null;
  if(practiceMode==='review'){
    const cand=all.filter(q=>taskIds.includes(q.id));
    if(!cand.length)return null;
    const avoid=new Set(sessionRecent.slice(-10));
    let c2=cand.filter(q=>!avoid.has(q.id));
    if(!c2.length)c2=cand;
    return c2[Math.floor(Math.random()*c2.length)];
  }
  const st=srsStore().qs,now=Date.now();
  const card=(qid)=>st[qid];
  const dueGood=all.filter(q=>{const c=card(q.id);return c&&c.due&&c.due<=now&&!c.wrongStreak});
  const dueBad=all.filter(q=>{const c=card(q.id);return c&&c.due&&c.due<=now&&c.wrongStreak});
  const fresh=all.filter(q=>!card(q.id));
  let pool;
  if(dueGood.length)pool=dueGood;
  else if(dueBad.length)pool=dueBad;
  else if(fresh.length){
    const coreFresh=fresh.filter(q=>q.priority===1);
    pool=coreFresh.length?coreFresh:fresh; // 冲刺重点(priority=1)新题优先
  }
  else{
    const weak=all.filter(q=>{const c=card(q.id);return c&&c.wrongStreak}).sort((a,b)=>(card(a.id).due||0)-(card(b.id).due||0));
    if(weak.length)pool=weak.slice(0,40);
    else pool=all;
  }
  const avoid=new Set(sessionRecent.slice(-12));
  let cand=pool.filter(q=>!avoid.has(q.id));
  if(!cand.length)cand=pool;
  return cand[Math.floor(Math.random()*cand.length)];
}
function showView(v){
  const fromPractice=($$('.view.active-view')[0]?.id)==='practice-view';
  $$('.view').forEach(x=>x.classList.remove('active-view'));const target=$(`#${v}-view`);if(target)target.classList.add('active-view');
  $$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));
  $('#page-title').textContent=titles[v]||titles.home;
  if(fromPractice&&v!=='practice'){closeSession();practiceMode='free';taskIds=[];practiceArmed=false}
  if(v==='history')renderReview();
  if(v==='settings'){renderAccountPanel();syncAuthButtons()}
  if(v==='home')renderCalendar();
  if(v==='practice'){if(practiceMode==='reviewDone')practiceMode='free';if(practiceArmed)renderQuestion();else renderSetup()}
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)showView(b.dataset.view);const bank=e.target.closest('[data-bank]');if(bank){activeBank=bank.dataset.bank;showBankDetail(activeBank)}});
function bankName(q){return q.source&&(/港澳台|文化史|古代文化|pdf|阅读/i.test(q.source))?'中华文化题库':q.source||'未命名题库'}
function bankGroups(){const m={};questions.forEach(q=>{const n=bankName(q);(m[n]??=[]).push(q)});return m}
function card(name,qs){const isCulture=name==='中华文化题库';return `<article class="bank-card" data-bank="${esc(name)}"><div class="bank-top"><span class="book-icon blue">${isCulture?'文':'✦'}</span><span class="card-arrow">↗</span></div><h4>${esc(name)}</h4><small>${qs.length} 道题 · ${isCulture?'港澳台考研中华文化':'用户上传题库'}</small></article>`}
function renderBanks(){
  const groups=bankGroups(),names=Object.keys(groups);
  const h=names.length?names.map(n=>card(n,groups[n])).join(''):'<div class="empty-state">暂无题库，可上传资料创建。</div>';
  for(const id of ['home-banks','all-banks']){const el=$('#'+id);if(el)el.innerHTML=h}
  for(const id of ['bank-count','bank-count-all']){const el=$('#'+id);if(el)el.textContent=names.length}
  if($('#bank-total'))$('#bank-total').textContent=questions.length;
  $('#detail-back')&&($('#detail-back').onclick=()=>showView('bank'));
}
const kindOf=(q)=>{
  if(q.rType==='classical')return 'classical';
  if(q.rType==='modern')return 'modern';
  if(q.source&&q.source.includes('阅读题'))return 'reading';
  return 'choice';
};
const KIND_LABEL={all:'全部混合',choice:'选择·填空',reading:'阅读·全部',classical:'阅读·文言文',modern:'阅读·白话文'};
function qLimit(q){
  if(q.rType==='modern')return 150;
  if(q.rType==='classical')return 120;
  if(q.source&&q.source.includes('阅读题'))return 120;
  return ({single:30,multiple:45,judge:25,fill:40}[q.type]||40);
}
function badgeFor(q){
  if(q.rType==='classical')return ['文言阅读','b-classical'];
  if(q.rType==='modern')return ['白话阅读','b-modern'];
  if(q.source&&q.source.includes('阅读题'))return ['阅读理解','b-reading'];
  return ({single:['单选题','b-single'],multiple:['多选题','b-multi'],judge:['判断题','b-judge'],fill:['填空题','b-fill']}[q.type]||['题目','b-single']);
}
function paintTimeOver(){
  const el=$('#time-q');if(!el)return;
  const over=session&&qStart&&currentQ?(Date.now()-qStart)/1000>qLimit(currentQ):false;
  el.classList.toggle('over',over);
}
function renderSetup(msg){
  practiceMode='free';taskIds=[];sessionRecent=[];currentQ=null;practiceArmed=false;
  const groups=bankGroups();
  const banks=Object.keys(groups);
  const btns=banks.map(n=>`<button class="setup-bank ${n===activeBank?'sel':''}" data-bank2="${esc(n)}"><b>${esc(n)}</b><small>${groups[n].filter(q=>!q.needsReview).length} 题</small></button>`).join('');
  const kinds=[
    ['choice','选择·填空','单选/多选/判断/填空'],
    ['classical','阅读 · 文言文','《劝学》《论语》等文言理解'],
    ['modern','阅读 · 白话文','现当代文化散文理解'],
    ['reading','阅读 · 全部','文言文 + 白话文'],
    ['all','全部混合','所有题目随机'],
  ].map(([k,lab,desc])=>`<button class="setup-kind ${practiceKind===k?'sel':''}" data-kind="${k}"><b>${lab}</b><small>${desc}</small></button>`).join('');
  $('#practice-card').innerHTML=`<div class="setup-wrap">
    <div class="setup-title">开始刷题</div>
    <div class="setup-step"><div class="ss-name">1 · 选择题库</div><div class="setup-banks">${btns||'<div class="empty-state">暂无题库</div>'}</div></div>
    <div class="setup-step"><div class="ss-name">2 · 选择题型</div><div class="setup-kinds">${kinds}</div></div>
    <button class="primary" id="setup-go">开始刷题 →</button>
    ${msg?`<div class="setup-msg">${esc(msg)}</div>`:''}
  </div>`;
  $$('#practice-card .setup-bank').forEach(b=>b.onclick=()=>{activeBank=b.dataset.bank2;$$('#practice-card .setup-bank').forEach(x=>x.classList.toggle('sel',x===b));renderBanks();});
  $$('#practice-card .setup-kind').forEach(b=>b.onclick=()=>{practiceKind=b.dataset.kind;$$('#practice-card .setup-kind').forEach(x=>x.classList.toggle('sel',x===b));});
  $('#setup-go').onclick=()=>startPractice();
  if($('#practice-index'))$('#practice-index').textContent='准备开始';
  if($('#aside-progress'))$('#aside-progress').textContent='选择题库与题型后开始';
}
function startPractice(){
  closeSession();practiceArmed=true;sessionRecent=[];currentQ=null;practiceMode='free';taskIds=[];
  practiceQuestions=bankQuestions(activeBank);
  if(!practiceQuestions.length){practiceArmed=false;renderSetup(`“${activeBank}”中没有“${KIND_LABEL[practiceKind]}”类题目，请调整选择`);return}
  ensureSession();updateStats();
  if(isReadingKind(practiceKind))renderReadingPass();
  else renderQuestion();
  toast(`开始：${activeBank} · ${KIND_LABEL[practiceKind]}`);
}
function questionHtml(q){
  const t=q.question||'';
  const i=t.indexOf('【阅读材料】'),j=t.indexOf('【小题】');
  if(i>=0&&j>i){
    const mat=t.slice(i+6,j).trim();
    const sub=t.slice(j).replace(/^【小题】/,'').trim();
    return `<div class="reading-mat">${esc(mat)}</div><h3 style="margin-top:14px">${esc(sub)}</h3>`;
  }
  return `<h3>${esc(t)}</h3>`;
}
const shortQ=(t)=>{const s=String(t||'');const j=s.indexOf('【小题】');const x=j>=0?s.slice(j+4):s;return x.length>86?x.slice(0,86)+'…':x};
function explainHtml(q){
  const parts=[];
  if(q.translation&&q.translation.trim())parts.push(`<b>参考译文</b> ${esc(q.translation)}`);
  parts.push(`<b>解析</b> ${esc(q.explanation||'本题解析见来源资料。')}`);
  const cult=(q.culture&&q.culture.trim())
    ?q.culture
    :(q.type==='judge'?'判断题重在辨析题干中人物、朝代、作品归属是否错位，可对照同主题单选巩固。'
      :q.type==='fill'?'填空题以识记专名为主（人名/篇名/朝代/地点），注意用字规范。'
      :q.type==='multiple'?'多选题需逐项判定正误：选项常含“年代错位、归属错位、概念偷换”三类陷阱。'
      :'复习建议：围绕本题涉及的人物、时代、作品与制度做纵向关联记忆，可在冲刺重点中巩固同类题。');
  parts.push(`<b>文化知识补充</b> ${esc(cult)}`);
  return parts.join('<br>');
}
function kindMatch(q){
  const k=kindOf(q);
  if(practiceKind==='all')return true;
  if(practiceKind==='choice')return k==='choice';
  if(practiceKind==='reading')return k==='reading'||k==='classical'||k==='modern';
  return k===practiceKind;
}
function bankQuestions(name){const groups=bankGroups();return (groups[name]||[]).filter(q=>!q.needsReview&&kindMatch(q))}
function selectBank(name){activeBank=name;practiceArmed=false;practiceQuestions=bankQuestions(name);closeSession();renderBanks();showView('practice')}
function updateStats(){
  const ses=read('sessions'),todayK=dayKey();
  const total=ses.reduce((n,x)=>n+(x.qCount||0),0),right=ses.reduce((n,x)=>n+(x.correct||0),0);
  $('#total-answered').textContent=total;$('#accuracy').textContent=total?`${Math.round(right/total*100)}%`:'暂无';
  const s=srsStore().qs;let due=0,weak=0;for(const id in s){const c=s[id];if(!c.due)continue;if(c.due<=Date.now())due++;if(c.wrongStreak>0)weak++;}
  const today=ses.filter(x=>dayKey(x.start)===todayK).reduce((n,x)=>n+(x.qCount||0),0);
  const label=user?`${user.user_metadata?.username||user.email||''} 的专属数据`:'（未登录，数据仅存本浏览器）';
  $('#user-data-label')&&($('#user-data-label').textContent=label);
  $('#due-count')&&($('#due-count').textContent=due);$('#weak-count')&&($('#weak-count').textContent=weak);$('#today-count')&&($('#today-count').textContent=today);
  $('#review-due')&&($('#review-due').textContent=due);$('#review-weak')&&($('#review-weak').textContent=weak);
  const rdh=$('#review-done-hint');if(rdh)rdh.hidden=true;
  const coreTotal=practiceQuestions.filter(q=>q.priority===1).length;
  $('#core-count')&&($('#core-count').textContent=coreTotal);
  const days=[...new Set(ses.map(x=>dayKey(x.start)))];
  let streak=0;const cur=new Date();if(!days.includes(dayKey(cur.getTime())))cur.setDate(cur.getDate()-1);
  while(days.includes(dayKey(cur.getTime()))){streak++;cur.setDate(cur.getDate()-1)}
  $('#streak-count')&&($('#streak-count').textContent=streak);$('#checkin-count')&&($('#checkin-count').textContent=days.length);
  const fmt=(x)=>`<div class="recent-row clickable" data-nav-start="${x.start}"><span class="mini-icon blue">◷</span><div><b>${esc(x.bank||'中华文化知识库')}</b><small>${new Date(x.start).toLocaleString('zh-CN')} · ${x.qCount} 题 · 用时 ${fmtMin(x.sec)}</small></div><span class="score">${x.qCount?Math.round((x.correct||0)/x.qCount*100):0}<span>%</span></span></div>`;
  $('#recent-list').innerHTML=ses.length?ses.slice(-5).reverse().map(fmt).join(''):'<div class="empty-state">还没有练习记录，开始第一题吧。</div>';
  $$('#recent-list [data-nav-start]').forEach(el=>el.onclick=()=>openHistoryDetail(el.dataset.navStart));
  renderCalendar();renderAnalysis();
}
function renderAnalysis(){
  const area=$('#analysis-area');if(!area)return;
  const d=read('details');
  if(!d.length){area.innerHTML='<div class="empty-state">完成几次练习后，这里会实时显示你的学习程度与薄弱点。</div>';return}
  const dayBars=[];let max=0;
  for(let i=6;i>=0;i--){
    const dt=new Date();dt.setDate(dt.getDate()-i);
    const k=dayKey(dt.getTime()),items=d.filter(x=>dayKey(x.ts)===k);
    max=Math.max(max,items.length);
    dayBars.push({k,items});
  }
  const trend=dayBars.map(x=>{
    const tot=x.items.length,ok=x.items.filter(y=>y.ok).length;
    const hp=Math.max(0,Math.round(ok/tot*100));
    const tp=Math.max(4,Math.round(tot/max*100));
    return `<div class="tcol" title="${x.k}：${ok}/${tot} 对"><div class="tbar" style="height:${tp}%"><i class="ok" style="height:${hp}%"></i></div><span class="d">${x.k.slice(5)}</span><span class="n">${tot}</span></div>`;
  }).join('');
  const map={single:'单选',multiple:'多选',judge:'判断',fill:'填空'};
  const by={};
  d.forEach(x=>{
    const key=x.kind==='classical'?'阅读·文言':x.kind==='modern'?'阅读·白话':x.kind==='reading'?'阅读':(map[x.type]||'其他');
    by[key]=by[key]||{ok:0,total:0};by[key].total++;if(x.ok)by[key].ok++;
  });
  const typeRows=Object.entries(by).map(([k,v])=>{const p=Math.round(v.ok/v.total*100);return `<div class="acc-row"><span>${k}</span><div class="acc-bar"><i style="width:${p}%"></i></div><b>${p}%</b><em>${v.ok}/${v.total}</em></div>`}).join('');
  const weak=Object.entries(by).filter(([,v])=>v.total>=3).sort((a,b)=>(a[1].ok/a[1].total)-(b[1].ok/b[1].total)).slice(0,3);
  const weakBlocks=weak.map(([k,v])=>{const p=Math.round(v.ok/v.total*100);return `<div class="weak">${k}：正确率 ${p}%（${v.ok}/${v.total}）${p<=75?'⚠ 建议优先复习':''}</div>`}).join('')||'<div class="weak good">暂无明显薄弱题型</div>';
  const cnt={};d.forEach(x=>{if(!x.ok)cnt[x.qid]=(cnt[x.qid]||0)+1});
  const repeat=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,2);
  const repeatBlocks=repeat.map(([id,n])=>{const q=questions.find(qq=>qq.id===id);return `<div class="weak">反复答错 · ${esc(shortQ(q?q.question:id))}（${n} 次）</div>`}).join('');
  area.innerHTML=`<div class="ana-grid">
    <div class="ana-card"><div class="ana-title">近 7 日练习趋势（绿=答对占比）</div><div class="trend-bars">${trend}</div></div>
    <div class="ana-card"><div class="ana-title">分题型正确率</div>${typeRows||'<div class="weak">暂无数据</div>'}</div>
    <div class="ana-card"><div class="ana-title">薄弱点提醒</div>${weakBlocks}${repeatBlocks}</div>
  </div>`;
}
let wrongSort='new';
function buildWrongDetailHtml(q){
  const ansText=(q.options||[])[String(q.answer||'A').charCodeAt(0)-65]||'';
  return `<div class="hq-q">${esc(q.question)}</div>
    <div class="w-opt">${(q.options||[]).map((o,i)=>`<div><b>${String.fromCharCode(65+i)}.</b> ${esc(o)}</div>`).join('')}</div>
    <div class="hq-ans">正确答案：${esc(q.answer)}${ansText?'（'+esc(ansText)+'）':''}</div>
    ${q.translation?`<div class="w-exp"><b>参考译文</b> ${esc(q.translation)}</div>`:''}
    <div class="w-exp"><b>解析</b> ${esc(q.explanation||'暂无')}</div>`;
}
function toggleWrong(row){
  const holder=row.nextElementSibling;
  if(!holder)return;
  if(holder.innerHTML.trim()){holder.innerHTML='';row.classList.remove('open');return}
  $$('#wrong-list .inline-detail').forEach(h=>h.innerHTML='');
  $$('#wrong-list .wrong-row').forEach(r=>r.classList.remove('open'));
  const q=read('wrong-questions').find(x=>x.id===row.dataset.id);
  if(q){holder.innerHTML=buildWrongDetailHtml(q);row.classList.add('open')}
}
function renderWrong(){
  const w=read('wrong-questions'),d=read('details');
  const stat={};
  d.forEach(x=>{if(x.ok)return;const e=stat[x.qid]||(stat[x.qid]={n:0,last:0});e.n++;if(x.ts>e.last)e.last=x.ts});
  const rows=w.map(q=>{const s=stat[q.id]||{n:0,last:0};return {q,n:s.n,last:s.last}});
  rows.sort(wrongSort==='most'?(a,b)=>b.n-a.n||b.last-a.last:(a,b)=>b.last-a.last||b.n-a.n);
  $('#wrong-count')&&($('#wrong-count').textContent=rows.length);
  $('#wrong-list').innerHTML=rows.length?rows.map(({q,n})=>`<div class="hist-item"><div class="recent-row wrong-row" data-id="${esc(q.id)}"><span class="mini-icon pink">⚑</span><div class="wrong-body"><b>${esc(shortQ(q.question))}</b></div><span class="wcount">错 ${n} 次</span><span class="arr">▾</span></div><div class="inline-detail"></div></div>`).join(''):'<div class="empty-state">还没有错题，继续保持！</div>';
  $$('#wrong-list .wrong-row').forEach(r=>r.onclick=()=>toggleWrong(r));
}
function renderHistoryList(){
  const ses=read('sessions');
  const fmt=(x)=>`<div class="hist-item"><div class="recent-row clickable" data-start="${x.start}"><span class="mini-icon blue">◷</span><div><b>${esc(x.bank||'中华文化知识库')}</b><small>${new Date(x.start).toLocaleString('zh-CN')} · ${x.qCount} 题 · 用时 ${fmtMin(x.sec)}</small></div><span class="score">${x.qCount?Math.round((x.correct||0)/x.qCount*100):0}<span>%</span></span><span class="arr">▾</span></div><div class="inline-detail"></div></div>`;
  $('#history-list').innerHTML=ses.length?ses.slice().reverse().map(fmt).join(''):'<div class="empty-state">完成一次练习后，这里会显示记录。</div>';
  $$('#history-list .hist-item .recent-row').forEach(row=>row.onclick=()=>toggleInline(row));
}
function renderReview(){
  renderWrong();
  renderHistoryList();
}
function detailRowsHtml(items){
  const TYPE={single:'单选',multiple:'多选',judge:'判断',fill:'填空'};
  const chosenText=(x)=>{
    const ch=x.chosen||'';
    if(!ch)return x.ok?'（自评：正确）':'（自评：错误）';
    return [...ch].map(l=>{const idx=l.charCodeAt(0)-65;const o=(x.opts&&x.opts[idx])?shortQ(x.opts[idx]):'';return `${l}${o?' '+o:''}`}).join('；');
  };
  return items.map((x,i)=>{
    const durMs=x.durMs??(i===0?(x.start?(x.ts-x.start):0):(x.ts-items[i-1].ts));
    const sec=Math.max(0,Math.round((durMs||0)/1000));
    const lim=qLimitOf(x),over=sec>lim;
    return `<div class="hist-q ${x.ok?'ok':'no'}"><div class="hq-head"><b>${TYPE[x.type]||'题'}${i+1}</b><span class="hq-res">${x.ok?'答对 ✓':'答错 ✗'}</span><span class="hq-dur ${over?'over-time':''}">用时 ${fmtClock(sec)}${over?'（超时）':''}</span></div><div class="hq-q">${esc(shortQ(x.q))}</div><div class="hq-ans">你的选择：${esc(chosenText(x))} ｜ 正确答案：${esc(x.ans||'—')}</div></div>`;
  }).join('');
}
function toggleInline(row){
  const holder=row.nextElementSibling;
  if(!holder)return;
  if(holder.innerHTML.trim()){holder.innerHTML='';row.classList.remove('open');return}
  document.querySelectorAll('#history-list .inline-detail').forEach(h=>h.innerHTML='');
  document.querySelectorAll('#history-list .recent-row').forEach(r=>r.classList.remove('open'));
  const items=read('details').filter(x=>x.start===Number(row.dataset.start));
  holder.innerHTML=items.length?detailRowsHtml(items):'<div class="empty-state">该场暂无逐题明细（早期记录不含）。</div>';
  row.classList.add('open');
}
function openHistoryDetail(st){
  const cur=document.querySelector('.view.active-view')?.id;
  if(cur!=='history')showView('history');
  const rows=[...document.querySelectorAll('#history-list .recent-row')];
  const row=rows.find(r=>String(r.dataset.start)===String(st));
  if(row)toggleInline(row);
}
function renderHistoryDetail(startStr){ // legacy direct renderer (kept for safety)
  const items=read('details').filter(x=>x.start===Number(startStr));
  const area=$('#history-detail');
  if(area)area.innerHTML=items.length?`<div class="hist-detail-head"><b>逐题明细</b></div>${detailRowsHtml(items)}`:'';
}
function qLimitOf(o){
  if(o&&o.kind==='modern')return 150;
  if(o&&o.kind==='classical')return 120;
  if(o&&o.kind==='reading')return 120;
  return ({single:30,multiple:45,judge:25,fill:40}[o&&o.type]||40);
}
function practiceMeta(label){
  const s=srsStore().qs,now=Date.now();let due=0,failed=0,fresh=0;
  for(const q of practiceQuestions){const c=s[q.id];if(!c){fresh++;continue}if(c.due&&c.due<=now){if(c.wrongStreak)failed++;else due++}else if(c.wrongStreak)failed++}
  return `${label} · 待复习 ${due} · 薄弱 ${failed} · 新题 ${fresh}`;
}
function renderReviewDone(){
  $('#practice-card').innerHTML=`<div class="empty-state"><h3 style="margin:10px 0 8px;color:#7254df">🎉 今日复习完成</h3><p style="line-height:1.8">到期的复习题与薄弱题已全部处理完毕。明天再来巩固新一批，或继续自由刷题。</p><div style="margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="outline" id="review-done-home">返回首页</button><button class="primary" id="review-done-free">继续自由刷题</button></div></div>`;
  $('#review-done-home').onclick=()=>showView('home');
  $('#review-done-free').onclick=()=>{practiceMode='free';ensureSession();renderQuestion()};
}
function startReview(){
  practiceArmed=true;
  const groups=bankGroups();const all=(groups[activeBank]||[]).filter(q=>!q.needsReview);
  practiceQuestions=all;
  if(!all.length){practiceArmed=false;toast('题库尚未加载完成，请稍候');return}
  const now=Date.now(),st=srsStore().qs;
  const due=all.filter(q=>st[q.id]&&st[q.id].due&&st[q.id].due<=now);
  if(!due.length){practiceArmed=false;practiceQuestions=bankQuestions(activeBank);toast('当前没有到期的复习题，可先开始刷题，稍后再复习');practiceMode='free';taskIds=[];showView('practice');return}
  practiceMode='review';taskIds=due.map(q=>q.id);taskTotal=taskIds.length;sessionRecent=[];
  showView('practice');
}
function renderQuestion(){
  qStart=Date.now();
  if(practiceMode==='review'&&taskIds.length===0){renderReviewDone();return}
  currentQ=pickQuestion();
  if(!currentQ){if(practiceMode==='review'){renderReviewDone();return}$('#practice-card').innerHTML=`<div class="empty-state">“${esc(activeBank)}”暂无题目可刷，请选择其他题库。</div>`;return}
  const q=currentQ,multi=q.type==='multiple',fill=q.type==='fill',judge=q.type==='judge';
  const label=q.generatedOptions?'单选题 · 整理版选项':(fill?'填空题':multi?'多选题':judge?'判断题':'单选题');
  if($('#practice-index'))$('#practice-index').textContent=practiceMode==='review'?`今日复习 · 剩余 ${taskIds.length} / ${taskTotal} 题`:practiceMeta(label);
  const todayCount=read('sessions').filter(x=>dayKey(x.start)===dayKey()).reduce((n,x)=>n+(x.qCount||0),0);
  const inSession=session?session.qCount:0;
  const ratio=practiceMode==='review'&&taskTotal?Math.max(0,Math.min(100,Math.round((taskTotal-taskIds.length+1)/taskTotal*100))):100;
  if($('#practice-meter'))$('#practice-meter').style.width=`${ratio}%`;
  if($('#aside-meter'))$('#aside-meter').style.width=`${ratio}%`;
  if($('#aside-progress'))$('#aside-progress').textContent=practiceMode==='review'?`今日复习：已处理 ${taskTotal-taskIds.length} / ${taskTotal} 题 · 答错会回炉重练`: `本场已刷 ${inSession} 题 · 今日 ${todayCount} 题 · 智能选题（遗忘曲线）`;
  const [btext,bcls]=badgeFor(q);
  const multiTip=q.type==='multiple'?'（多选：勾选全部正确项后再提交）':'';
  const meta=`<div class="question-meta"><span class="tag">${esc(activeBank)}</span><span class="q-badge ${bcls}">${btext}${multiTip}</span><span class="q-timers">总用时 <b id="time-total">0:00</b> · 本题 <b id="time-q">0:00</b></span></div>`;
  answered=false;
  if(fill){
    $('#practice-card').innerHTML=meta+questionHtml(q)+`      <div class="answer-tip" id="answer-tip"></div>
      <div id="fill-area" style="margin:4px 0 12px"><button class="outline" id="reveal-answer">显示答案</button></div>
      <div class="explanation" id="explanation" hidden></div>
      <div id="fill-self" hidden></div>
      <button class="next-btn" id="next-question" hidden>下一题 <span>→</span></button>`;
    $('#reveal-answer').onclick=()=>{
      $('#reveal-answer').hidden=true;
      const ans=q.answerText||(q.options&&q.options[0])||'（无答案）';
      const tip=$('#answer-tip');tip.textContent=`参考答案：${ans}`;tip.style.color='#58a879';
      const ex=$('#explanation');ex.hidden=false;ex.innerHTML=explainHtml(q);
      const fs=$('#fill-self');fs.hidden=false;
      fs.innerHTML=`<div style="font-size:11px;color:#8e8a9f;margin-bottom:10px">这道填空题你答对了吗？</div><button class="primary" id="self-correct" style="margin-right:10px">答对了 ✓</button><button class="next-btn" id="self-wrong" style="background:#df8065">答错了 ✗</button>`;
      $('#self-correct').onclick=()=>finishQuestion(true,q);
      $('#self-wrong').onclick=()=>finishQuestion(false,q);
    };
  }else if(multi){
    $('#practice-card').innerHTML=meta+questionHtml(q)+`      <div class="options">${(q.options||[]).map((o,i)=>`<button data-i="${i}"><i>${String.fromCharCode(65+i)}</i> ${esc(o)}</button>`).join('')}</div>
      <div class="answer-tip" id="answer-tip"></div>
      <div class="explanation" id="explanation" hidden></div>
      <button class="primary" id="submit-multi" style="margin-top:14px">提交答案</button>
      <button class="next-btn" id="next-question" hidden>下一题 <span>→</span></button>`;
    $$('.options button').forEach(b=>b.onclick=()=>{if(answered)return;b.classList.toggle('selected')});
    $('#submit-multi').onclick=()=>answer(null,q,false);
  }else{
    const os=(q.options&&q.options.length)?q.options:(q.type==='judge'?['正确','错误']:['正确','错误']);
    $('#practice-card').innerHTML=meta+questionHtml(q)+`      <div class="options">${os.map((o,i)=>`<button data-i="${i}"><i>${String.fromCharCode(65+i)}</i> ${esc(o)}</button>`).join('')}</div>
      <div class="answer-tip" id="answer-tip"></div>
      <div class="explanation" id="explanation" hidden></div>
      <button class="next-btn" id="next-question" hidden>下一题 <span>→</span></button>`;
    $$('.options button').forEach(b=>b.onclick=()=>answer(b,q,false));
  }
}
function nextQuestion(){sessionRecent.push(currentQ.id);currentQ=null;renderQuestion()}
async function answer(btn,q,fill){
  if(answered)return;answered=true;
  const exp=String(q.answer||'A').toUpperCase();
  const multi=q.type==='multiple';
  let ok=false,chosenTxt='';
  if(multi){
    const picks=$$('.options button.selected').map(b=>String.fromCharCode(65+Number(b.dataset.i))).sort().join('');
    ok=!!picks&&picks===exp.split('').sort().join('');
    chosenTxt=picks;
  }else{
    const pick=String.fromCharCode(65+Number(btn.dataset.i));
    ok=exp.includes(pick);
    chosenTxt=pick;
  }
  finishQuestion(ok,q,chosenTxt);
}
function wrongListAdd(q){const w=read('wrong-questions');if(!w.some(x=>x.id===q.id))w.push(q);write('wrong-questions',w)}
function wrongListRemove(qid){write('wrong-questions',read('wrong-questions').filter(x=>x.id!==qid))}
function recordAnswer(q,ok,chosen){
  ensureSession();
  const d=read('details');const now=Date.now();
  d.push({start:session.start,qid:q.id,type:q.type,q:(q.question||'').slice(0,500),ans:q.answer||'',chosen:chosen||'',kind:kindOf(q),ok:!!ok,ts:now,durMs:qStart?Math.max(0,now-qStart):0});
  if(d.length>5000)d.splice(0,d.length-5000);
  write('details',d);
}
function finishQuestion(ok,q,chosen){
  const multi=q.type==='multiple';
  const exp=String(q.answer||'A').toUpperCase();
  const expLetters=exp.split('');
  const expText=multi?(q.options||[]).filter((_,i)=>expLetters.includes(String.fromCharCode(65+i))).join('、'):(q.type==='judge'?(q.answer==='A'?'正确':'错误'):exp);
  $$('.options button').forEach(b=>{
    const l=String.fromCharCode(65+Number(b.dataset.i));
    if(expLetters.includes(l))b.classList.add('selected');
    if(!multi&&b.classList.contains('selected')&&!expLetters.includes(l))b.classList.add('wrong');
  });
  if(!ok&&multi)$$('.options button.selected').forEach(b=>{if(!expLetters.includes(String.fromCharCode(65+Number(b.dataset.i))))b.classList.add('wrong')});
  const tip=$('#answer-tip');
  tip.textContent=ok?'回答正确！继续保持 ✨':`回答错误，正确答案是 ${expText}`;
  tip.style.color=ok?'#58a879':'#df8065';
  const ex=$('#explanation');ex.hidden=false;
  ex.innerHTML=explainHtml(q);
  const sm=$('#submit-multi');if(sm)sm.hidden=true;
  const self=$('#fill-self');if(self)self.hidden=true;
  const next=$('#next-question');if(next){next.hidden=false;next.onclick=nextQuestion}
  // spaced repetition update
  applyResult(q.id,ok);
  if(!ok){wrongListAdd(q)}else{wrongListRemove(q.id)}
  bumpSession(ok);recordAnswer(q,ok,chosen);paintTimeOver();updateStats();
  if(practiceMode==='review'){
    if(ok){taskIds=taskIds.filter(id=>id!==q.id)}else{taskIds=taskIds.filter(id=>id!==q.id);taskIds.push(q.id)}
    if(taskIds.length===0){closeSession();practiceMode='reviewDone';renderReviewDone();return}
  }
  if(user&&db){
    if(ok)db.from('wrong_questions').delete().eq('user_id',user.id).eq('question_id',q.id).then(()=>{}).catch(()=>{});
    else db.from('wrong_questions').upsert({user_id:user.id,question_id:q.id,question:q},{onConflict:'user_id,question_id'}).then(()=>{}).catch(()=>{});
    syncReviewToCloud(q.id);
  }
}
async function syncReviewToCloud(qid){
  if(!user||!db)return;
  const c=srsStore().qs[qid];if(!c)return;
  try{await db.from('review_state').upsert({user_id:user.id,question_id:qid,box:c.box,due_at:new Date(c.due||Date.now()).toISOString(),wrong:c.wrong,ok_count:c.ok},{onConflict:'user_id,question_id'})}catch(e){}
}
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
if(location.protocol==='file:'&&$('#file-warning'))$('#file-warning').hidden=false;
async function importFile(file){const ext=file.name.toLowerCase().split('.').pop();try{let rows=[];if(['xlsx','xls'].includes(ext)&&window.XLSX){const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:'array'});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''})}else if(ext==='json'){rows=JSON.parse(await file.text());}else if(['csv','txt','md'].includes(ext)){const text=await file.text();rows=text.split(/\r?\n/).filter(Boolean).map((line,i)=>({question:line,options:['正确','错误'],answer:'A',explanation:'用户上传资料，待补充解析。',source:file.name,type:'single'}))}else{toast(`${file.name}：此格式需要服务端解析，未写入题库`);return}const imported=rows.map((r,i)=>{const v=normalize({source:file.name,type:r.type||'single',question:r.question||r['题目']||r['问题']||'',options:r.options||[r['选项A']||r.A||'正确',r['选项B']||r.B||'错误',r['选项C']||r.C||'',r['选项D']||r.D||''],answer:r.answer||r['答案']||'A',explanation:r.explanation||r['解析']||'用户上传资料，待补充解析。'},`upload-${Date.now()}-${i}`);return v});questions=questions.concat(imported);write('uploaded-questions',questions.filter(q=>q.source===file.name));renderBanks();renderQuestion();toast(`已导入 ${imported.length} 道题`)}catch(err){toast(`${file.name} 解析失败，请检查文件内容`)}}
$('#choose-file').onclick=()=>$('#file-input').click();$('#upload-trigger').onclick=()=>$('#file-input').click();$('#file-input').onchange=e=>[...e.target.files].forEach(importFile);const zone=$('#upload-zone');zone?.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragging')});zone?.addEventListener('dragleave',()=>zone.classList.remove('dragging'));zone?.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragging');[...e.dataTransfer.files].forEach(importFile)});
let authMode='login';function openAuth(){setAuthMode('login');$('#auth-modal').hidden=false;$('#auth-message').textContent=''}function closeAuth(){$('#auth-modal').hidden=true}function updateAuth(){const on=!!user;
const ao=$('#auth-open');if(ao)ao.hidden=on;
const nm=on?(user.user_metadata?.username||user.email?.split('@')[0]||'同学'):'未登录';
$('#profile-name').textContent=nm;$('#profile-email').textContent=on?(user.email||user.phone||'已登录'):'登录后数据按账号独立保存';
const av=$('#account-open .avatar');if(av)av.textContent=on?nm.slice(0,1):'用';
syncAuthButtons();
if($('#page-title').closest('#home-view')?.classList.contains('active-view')&&on)$('#page-title').textContent=`你好，${nm} 👋`;}
function setAuthMode(mode){authMode=mode;const signup=mode==='signup';
$('#auth-title').textContent=signup?'注册拾光题库':'登录拾光题库';
$('#auth-subtitle').textContent=signup?'填写用户名、邮箱（手机号选填）完成注册。':'使用邮箱 / 手机号 / 用户名 + 密码登录。';
$('#auth-submit').textContent=signup?'注册':'登录';
$('#auth-switch').textContent=signup?'已有账号？登录':'没有账号？注册';
$('#auth-divider-text').textContent=signup?'填写注册信息':'账号登录';
$('#auth-identifier').placeholder='邮箱 / 手机号 / 用户名';
const fields={identifier:$('#auth-identifier'),username:$('#auth-username'),email:$('#auth-email'),phone:$('#auth-phone'),password:$('#auth-password'),confirm:$('#auth-confirm')};
Object.entries(fields).forEach(([name,el])=>{if(!el)return;const visible=name==='password'||(name==='identifier'&&!signup)||((name==='username'||name==='email'||name==='phone'||name==='confirm')&&signup);el.hidden=!visible;el.style.display=visible?'block':'none'})}
$('#auth-open').onclick=openAuth;$('#auth-close').onclick=closeAuth;$('#auth-switch').onclick=()=>setAuthMode(authMode==='login'?'signup':'login');
const googleAuthBtn=$('#google-auth');if(googleAuthBtn)googleAuthBtn.onclick=async()=>{if(!db)return $('#auth-message').textContent='登录服务暂不可用';$('#auth-message').textContent='正在前往 Google 登录…';const redirectTo=location.protocol==='file:'?'https://teslacui.github.io/shiguang-quiz/':location.origin+location.pathname;const r=await db.auth.signInWithOAuth({provider:'google',options:{redirectTo}});if(r.error)$('#auth-message').textContent=`Google 登录失败：${r.error.message}`};
async function logout(){closeSession();if(db)await db.auth.signOut();user=null;sessionRecent=[];renderReview();updateStats();renderQuestion();updateAuth();toast('已退出登录（数据已切换）')}
function syncAuthButtons(){const on=!!user;for(const id of ['auth-open2']){const el=$('#'+id);if(el)el.hidden=on}for(const id of ['auth-logout2','ctx-logout']){const el=$('#'+id);if(el)el.hidden=!on}}
function renderAccountPanel(){
  const box=$('#set-account');if(!box)return;
  if(!user){box.innerHTML='<div class="acct-empty">尚未登录。登录后可跨设备同步错题、记录与复习计划。</div>';return}
  const meta=user.user_metadata||{};
  box.innerHTML=`<div class="acct-form">
    <label>用户名</label><input id="acct-username" value="${esc(meta.username||'')}" placeholder="用户名（至少 2 个字符）">
    <label>手机号（选填）</label><input id="acct-phone" value="${esc(user.phone||meta.phone||'')}" placeholder="手机号">
    <label>邮箱</label><input disabled value="${esc(user.email||'未绑定')}">
    <button class="primary" id="acct-save" style="margin-top:12px">保存修改</button>
  </div>`;
  const save=$('#acct-save');if(save)save.onclick=async()=>{
    const username=($('#acct-username').value||'').trim(),phone=($('#acct-phone').value||'').trim();
    if(username.length<2)return toast('用户名至少 2 个字符');
    if(db&&user){
      try{
        const {error}=await db.from('profiles').upsert({user_id:user.id,username,phone,email:user.email||''},{onConflict:'user_id'});
        if(error)throw error;
        await db.auth.updateUser({data:{username,phone}});
        user={...user,user_metadata:{...(user.user_metadata||{}),username,phone},phone};
        updateAuth();renderAccountPanel();toast('已保存');
      }catch(err){toast('保存失败：'+(err.message||err))}
    }else toast('请先登录');
  };
}
function applyFont(px){
  px=Number(px)||16;
  const r=px/16;
  document.documentElement.style.zoom=r;
  const s=read('settings',{});s.font=px;write('settings',s);
  $$('#font-btns button').forEach(b=>b.classList.toggle('on',Number(b.dataset.fs)===px));
}
function renderCalendar(){
  const el=$('#calendar');if(!el)return;
  const now=new Date(),y=now.getFullYear(),m=now.getMonth();
  const cm=$('#cal-month');if(cm)cm.textContent=`${y}年${m+1}月`;
  const days=new Set(read('sessions').map(x=>dayKey(x.start)));
  const first=new Date(y,m,1),lead=(first.getDay()+6)%7,total=new Date(y,m+1,0).getDate();
  const today=now.getDate();
  const wk=(arr)=>`<div class="cal-week">${arr.join('')}</div>`;
  let out='<div class="cal-week cal-head">'+['一','二','三','四','五','六','日'].map(w=>`<span>${w}</span>`).join('')+'</div>';
  const cells=[];
  for(let i=0;i<lead;i++)cells.push('<span class="cal-cell off"></span>');
  for(let d=1;d<=total;d++){
    const k=dayKey(new Date(y,m,d).getTime());
    const cls=['cal-cell',d===today?'today':'',days.has(k)?'done':''].filter(Boolean).join(' ');
    cells.push(`<span class="${cls}">${d}</span>`);
  }
  for(let i=0;i<cells.length;i+=7)out+=wk(cells.slice(i,i+7));
  el.innerHTML=out;
}
function showBankDetail(name){
  activeBank=name;
  const qs=(bankGroups()[name]||[]).filter(q=>!q.needsReview);
  const all=(bankGroups()[name]||[]);
  const d=read('details'),ids=new Set(all.map(q=>q.id));
  const doneSet=new Set();let dt=0,dok=0;
  d.forEach(x=>{if(!ids.has(x.qid))return;doneSet.add(x.qid);dt++;if(x.ok)dok++});
  const done=doneSet.size,pct=all.length?Math.round(done/all.length*100):0;
  const types={};
  all.forEach(q=>{const t=q.type==='fill'?'填空':q.type==='multiple'?'多选':q.type==='judge'?'判断':(q.rType?'阅读':'单选');types[t]=(types[t]||0)+1});
  const srs=srsStore().qs;let due=0,weak=0;
  all.forEach(q=>{const c=srs[q.id];if(!c)return;if(c.due&&c.due<=Date.now()){if(c.wrongStreak)weak++;else due++}});
  $('#detail-name').textContent=name;
  $('#detail-sub').textContent=`共 ${all.length} 题（可练 ${qs.length}）· 已刷 ${done} / ${all.length}`;
  $('#detail-body').innerHTML=`
    <div class="detail-progress"><div class="dp-top"><b>刷题进度</b><span>${done} / ${all.length} · ${pct}%</span></div><div class="meter"><i style="width:${pct}%"></i></div></div>
    <div class="detail-grid">
      <div class="set-card"><h4>题型构成</h4>${Object.entries(types).map(([k,v])=>`<div class="set-row"><span>${k}</span><b>${v} 题</b></div>`).join('')||'<div class="acct-empty">暂无</div>'}</div>
      <div class="set-card"><h4>完成情况</h4><div class="set-row"><span>本库作答正确率</span><b>${dt?Math.round(dok/dt*100)+'%':'—'}</b></div><div class="set-row"><span>到期复习</span><b>${due} 题</b></div><div class="set-row"><span>薄弱待巩固</span><b>${weak} 题</b></div></div>
    </div>
    <div class="detail-note">练习请统一从主页「开始刷题」进入（已记住当前题库：${esc(name)}）。</div>`;
  showView('detail');
}
function resetLocalData(){
  if(!confirm('将清除本账号/本机的刷题记录、逐题明细、错题本与复习计划（题库本身不删除），确定继续？'))return;
  for(const k of ['sessions','details','wrong-questions','practice-history'])write(k,[]);
  const s=srsStore();s.qs={};srsSave(s);
  toast('已清除本机练习数据');updateStats();renderReview();renderCalendar();renderAccountPanel();
}
// bind account/settings ui once
(function(){
  const menu=$('#account-menu');const ap=$('#account-open');
  if(ap)ap.addEventListener('contextmenu',(e)=>{e.preventDefault();menu.hidden=false;menu.style.left=Math.min(e.clientX,innerWidth-170)+'px';menu.style.top=Math.min(e.clientY,innerHeight-90)+'px'});
  document.addEventListener('click',(e)=>{if(menu&&!menu.contains(e.target))menu.hidden=true});
  $('#ctx-settings')&&($('#ctx-settings').onclick=()=>{menu.hidden=true;showView('settings')});
  $('#ctx-logout')&&($('#ctx-logout').onclick=()=>{menu.hidden=true;logout()});
  const a2=$('#auth-open2');if(a2)a2.onclick=openAuth;
  const l2=$('#auth-logout2');if(l2)l2.onclick=logout;
  $('#reset-local')&&($('#reset-local').onclick=resetLocalData);
  $$('#font-btns button').forEach(b=>b.onclick=()=>applyFont(b.dataset.fs));
$$('[data-wsort]').forEach(b=>b.onclick=()=>{wrongSort=b.dataset.wsort;$$('[data-wsort]').forEach(x=>x.classList.toggle('active',x===b));renderWrong()});
  const fs=read('settings',{}).font;if(fs)applyFont(fs);
})();

$('#clear-wrong').onclick=async()=>{write('wrong-questions',[]);const s=srsStore();for(const id in s.qs)if(s.qs[id].wrongStreak>0){s.qs[id].wrongStreak=0;s.qs[id].box=0}srsSave(s);if(user&&db){try{await db.from('wrong_questions').delete().eq('user_id',user.id)}catch(e){}}renderReview();updateStats();toast('已清空错题本')};
// ---- cloud sync (per current user namespace) ----
async function loadCloudForUser(){
  if(!user||!db)return;
  try{
    const [w,r,ps]=await Promise.all([
      db.from('wrong_questions').select('*').eq('user_id',user.id),
      db.from('review_state').select('*').eq('user_id',user.id),
      db.from('practice_sessions').select('*').eq('user_id',user.id).order('started_at',{ascending:true})
    ]);
    if(w&&!w.error&&w.data&&w.data.length)write('wrong-questions',w.data.map(x=>x.question));
    if(r&&!r.error&&r.data&&r.data.length){
      const s=srsStore();let touched=false;
      for(const row of r.data){if(row.question_id&&!s.qs[row.question_id]){s.qs[row.question_id]={box:row.box??0,last:0,due:row.due_at?new Date(row.due_at).getTime():0,wrong:row.wrong??0,ok:row.ok_count??0};touched=true}}
      if(touched)srsSave(s);
    }
    if(ps&&!ps.error&&ps.data){
      const loc=read('sessions'),byStart=new Set(loc.map(x=>x.start));let added=false;
      for(const row of ps.data){
        const st=row.started_at?new Date(row.started_at).getTime():0;
        if(st&&!byStart.has(st)){loc.push({bank:row.bank||'中华文化知识库',start:st,sec:row.duration_sec||0,qCount:row.q_count||0,correct:row.correct||0});byStart.add(st);added=true}
      }
      if(added){loc.sort((a,b)=>a.start-b.start);write('sessions',loc)}
    }
    updateStats();renderReview();renderQuestion();
  }catch(e){}
}
async function syncUserData(){await loadCloudForUser()}
async function ensureProfile(){if(!user||!db||!user.email)return;const p=user.user_metadata||{};if(p.username)await db.from('profiles').upsert({user_id:user.id,username:p.username,phone:p.phone||'',email:user.email},{onConflict:'user_id'})}
async function handleAuthSubmit(){
  if(!db)return $('#auth-message').textContent='登录服务暂不可用';
  const password=$('#auth-password').value;
  if(password.length<6)return $('#auth-message').textContent='密码至少需要 6 位';
  if(authMode==='signup'){
    const username=$('#auth-username').value.trim(),email=$('#auth-email').value.trim(),phone=$('#auth-phone').value.trim(),confirm=$('#auth-confirm').value;
    if(username.length<2)return $('#auth-message').textContent='请输入至少 2 个字符的用户名';
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return $('#auth-message').textContent='请输入有效邮箱';
    if(phone&&!/^\+?[0-9\- ]{7,}$/.test(phone))return $('#auth-message').textContent='请输入有效手机号（可留空）';
    if(password!==confirm)return $('#auth-message').textContent='两次输入的密码不一致';
    const r=await db.auth.signUp({email,password,options:{data:{username,phone}}});
    if(r.error){const m=r.error.message.toLowerCase();$('#auth-message').textContent=m.includes('rate limit')?'注册请求过于频繁，请稍后再试。':r.error.message;}
    else if(r.data&&r.data.user){user=r.data.user;closeAuth();updateAuth();ensureProfile().catch(()=>{});loadCloudForUser().catch(()=>{});toast('注册成功，已登录');}
    else{$('#auth-message').textContent='注册成功！若开启邮箱验证，请先查收邮件完成验证后再登录。';}
  }else{
    const identifier=$('#auth-identifier').value.trim();
    if(!identifier)return $('#auth-message').textContent='请输入邮箱 / 手机号 / 用户名';
    $('#auth-message').textContent='正在登录…';
    try{
      let r;
      if(identifier.includes('@')){r=await db.auth.signInWithPassword({email:identifier,password});}
      else if(/^\+?\d[\d\- ]{6,}$/.test(identifier)){
        const ph=identifier.startsWith('+')?identifier.replace(/[\- ]/g,''):(/^1[3-9]\d{9}$/.test(identifier)?`+86${identifier}`:identifier.replace(/[\- ]/g,''));
        r=await db.auth.signInWithPassword({phone:ph,password});
      }else{
        const {data:emailForUser,error:rpcErr}=await db.rpc('lookup_login_email',{p_identifier:identifier});
        if(rpcErr||!emailForUser)return $('#auth-message').textContent='未找到该用户名对应的账号，请检查后重试';
        r=await db.auth.signInWithPassword({email:emailForUser,password});
      }
      if(r.error){$('#auth-message').textContent=(r.error.message||'').toLowerCase().includes('rate limit')?'尝试过于频繁，请稍后再试':r.error.message;}
      else{user=r.data.user;closeAuth();updateAuth();toast(`欢迎回来，${user.user_metadata?.username||user.email||'同学'}！`);ensureProfile().catch(()=>{});loadCloudForUser().catch(()=>{});}
    }catch(err){$('#auth-message').textContent='登录失败，请检查账号信息或网络后重试';}
  }
}
window.addEventListener('pagehide',()=>{if(session)closeSession()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&session)closeSession()});
$('#main-go')&&($('#main-go').onclick=()=>{practiceArmed=false;showView('practice')});
function goStart(){practiceArmed=false;showView('practice')}
$('#help-open')&&($('#help-open').onclick=()=>{$('#help-modal').hidden=false});
$('#help-close')&&($('#help-close').onclick=()=>{$('#help-modal').hidden=true});
$('#practice-exit')&&($('#practice-exit').onclick=()=>{closeSession();practiceMode='free';practiceArmed=false;currentQ=null;sessionRecent=[];showView('home');toast('已退出，本场练习已记录')});
let qStart=0;
let CUR_VER='',REMOTE_VER='';
const verParts=(v)=>String(v||'').split('.').map((n,i)=>parseInt(n,10)||0);
function newerVer(a,b){const A=verParts(a),B=verParts(b);for(let i=0;i<3;i++){if(A[i]>B[i])return true;if(A[i]<B[i])return false}return false}
const verSet=(txt)=>{for(const id of ['#ver-tag','#ver-tag2']){const el=$(id);if(el)el.textContent=String(txt)}};
async function loadVerJson(){
  try{const r=await fetch('version.json',{cache:'no-store'});const j=await r.json();CUR_VER=String(j.version||'');verSet(CUR_VER||'?')}catch(e){verSet('?')}
}
async function checkUpdate(manual){
  const bt=$('#check-update');if(bt)bt.disabled=true;
  try{
    const r=await fetch('https://raw.githubusercontent.com/TeslaCui/shiguang-quiz/main/version.json',{cache:'no-store'});
    const j=await r.json();REMOTE_VER=String(j.version||'');
    if(!CUR_VER){await loadVerJson()}
    const newer=REMOTE_VER&&CUR_VER&&newerVer(REMOTE_VER,CUR_VER);
    const tag=$('#ver-new');if(tag)tag.hidden=!newer;
    if(newer){
      if(bt){bt.textContent='发现新版本 '+REMOTE_VER+'，点击刷新';bt.classList.add('active');bt.onclick=()=>location.reload()}
      if(!manual)toast('有可用新版本 '+REMOTE_VER+'，请刷新页面');
    }else if(manual){
      if(bt)bt.textContent='已是最新版本 '+CUR_VER;
      toast('当前已是最新版本 '+CUR_VER);
      setTimeout(()=>{if(bt)bt.textContent='检查更新'},2500);
    }
  }catch(e){if(manual){toast('无法连接更新源，请稍后再试');if(bt)bt.textContent='检查更新'}}
  if(bt)setTimeout(()=>{bt.disabled=false},1200);
}
$('#check-update')&&($('#check-update').onclick=()=>checkUpdate(true));
loadVerJson();setTimeout(()=>checkUpdate(false),2500);
function fmtClock(sec){sec=Math.max(0,Math.floor(sec||0));return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')}
function updateTimers(){
  if($('#time-total')&&session)$('#time-total').textContent=fmtClock((Date.now()-session.start)/1000);
  if($('#time-q')&&!answered&&qStart){const el=$('#time-q');el.textContent=fmtClock((Date.now()-qStart)/1000);paintTimeOver()}
}
setInterval(updateTimers,1000);
function openHistoryDetail(st){
  const cur=document.querySelector('.view.active-view')?.id;
  if(cur!=='history')showView('history');
  renderHistoryDetail(st);
}
$('#auth-submit').onclick=handleAuthSubmit;
migrateLegacy();renderBanks();renderReview();updateStats();renderCalendar();
fetch('questions.json').then(r=>r.ok?r.json():[]).then(x=>{questions=enrichQuestions(x.map(normalize)).concat(read('uploaded-questions'));const groups=bankGroups();activeBank=groups['中华文化题库']?'中华文化题库':Object.keys(groups)[0]||'中华文化题库';practiceQuestions=(groups[activeBank]||[]).filter(q=>!q.needsReview);renderBanks();renderQuestion();updateStats()}).catch(()=>renderQuestion());
updateAuth();renderCalendar();renderAccountPanel();syncAuthButtons();
if(db){
  db.auth.getSession().then(({data})=>{user=data.session?.user||null;updateAuth();if(user){ensureProfile().catch(()=>{});loadCloudForUser().catch(()=>{})}}).catch(()=>{});
  db.auth.onAuthStateChange((_event,session)=>{const changed=session?.user?.id!==(user&&user.id);user=session?.user||null;updateAuth();if(user&&changed){ensureProfile().catch(()=>{});loadCloudForUser().catch(()=>{})}else if(!user){renderReview();updateStats();renderQuestion();}});
}

/* ================= 阅读试卷（整篇材料 + 多小题 + 一次批改） ================= */
const isReadingKind=(k)=>k==='reading'||k==='classical'||k==='modern';
function splitQ(q){
  const t=q.question||'';
  const i=t.indexOf('【阅读材料】'),j=t.indexOf('【小题');
  if(i>=0&&j>i){
    const no=Number((t.slice(j+5,j+12).match(/\d/)||[1])[0]);
    return {mat:t.slice(i+6,j).trim(),sub:t.slice(j).replace(/^【小题\s*\d+】?/,'').trim(),no};
  }
  return {mat:'',sub:t,no:1};
}
function gidOf(q){
  if(q.group&&q.group!=='未分组'&&q.group!=='')return q.group;
  const m=splitQ(q).mat||q.question||'';
  return m.slice(0,24);
}
function groupReadingQs(){
  const map={};
  practiceQuestions.forEach(q=>{if(!isReadingKind(kindOf(q)))return;const g=gidOf(q); (map[g]=map[g]||[]).push(q)});
  Object.values(map).forEach(arr=>{arr.sort((a,b)=>splitQ(a).no-splitQ(b).no);if(arr.length>5)arr.splice(5)});
  return map;
}
let rCur=null,rRecent=[];
function renderReadingPass(){
  const groups=groupReadingQs();const keys=Object.keys(groups);
  if(!keys.length){$('#practice-card').innerHTML='<div class="empty-state">暂无阅读材料。</div>';return}
  const avail=keys.filter(k=>!rRecent.includes(k));
  const key=avail.length?avail[Math.floor(Math.random()*avail.length)]:keys[Math.floor(Math.random()*keys.length)];
  rRecent.push(key);if(rRecent.length>5)rRecent.shift();
  rCur={key,items:groups[key].map(q=>({q,sel:null})),idx:0};
  drawReading();
}
function drawReading(){
  const p=rCur;if(!p)return;
  const item=p.items[p.idx],q=item.q,{mat,sub,no}=splitQ(q);
  const n=p.items.length,done=p.items.filter(x=>x.sel!=null).length;
  qStart=Date.now();
  if($('#practice-index'))$('#practice-index').textContent=`阅读理解 · ${p.key}`;
  const opts=(q.options||[]).map((o,i)=>{
    const L=String.fromCharCode(65+i);
    const sel=item.sel===L;
    return `<button class="${sel?'selected':''}" data-l="${L}" ${sel?'':''}><i>${L}</i> ${esc(o)}</button>`;
  }).join('');
  $('#practice-card').innerHTML=`
    <div class="question-meta"><span class="tag">${esc(activeBank)}</span><span class="q-badge ${q.rType==='modern'?'b-modern':'b-classical'}">阅读 · ${q.rType==='modern'?'白话文':'文言文'}</span><span class="q-timers">总用时 <b id="time-total">0:00</b> · 本题 <b id="time-q">0:00</b></span></div>
    <div class="rd-title">《${esc(p.key)}》${mat?`<span class="rd-subinfo">共 ${n} 小题</span>`:''}</div>
    ${mat?`<div class="reading-mat rd-mat">${esc(mat)}</div>`:''}
    <div class="rd-q">
      <div class="rd-no">第 ${no} 题 / 共 ${n} 题</div>
      <h3 style="font-size:17px">${esc(sub)}</h3>
      <div class="options">${opts}</div>
    </div>
    <div class="rd-nav">
      <button class="outline" id="rd-prev" ${p.idx===0?'disabled':''}>‹ 上一题</button>
      <button class="primary" id="rd-submit" ${done<n?'disabled':''}>提交批改（${done}/${n}）</button>
      <button class="outline" id="rd-next" ${p.idx>=n-1?'disabled':''}>下一题 ›</button>
    </div>`;
  const pick=(L)=>{item.sel=L;$$('#practice-card .rd-q .options button').forEach(b=>b.classList.toggle('selected',b.dataset.l===L));const d=$$('#practice-card .rd-q .options button.selected').length||1;const dn=p.items.filter(x=>x.sel!=null).length;const sb=$('#rd-submit');if(sb){sb.disabled=dn<n;sb.textContent=`提交批改（${dn}/${n}）`}};
  $$('#practice-card .rd-q .options button').forEach(b=>b.onclick=()=>pick(b.dataset.l));
  const subBtn=$('#rd-submit');
  if(subBtn)subBtn.onclick=()=>{const un=p.items.filter(x=>x.sel==null).length;if(un>0){toast(`还有 ${un} 题未作答`);return}submitReading()};
  const prev=$('#rd-prev');if(prev)prev.onclick=()=>{if(p.idx>0){p.idx--;drawReading()}};
  const next=$('#rd-next');if(next)next.onclick=()=>{if(p.idx<n-1){p.idx++;drawReading()}};
}
function recordReadingAnswer(q,ok,sel){
  ensureSession();
  const now=Date.now(),d=read('details');
  d.push({start:session.start,qid:q.id,type:q.type,q:(q.question||'').slice(0,500),ans:q.answer||'',chosen:sel||'',kind:kindOf(q),ok:!!ok,ts:now,durMs:0});
  if(d.length>5000)d.splice(0,d.length-5000);
  write('details',d);
  session.qCount++;if(ok)session.correct++;
  applyResult(q.id,ok);
  if(ok)wrongListRemove(q.id);else wrongListAdd(q);
  if(user&&db){
    if(ok)db.from('wrong_questions').delete().eq('user_id',user.id).eq('question_id',q.id).then(()=>{}).catch(()=>{});
    else db.from('wrong_questions').upsert({user_id:user.id,question_id:q.id,question:q},{onConflict:'user_id,question_id'}).then(()=>{}).catch(()=>{});
    const c=srsStore().qs[q.id];
    if(c)db.from('review_state').upsert({user_id:user.id,question_id:q.id,box:c.box,due_at:new Date(c.due||Date.now()).toISOString(),wrong:c.wrong,ok_count:c.ok},{onConflict:'user_id,question_id'}).then(()=>{}).catch(()=>{});
  }
}
function submitReading(){
  const p=rCur;if(!p)return;
  let okN=0;
  p.items.forEach((it)=>{
    const q=it.q;const L=String(q.answer||'A').toUpperCase();
    const ok=it.sel===L;
    it.ok=ok;if(ok)okN++;
    recordReadingAnswer(q,ok,it.sel||'');
  });
  const n=p.items.length;
  const rows=p.items.map((it,i)=>{
    const q=it.q,{sub}=splitQ(q);
    const letters=(q.options||[]).map((o,j)=>String.fromCharCode(65+j));
    const showSel=it.sel?`${it.sel}. ${esc((q.options||[])[it.sel.charCodeAt(0)-65]||'')}`:'（未作答）';
    const showAns=`${q.answer}. ${esc((q.options||[])[String(q.answer).charCodeAt(0)-65]||'')}`;
    return `<div class="hist-q ${it.ok?'ok':'no'}"><div class="hq-head"><b>第 ${i+1} 题</b><span class="hq-res">${it.ok?'答对 ✓':'答错 ✗'}</span></div><div class="hq-q">${esc(sub)}</div><div class="hq-ans">你的选择：${showSel} ｜ 正确答案：${showAns}</div>${explainHtml(q)}</div>`;
  }).join('');
  const pct=Math.round(okN/n*100);
  $('#practice-card').innerHTML=`
    <div class="rd-result-head"><div><b>《${esc(p.key)}》批改结果</b><span>答对 ${okN}/${n} · 正确率 ${pct}%</span></div></div>
    ${rows}
    <div class="rd-nav"><button class="primary" id="rd-again">再做一篇 →</button><button class="outline" id="rd-end">结束练习</button></div>`;
  $('#rd-again').onclick=()=>renderReadingPass();
  $('#rd-end').onclick=()=>{closeSession();practiceMode='free';practiceArmed=false;showView('home');toast('已结束阅读练习')};
  updateStats();
}

/* ============ 阅读试卷 v2：整篇在上，全部小题同屏，一次提交 ============ */
function matHtml(mat){
  if(!mat)return '';
  const parts=String(mat).split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/).filter(s=>s.trim());
  return `<div class="reading-mat rd-mat">${parts.map(s=>`<p>${esc(s.trim())}</p>`).join('')}</div>`;
}
let rLastType=null;
function choosePassKey(){
  const groups=groupReadingQs();const keys=Object.keys(groups);
  if(!keys.length)return null;
  const toggle=practiceKind==='reading';
  let pool=keys;
  if(toggle&&rLastType){
    const other=rLastType==='classical'?'modern':'classical';
    const oth=keys.filter(k=>groups[k][0]&&groups[k][0].rType===other);
    if(oth.length)pool=oth;
  }
  const avail=pool.filter(k=>!rRecent.includes(k));
  const pick=(avail.length?avail:pool)[Math.floor(Math.random()*(avail.length?avail.length:pool.length))];
  rLastType=groups[pick][0].rType;
  return pick;
}
function drawReading(){
  const groups=groupReadingQs();
  const key=choosePassKey();
  if(!key){$('#practice-card').innerHTML='<div class="empty-state">暂无阅读材料。</div>';return}
  rRecent.push(key);if(rRecent.length>6)rRecent.shift();
  const items=groups[key].map(q=>({q,sel:null}));
  rCur={key,items};
  qStart=Date.now();
  if($('#practice-index'))$('#practice-index').textContent=`阅读理解 · ${key}`;
  renderReadingSheet();
}
function renderReadingSheet(){
  const p=rCur,key=p.key;
  const first=p.items[0].q;
  const {mat}=splitQ(first);
  const body=p.items.map((it,i)=>{
    const {sub}=splitQ(it.q);
    const opts=(it.q.options||[]).map((o,j)=>{const L=String.fromCharCode(65+j);return `<button class="${it.sel===L?'selected':''}" data-l="${L}"><i>${L}</i> ${esc(o)}</button>`}).join('');
    return `<div class="rd-qitem" data-i="${i}">
      <div class="rd-qno">第 ${i+1} 题</div>
      <div class="rd-qtext">${esc(sub)}</div>
      <div class="options">${opts}</div>
    </div>`;
  }).join('');
  const done=p.items.filter(x=>x.sel!=null).length,n=p.items.length;
  $('#practice-card').innerHTML=`
    <div class="question-meta"><span class="tag">${esc(activeBank)}</span><span class="q-badge ${first.rType==='modern'?'b-modern':'b-classical'}">阅读 · ${first.rType==='modern'?'白话文':'文言文'}</span><span class="q-timers">总用时 <b id="time-total">0:00</b></span></div>
    <div class="rd-title">《${esc(key)}》<span class="rd-subinfo">${first.rType==='modern'?'白话文 · 整篇':'文言文'}</span></div>
    ${matHtml(mat)}
    <div class="rd-items">${body}</div>
    <div class="rd-nav"><button class="primary" id="rd-submit" ${done<n?'disabled':''}>提交批改（${done}/${n}）</button></div>`;
  const pick=(L,it)=>{it.sel=L;const done2=p.items.filter(x=>x.sel!=null).length;const sb=$('#rd-submit');if(sb){sb.disabled=done2<n;sb.textContent=`提交批改（${done2}/${n}）`}};
  $$('#practice-card .rd-qitem').forEach((el)=>{
    const idx=Number(el.dataset.i),it=p.items[idx];
    el.querySelectorAll('.options button').forEach(b=>b.onclick=()=>{it.sel=b.dataset.l;el.querySelectorAll('.options button').forEach(x=>x.classList.toggle('selected',x===b));const done2=p.items.filter(y=>y.sel!=null).length;const sb=$('#rd-submit');if(sb){sb.disabled=done2<p.items.length;sb.textContent=`提交批改（${done2}/${p.items.length}）`}});
  });
  const sb=$('#rd-submit');
  if(sb)sb.onclick=()=>{const un=p.items.filter(x=>x.sel==null).length;if(un>0){toast(`还有 ${un} 题未作答`);return}submitReading()};
}
function submitReading(){
  const p=rCur;if(!p)return;
  let okN=0;
  p.items.forEach(it=>{const q=it.q,L=String(q.answer||'A').toUpperCase();const ok=it.sel===L;it.ok=ok;if(ok)okN++;recordReadingAnswer(q,ok,it.sel||'')});
  const n=p.items.length,pct=Math.round(okN/n*100);
  const rows=p.items.map((it,i)=>{
    const q=it.q,{sub}=splitQ(q);
    const showSel=it.sel?`${it.sel}. ${esc((q.options||[])[it.sel.charCodeAt(0)-65]||'')}`:'（未作答）';
    const showAns=`${q.answer}. ${esc((q.options||[])[String(q.answer).charCodeAt(0)-65]||'')}`;
    return `<div class="hist-q ${it.ok?'ok':'no'}"><div class="hq-head"><b>第 ${i+1} 题</b><span class="hq-res">${it.ok?'答对 ✓':'答错 ✗'}</span></div><div class="hq-q">${esc(sub)}</div><div class="hq-ans">你的选择：${showSel} ｜ 正确答案：${showAns}</div>${explainHtml(q)}</div>`;
  }).join('');
  const itemsEl=$('#rd-items')?$('#rd-items'):null;
  // keep material & title; replace question list with results
  const listWrap=document.querySelector('.rd-items,.rd-nav');
  if(listWrap){
    const holder=document.createElement('div');holder.className='rd-result';
    holder.innerHTML=`<div class="rd-result-head"><div><b>《${esc(p.key)}》批改结果</b><span>答对 ${okN}/${n} · 正确率 ${pct}%</span></div></div>${rows}<div class="rd-nav"><button class="primary" id="rd-again">${practiceKind==='reading'?'再做一篇（自动切换文体）→':'再做一篇 →'}</button><button class="outline" id="rd-end">结束练习</button></div>`;
    listWrap.replaceWith(holder);
  }
  const again=$('#rd-again');if(again)again.onclick=()=>renderReadingPass();
  const end=$('#rd-end');if(end)end.onclick=()=>{closeSession();practiceMode='free';practiceArmed=false;showView('home');toast('已结束阅读练习')};
  updateStats();
}

/* ============ 阅读试卷 v3：左文章右题目，逐题切换，整篇合并材料 ============ */
function mergedMat(items){
  const seen=new Set(),parts=[];
  items.forEach(it=>{const q=it.q||it;const {mat}=splitQ(q);if(mat&&!seen.has(mat)){seen.add(mat);parts.push(mat)}});
  return parts.join('\n\n');
}
function renderReadingSheet(){
  const p=rCur,key=p.key,n=p.items.length;
  const first=p.items[0].q;
  const mat=mergedMat(p.items);
  const renderQ=()=>{
    const it=p.items[p.idx],q=it.q,{sub}=splitQ(q);
    const opts=(q.options||[]).map((o,j)=>{const L=String.fromCharCode(65+j);return `<button class="${it.sel===L?'selected':''}" data-l="${L}"><i>${L}</i> ${esc(o)}</button>`}).join('');
    const done=p.items.filter(x=>x.sel!=null).length;
    return `<div class="rd-qmeta">第 ${p.idx+1} 题 / 共 ${n} 题</div>
      <div class="rd-qtext">${esc(sub)}</div>
      <div class="options">${opts}</div>
      <div class="rd-nav">
        <button class="outline" id="rd-prev" ${p.idx===0?'disabled':''}>‹ 上一题</button>
        <button class="outline" id="rd-next" ${p.idx>=n-1?'disabled':''}>下一题 ›</button>
      </div>
      <button class="primary" id="rd-submit" style="width:100%;margin-top:12px" ${done<n?'disabled':''}>提交批改（${done}/${n}）</button>
      <div class="rd-mini">已答：${done} / ${n} · 可随时改选，全部答完后再提交</div>`;
  };
  $('#practice-card').innerHTML=`
    <div class="question-meta"><span class="tag">${esc(activeBank)}</span><span class="q-badge ${first.rType==='modern'?'b-modern':'b-classical'}">阅读 · ${first.rType==='modern'?'白话文':'文言文'}</span><span class="q-timers">总用时 <b id="time-total">0:00</b></span></div>
    <div class="rd-layout">
      <div class="rd-article">
        <div class="rd-titlecard"><b>《${esc(key)}》</b><span>${first.rType==='modern'?'白话文 · 整篇':'文言文'} · 共 ${n} 小题</span></div>
        ${matHtml(mat)}
      </div>
      <div class="rd-side" id="rd-side">${renderQ()}</div>
    </div>`;
  const paint=()=>{const side=$('#rd-side');if(side)side.innerHTML=renderQ();bindQ()};
  const bindQ=()=>{
    $$('#rd-side .options button').forEach(b=>b.onclick=()=>{const it=p.items[p.idx];it.sel=b.dataset.l;$$('#rd-side .options button').forEach(x=>x.classList.toggle('selected',x===b));refreshDone()});
    const prev=$('#rd-prev'),next=$('#rd-next');
    if(prev)prev.onclick=()=>{if(p.idx>0){p.idx--;qStart=Date.now();paint()}};
    if(next)next.onclick=()=>{if(p.idx<p.items.length-1){p.idx++;qStart=Date.now();paint()}};
    const sb=$('#rd-submit');if(sb)sb.onclick=()=>{const un=p.items.filter(x=>x.sel==null).length;if(un>0){toast(`还有 ${un} 题未作答`);return}submitReading()};
  };
  const refreshDone=()=>{const done=p.items.filter(x=>x.sel!=null).length;const sb=$('#rd-submit');if(sb){sb.disabled=done<n;sb.textContent=`提交批改（${done}/${n}）`}};
  bindQ();
}
function submitReading(){
  const p=rCur;if(!p)return;
  let okN=0;
  p.items.forEach(it=>{const q=it.q,L=String(q.answer||'A').toUpperCase();const ok=it.sel===L;it.ok=ok;if(ok)okN++;recordReadingAnswer(q,ok,it.sel||'')});
  const n=p.items.length,pct=Math.round(okN/n*100);
  const rows=p.items.map((it,i)=>{
    const q=it.q,{sub}=splitQ(q);
    const showSel=it.sel?`${it.sel}. ${esc((q.options||[])[it.sel.charCodeAt(0)-65]||'')}`:'（未作答）';
    const showAns=`${q.answer}. ${esc((q.options||[])[String(q.answer).charCodeAt(0)-65]||'')}`;
    return `<div class="hist-q ${it.ok?'ok':'no'}"><div class="hq-head"><b>第 ${i+1} 题</b><span class="hq-res">${it.ok?'答对 ✓':'答错 ✗'}</span></div><div class="hq-q">${esc(sub)}</div><div class="hq-ans">你的选择：${showSel} ｜ 正确答案：${showAns}</div>${explainHtml(q)}</div>`;
  }).join('');
  const side=$('#rd-side');
  if(side)side.innerHTML=`<div class="rd-result-head"><b>《${esc(p.key)}》批改结果</b><span>答对 ${okN}/${n} · 正确率 ${pct}%</span></div>${rows}<div class="rd-nav"><button class="primary" id="rd-again">${practiceKind==='reading'?'再做一篇（自动换文体）→':'再做一篇 →'}</button><button class="outline" id="rd-end">结束练习</button></div>`;
  const again=$('#rd-again');if(again)again.onclick=()=>renderReadingPass();
  const end=$('#rd-end');if(end)end.onclick=()=>{closeSession();practiceMode='free';practiceArmed=false;showView('home');toast('已结束阅读练习')};
  updateStats();
}
function drawReading(){
  const groups=groupReadingQs();const keys=Object.keys(groups);
  if(!keys.length){$('#practice-card').innerHTML='<div class="empty-state">暂无阅读材料。</div>';return}
  const key=choosePassKey()||keys[0];
  rRecent.push(key);if(rRecent.length>6)rRecent.shift();
  rCur={key,items:groups[key].map(q=>({q,sel:null})),idx:0};
  qStart=Date.now();
  if($('#practice-index'))$('#practice-index').textContent=`阅读理解 · ${key}`;
  renderReadingSheet();
}
