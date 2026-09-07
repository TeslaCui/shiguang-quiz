const defaultBanks=[
 {name:'产品经理面试题',count:86,desc:'产品思维 · 用户研究',icon:'⌘',color:'blue'},
 {name:'英语四级词汇',count:320,desc:'高频词汇 · 近义辨析',icon:'文',color:'pink'},
 {name:'计算机网络基础',count:64,desc:'协议 · 网络安全',icon:'⌘',color:'yellow'}
];
let banks=JSON.parse(localStorage.getItem('study-banks')||'null')||defaultBanks;
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
function bankCard(b){return `<article class="bank-card"><div class="bank-top"><span class="book-icon ${b.color}">${b.icon||'▤'}</span><span class="card-arrow">↗</span></div><h4>${b.name}</h4><small>${b.count} 道题 · ${b.desc||'由上传资料生成'}</small></article>`}
function renderBanks(){ $('#home-banks').innerHTML=banks.slice(0,3).map(bankCard).join(''); $('#all-banks').innerHTML=banks.map(bankCard).join(''); $('#bank-count').textContent=banks.length; $('#bank-count-all').textContent=banks.length }
renderBanks();
const titles={home:'早上好，林同学 👋',bank:'我的题库',practice:'开始刷题'};
function showView(view){$$('.view').forEach(v=>v.classList.remove('active-view')); $(`#${view}-view`).classList.add('active-view'); $$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view)); $('#page-title').textContent=titles[view]||titles.home; window.scrollTo({top:0,behavior:'smooth'})}
document.addEventListener('click',e=>{const v=e.target.closest('[data-view]');if(v)showView(v.dataset.view)});
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
$('#choose-file').onclick=()=>$('#file-input').click(); $('#upload-trigger').onclick=()=>showView('bank')||$('#file-input').click();
['dragenter','dragover'].forEach(ev=>$('#upload-zone').addEventListener(ev,e=>{e.preventDefault();e.stopPropagation();$('#upload-zone').classList.add('dragging')}));
['dragleave','drop'].forEach(ev=>$('#upload-zone').addEventListener(ev,e=>{e.preventDefault();e.stopPropagation();$('#upload-zone').classList.remove('dragging');if(ev==='drop'&&e.dataTransfer.files.length)handleFiles([...e.dataTransfer.files])}));
$('#file-input').addEventListener('change',e=>{if(e.target.files.length)handleFiles([...e.target.files]);e.target.value=''});
function handleFiles(files){const valid=files.filter(f=>f.size<=10*1024*1024);if(valid.length<files.length)toast('已跳过超过 10MB 的文件');if(!valid.length)return;toast(`已选择 ${valid.length} 个文件，正在生成题库…`);valid.forEach((file,i)=>setTimeout(()=>handleFile(file,i===valid.length-1),i*520))}
function handleFile(file,last=true){const ext=file.name.split('.').pop().toLowerCase();const binary=['pdf','doc','docx','xls','xlsx','ppt','pptx'];if(binary.includes(ext)){setTimeout(()=>addBank(file.name.replace(/\.[^.]+$/,''),Math.max(8,Math.min(120,Math.round(file.size/24000)||12)),last),650);return}const reader=new FileReader();reader.onload=()=>{const text=reader.result||'';setTimeout(()=>addBank(file.name.replace(/\.[^.]+$/,''),extractCount(text),last),300)};reader.onerror=()=>toast(`${file.name} 读取失败，请重试`);reader.readAsText(file,'UTF-8')}
function extractCount(text){const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const q=lines.filter(x=>/^((\d+)[.、)]|[一二三四五六七八九十]+[、.])/.test(x));return Math.max(q.length,Math.min(99,Math.round(lines.length/3)||8))}
function addBank(name,count,last=true){const b={name,count,desc:'上传资料 · 自动生成',icon:'✦',color:['blue','pink','yellow'][banks.length%3]};banks.unshift(b);localStorage.setItem('study-banks',JSON.stringify(banks));renderBanks();showView('bank');if(last)toast(`解析完成！已生成 ${name} 等题库`)}
let answered=false; $$('.options button').forEach(btn=>btn.onclick=()=>{if(answered)return;answered=true;$$('.options button').forEach(b=>b.classList.remove('selected','wrong'));btn.classList.add('selected');const correct=btn.dataset.correct==='true';if(!correct)btn.classList.add('wrong');$('#answer-tip').textContent=correct?'回答正确！继续保持 ✨':'再想想，正确答案是 B。';$('#answer-tip').style.color=correct?'#58a879':'#df8065';$('#total-answered').textContent='129'});
$('#next-question').onclick=()=>{answered=false;$$('.options button').forEach(b=>b.classList.remove('selected','wrong'));$('#answer-tip').textContent='';toast('已进入下一题（演示题库）')};
