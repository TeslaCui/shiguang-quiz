const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const SUPABASE_URL='https://wcnmufiabeftlsregamh.supabase.co',SUPABASE_KEY='sb_publishable_FHlEZrROrCVM1WLdoij5Cw_7Ue64M1X';
const db=window.supabase?.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'shiguang-quiz-auth'}});
let user=null,questions=[],practiceQuestions=[],activeBank='中华文化题库',answered=false,currentQ=null,sessionRecent=[];
const titles={home:'总览',bank:'我的题库',practice:'开始刷题',wrong:'错题本'};
// ---------- per-user namespaced local storage ----------
const NS=()=>user?.id||'anon';
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
  const st=srsStore().qs,now=Date.now();
  const card=(qid)=>st[qid];
  const dueGood=all.filter(q=>{const c=card(q.id);return c&&c.due&&c.due<=now&&!c.wrongStreak});
  const dueBad=all.filter(q=>{const c=card(q.id);return c&&c.due&&c.due<=now&&c.wrongStreak});
  const fresh=all.filter(q=>!card(q.id));
  let pool;
  if(dueGood.length)pool=dueGood;
  else if(dueBad.length)pool=dueBad;
  else if(fresh.length)pool=fresh;
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
function showView(v){$$('.view').forEach(x=>x.classList.remove('active-view'));const target=$(`#${v}-view`);if(target)target.classList.add('active-view');$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#page-title').textContent=titles[v]||titles.home;if(v==='wrong')renderReview();if(v==='practice')renderQuestion()}
document.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)showView(b.dataset.view);const bank=e.target.closest('[data-bank]');if(bank)selectBank(bank.dataset.bank)});
function bankName(q){return q.source&&(/港澳台|文化史|古代文化|pdf/i.test(q.source))?'中华文化题库':q.source||'未命名题库'}
function bankGroups(){const m={};questions.forEach(q=>{const n=bankName(q);(m[n]??=[]).push(q)});return m}
function card(name,qs){const isCulture=name==='中华文化题库';return `<article class="bank-card" data-bank="${esc(name)}"><div class="bank-top"><span class="book-icon blue">${isCulture?'文':'✦'}</span><span class="card-arrow">↗</span></div><h4>${esc(name)}</h4><small>${qs.length} 道题 · ${isCulture?'港澳台考研中华文化':'用户上传题库'}</small></article>`}
function renderBanks(){const groups=bankGroups(),names=Object.keys(groups),h=names.length?names.map(n=>card(n,groups[n])).join(''):'<div class="empty-state">题库正在加载。</div>';$('#home-banks').innerHTML=h;$('#all-banks').innerHTML=h;$('#bank-count').textContent=names.length;$('#bank-count-all').textContent=names.length;if($('#bank-total'))$('#bank-total').textContent=questions.length}
function selectBank(name){activeBank=name;const groups=bankGroups();practiceQuestions=(groups[name]||[]).filter(q=>!q.needsReview);sessionRecent=[];currentQ=null;renderQuestion();showView('practice');toast(`已选择：${name}`)}
function updateStats(){
  const h=read('practice-history'),total=h.reduce((n,x)=>n+(x.total||1),0),right=h.reduce((n,x)=>n+(x.correct??(x.score===100?1:0)),0);
  $('#total-answered').textContent=total;$('#accuracy').textContent=total?`${Math.round(right/total*100)}%`:'暂无';
  const s=srsStore().qs;let due=0,weak=0;for(const id in s){const c=s[id];if(!c.due)continue;if(c.due<=Date.now())due++;if(c.wrongStreak>0)weak++;}
  const today=h.filter(x=>Date.now()-(x.at||0)<86400000).length;
  const label=user?`${user.user_metadata?.username||user.email||''} 的专属数据`:'（未登录，数据仅存本浏览器）';
  $('#user-data-label')&&($('#user-data-label').textContent=label);
  $('#due-count')&&($('#due-count').textContent=due);$('#weak-count')&&($('#weak-count').textContent=weak);$('#today-count')&&($('#today-count').textContent=today);
  $('#recent-list').innerHTML=h.length?h.slice(-5).reverse().map(x=>`<div class="recent-row"><span class="mini-icon blue">◷</span><div><b>中华文化知识库</b><small>${x.time} · ${x.total} 题</small></div><span class="score">${x.score}<span>分</span></span></div>`).join(''):'<div class="empty-state">还没有练习记录，开始第一题吧。</div>'}
function renderReview(){const w=read('wrong-questions'),h=read('practice-history');$('#wrong-list').innerHTML=w.length?w.map(q=>`<div class="recent-row"><span class="mini-icon pink">⚑</span><div><b>${q.question}</b><small>答案：${q.answer||'见题目'} · ${q.explanation||'暂无解析'}</small></div></div>`).join(''):'<div class="empty-state">还没有错题，继续保持！</div>';$('#history-list').innerHTML=h.length?h.slice().reverse().map(x=>`<div class="recent-row"><span class="mini-icon blue">◷</span><div><b>中华文化知识库</b><small>${x.time} · ${x.total} 题</small></div><span class="score">${x.score}<span>分</span></div>`).join(''):'<div class="empty-state">完成一次练习后，这里会显示记录。</div>'}
function practiceMeta(label){
  const s=srsStore().qs,now=Date.now();let due=0,failed=0,fresh=0;
  for(const q of practiceQuestions){const c=s[q.id];if(!c){fresh++;continue}if(c.due&&c.due<=now){if(c.wrongStreak)failed++;else due++}else if(c.wrongStreak)failed++}
  return `${label} · 待复习 ${due} · 薄弱 ${failed} · 新题 ${fresh}`;
}
function renderQuestion(){
  currentQ=pickQuestion();
  if(!currentQ){$('#practice-card').innerHTML=`<div class="empty-state">“${esc(activeBank)}”暂无题目可刷，请选择其他题库。</div>`;return}
  const q=currentQ,multi=q.type==='multiple',fill=q.type==='fill',judge=q.type==='judge';
  const label=q.generatedOptions?'单选题 · 整理版选项':(fill?'填空题':multi?'多选题':judge?'判断题':'单选题');
  if($('#practice-index'))$('#practice-index').textContent=practiceMeta(label);
  const doneToday=read('practice-history').length;
  if($('#practice-meter'))$('#practice-meter').style.width='100%';
  if($('#aside-meter'))$('#aside-meter').style.width='100%';
  if($('#aside-progress'))$('#aside-progress').textContent=`累计已刷 ${doneToday} 题 · 智能选题（遗忘曲线）`;
  const meta=`<div class="question-meta"><span class="tag">${esc(activeBank)}</span><span>${practiceMeta(label)}</span></div>`;
  answered=false;
  if(fill){
    $('#practice-card').innerHTML=meta+`<h3>${esc(q.question)}</h3>
      <div class="answer-tip" id="answer-tip"></div>
      <div id="fill-area" style="margin:4px 0 12px"><button class="outline" id="reveal-answer">显示答案</button></div>
      <div class="explanation" id="explanation" hidden></div>
      <div id="fill-self" hidden></div>
      <button class="next-btn" id="next-question" hidden>下一题 <span>→</span></button>`;
    $('#reveal-answer').onclick=()=>{
      $('#reveal-answer').hidden=true;
      const ans=q.answerText||(q.options&&q.options[0])||'（无答案）';
      const tip=$('#answer-tip');tip.textContent=`参考答案：${ans}`;tip.style.color='#58a879';
      const ex=$('#explanation');ex.hidden=false;ex.innerHTML=`<b>解析</b> ${esc(q.explanation||'原始题库未提供解析。')}`;
      const fs=$('#fill-self');fs.hidden=false;
      fs.innerHTML=`<div style="font-size:11px;color:#8e8a9f;margin-bottom:10px">这道填空题你答对了吗？</div><button class="primary" id="self-correct" style="margin-right:10px">答对了 ✓</button><button class="next-btn" id="self-wrong" style="background:#df8065">答错了 ✗</button>`;
      $('#self-correct').onclick=()=>finishQuestion(true,q);
      $('#self-wrong').onclick=()=>finishQuestion(false,q);
    };
  }else if(multi){
    $('#practice-card').innerHTML=meta+`<h3>${esc(q.question)}</h3>
      <div class="options">${(q.options||[]).map((o,i)=>`<button data-i="${i}"><i>${String.fromCharCode(65+i)}</i> ${esc(o)}</button>`).join('')}</div>
      <div class="answer-tip" id="answer-tip"></div>
      <div class="explanation" id="explanation" hidden></div>
      <button class="primary" id="submit-multi" style="margin-top:14px">提交答案</button>
      <button class="next-btn" id="next-question" hidden>下一题 <span>→</span></button>`;
    $$('.options button').forEach(b=>b.onclick=()=>{if(answered)return;b.classList.toggle('selected')});
    $('#submit-multi').onclick=()=>answer(null,q,false);
  }else{
    const os=(q.options&&q.options.length)?q.options:(q.type==='judge'?['正确','错误']:['正确','错误']);
    $('#practice-card').innerHTML=meta+`<h3>${esc(q.question)}</h3>
      <div class="options">${os.map((o,i)=>`<button data-i="${i}"><i>${String.fromCharCode(65+i)}</i> ${esc(o)}</button>`).join('')}</div>
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
  let ok=false;
  if(multi){
    const picks=$$('.options button.selected').map(b=>String.fromCharCode(65+Number(b.dataset.i))).sort().join('');
    ok=!!picks&&picks===exp.split('').sort().join('');
  }else{
    const pick=String.fromCharCode(65+Number(btn.dataset.i));
    ok=exp.includes(pick);
  }
  finishQuestion(ok,q);
}
function wrongListAdd(q){const w=read('wrong-questions');if(!w.some(x=>x.id===q.id))w.push(q);write('wrong-questions',w)}
function wrongListRemove(qid){write('wrong-questions',read('wrong-questions').filter(x=>x.id!==qid))}
function finishQuestion(ok,q){
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
  ex.innerHTML=`<b>解析</b> ${esc(q.explanation||'原始题库未提供解析。')}<br><b>文化知识补充</b> 建议结合时代背景、制度沿革、思想流派与代表人物复习。`;
  const sm=$('#submit-multi');if(sm)sm.hidden=true;
  const self=$('#fill-self');if(self)self.hidden=true;
  const next=$('#next-question');if(next){next.hidden=false;next.onclick=nextQuestion}
  // spaced repetition update
  applyResult(q.id,ok);
  if(!ok){wrongListAdd(q)}else{wrongListRemove(q.id)}
  const h=read('practice-history');h.push({name:'中华文化知识库',time:new Date().toLocaleString('zh-CN'),at:Date.now(),total:1,correct:ok?1:0,score:ok?100:0});write('practice-history',h);updateStats();
  if(user&&db){
    db.from('practice_history').insert({user_id:user.id,question_id:q.id,is_correct:ok}).then(()=>{}).catch(()=>{});
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
let authMode='login';function openAuth(){setAuthMode('login');$('#auth-modal').hidden=false;$('#auth-message').textContent=''}function closeAuth(){$('#auth-modal').hidden=true}function updateAuth(){const on=!!user;$('#auth-open').hidden=on;$('#auth-logout').hidden=!on;$('#profile-name').textContent=on?(user.user_metadata?.username||user.email?.split('@')[0]||'已登录用户'):'未登录';$('#profile-email').textContent=on?(user.email||user.phone||'已登录'):'登录后数据按账号独立保存';if($('#page-title').closest('#home-view')?.classList.contains('active-view'))$('#page-title').textContent=on?`你好，${user.user_metadata?.username||user.email?.split('@')[0]||'同学'} 👋`:'总览'}
function setAuthMode(mode){authMode=mode;const signup=mode==='signup';$('#auth-title').textContent=signup?'注册拾光题库':'登录拾光题库';$('#auth-subtitle').textContent=signup?'注册后使用手机号登录。':'使用手机号和密码登录。';$('#auth-submit').textContent=signup?'注册':'登录';$('#auth-switch').textContent=signup?'已有账号？登录':'没有账号？注册';$('#auth-divider-text').textContent=signup?'填写注册信息':'手机号登录';const fields={identifier:$('#auth-identifier'),username:$('#auth-username'),phone:$('#auth-phone'),password:$('#auth-password'),confirm:$('#auth-confirm')};Object.entries(fields).forEach(([name,el])=>{const visible=name==='password'||(name==='identifier'&&!signup)||(name==='username'&&signup)||(name==='phone'&&signup)||(name==='confirm'&&signup);el.hidden=!visible;el.style.display=visible?'block':'none'})}
$('#auth-open').onclick=openAuth;$('#auth-close').onclick=closeAuth;$('#auth-switch').onclick=()=>setAuthMode(authMode==='login'?'signup':'login');
const googleAuthBtn=$('#google-auth');if(googleAuthBtn)googleAuthBtn.onclick=async()=>{if(!db)return $('#auth-message').textContent='登录服务暂不可用';$('#auth-message').textContent='正在前往 Google 登录…';const redirectTo=location.protocol==='file:'?'https://teslacui.github.io/shiguang-quiz/':location.origin+location.pathname;const r=await db.auth.signInWithOAuth({provider:'google',options:{redirectTo}});if(r.error)$('#auth-message').textContent=`Google 登录失败：${r.error.message}`};
async function logout(){if(db)await db.auth.signOut();user=null;sessionRecent=[];renderReview();updateStats();renderQuestion();updateAuth();toast('已退出登录（本地数据已切换）')}
$('#auth-logout').onclick=logout;
$('#clear-wrong').onclick=async()=>{write('wrong-questions',[]);const s=srsStore();for(const id in s.qs)if(s.qs[id].wrongStreak>0){s.qs[id].wrongStreak=0;s.qs[id].box=0}srsSave(s);if(user&&db){try{await db.from('wrong_questions').delete().eq('user_id',user.id)}catch(e){}}renderReview();updateStats();toast('已清空错题本')};
// ---- cloud sync (per current user namespace) ----
async function loadCloudForUser(){
  if(!user||!db)return;
  try{
    const [h,w,r]=await Promise.all([
      db.from('practice_history').select('*').eq('user_id',user.id).order('answered_at',{ascending:true}),
      db.from('wrong_questions').select('*').eq('user_id',user.id),
      db.from('review_state').select('*').eq('user_id',user.id)
    ]);
    if(h&&!h.error&&h.data&&h.data.length){write('practice-history',h.data.map(x=>({name:'中华文化知识库',time:new Date(x.answered_at).toLocaleString('zh-CN'),total:1,correct:x.is_correct?1:0,score:x.is_correct?100:0})))}
    if(w&&!w.error&&w.data&&w.data.length)write('wrong-questions',w.data.map(x=>x.question));
    if(r&&!r.error&&r.data&&r.data.length){
      const s=srsStore();let touched=false;
      for(const row of r.data){if(row.question_id&&!s.qs[row.question_id]){s.qs[row.question_id]={box:row.box??0,last:0,due:row.due_at?new Date(row.due_at).getTime():0,wrong:row.wrong??0,ok:row.ok_count??0};touched=true}}
      if(touched)srsSave(s);
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
    const username=$('#auth-username').value.trim(),phone=$('#auth-phone').value.trim(),confirm=$('#auth-confirm').value;
    if(!username||username.length<2)return $('#auth-message').textContent='请输入至少 2 个字符的用户名';
    if(!phone||/^\+?[0-9\- ]{7,}$/.test(phone)===false)return $('#auth-message').textContent='请输入有效手机号';
    if(password!==confirm)return $('#auth-message').textContent='两次输入的密码不一致';
    const normalizedPhone=phone.startsWith('+')?phone.replace(/[\- ]/g,''):(/^1[3-9]\d{9}$/.test(phone)?`+86${phone}`:phone.replace(/[\- ]/g,''));
    const r=await db.auth.signUp({phone:normalizedPhone,password,options:{data:{username,phone:normalizedPhone}}});
    if(r.error){const m=r.error.message.toLowerCase();$('#auth-message').textContent=m.includes('rate limit')?'注册请求过于频繁，请稍后再试。':r.error.message;}
    else{user=r.data.user;closeAuth();updateAuth();toast('注册成功，可以直接登录');}
  }else{
    const identifier=$('#auth-identifier').value.trim();
    if(!identifier)return $('#auth-message').textContent='请输入手机号';
    const normalizedPhone=identifier.startsWith('+')?identifier.replace(/[\- ]/g,''):(/^1[3-9]\d{9}$/.test(identifier)?`+86${identifier}`:identifier.replace(/[\- ]/g,''));
    const r=await db.auth.signInWithPassword({phone:normalizedPhone,password});
    if(r.error)$('#auth-message').textContent=r.error.message;
    else{user=r.data.user;closeAuth();updateAuth();toast('登录成功，正在载入你的专属题库数据…');ensureProfile().catch(()=>{});loadCloudForUser().catch(()=>{})}
  }
}
$('#auth-submit').onclick=handleAuthSubmit;
migrateLegacy();renderBanks();renderReview();updateStats();
fetch('questions.json').then(r=>r.ok?r.json():[]).then(x=>{questions=enrichQuestions(x.map(normalize)).concat(read('uploaded-questions'));const groups=bankGroups();activeBank=groups['中华文化题库']?'中华文化题库':Object.keys(groups)[0]||'中华文化题库';practiceQuestions=(groups[activeBank]||[]).filter(q=>!q.needsReview);renderBanks();renderQuestion();updateStats()}).catch(()=>renderQuestion());
updateAuth();
if(db){
  db.auth.getSession().then(({data})=>{user=data.session?.user||null;updateAuth();if(user){ensureProfile().catch(()=>{});loadCloudForUser().catch(()=>{})}}).catch(()=>{});
  db.auth.onAuthStateChange((_event,session)=>{const changed=session?.user?.id!==(user&&user.id);user=session?.user||null;updateAuth();if(user&&changed){ensureProfile().catch(()=>{});loadCloudForUser().catch(()=>{})}else if(!user){renderReview();updateStats();renderQuestion();}});
}
