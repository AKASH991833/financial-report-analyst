/* Financial Report Analyst - all in-browser */
(function(){
'use strict';
let RAW=[], TX=[], VIEW=[], charts={}, page=0, PAGE=15, mapping={};

/* ---------- sample data (seeded, deterministic) ---------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function sampleRows(){
  const rnd=mulberry32(42), rows=[['date','description','category','amount']];
  const cats={income:[['Sales - retail',3800,5200],['Sales - online',1500,2600],['Consulting',800,2200]],
    expense:[['Rent',1450,1450],['Salaries',2900,3100],['Inventory',900,2100],['Marketing',250,700],['Utilities',180,320],['Software',90,160]]};
  const now=new Date();
  for(let m=11;m>=0;m--){
    const d=new Date(now.getFullYear(),now.getMonth()-m,1);
    const mm=d.getMonth(), seasonal=1+0.25*Math.sin((mm/12)*Math.PI*2);
    cats.income.forEach(([name,lo,hi])=>{
      const n=2+Math.floor(rnd()*4);
      for(let i=0;i<n;i++){
        const day=1+Math.floor(rnd()*27);
        const amt=Math.round((lo+rnd()*(hi-lo))*seasonal);
        rows.push([fmtDate(new Date(d.getFullYear(),d.getMonth(),day)),name+' #'+Math.floor(1000+rnd()*9000),name.split(' -')[0],amt]);
      }});
    cats.expense.forEach(([name,lo,hi])=>{
      const n=name==='Rent'||name==='Salaries'?1:1+Math.floor(rnd()*3);
      for(let i=0;i<n;i++){
        const day=1+Math.floor(rnd()*27);
        const amt=Math.round(lo+rnd()*(hi-lo));
        rows.push([fmtDate(new Date(d.getFullYear(),d.getMonth(),day)),name+' payment',name,-amt]);
      }});
  }
  // two anomalies
  rows.push([fmtDate(new Date(now.getFullYear(),now.getMonth()-3,14)),'Equipment repair - urgent','Maintenance',-4800]);
  rows.push([fmtDate(new Date(now.getFullYear(),now.getMonth()-1,9)),'Bulk order - corporate client','Sales',9400]);
  return rows;
}
function fmtDate(d){return d.toISOString().slice(0,10);}

/* ---------- file intake ---------- */
const dz=document.getElementById('dropzone'), fi=document.getElementById('fileInput');
dz.addEventListener('click',()=>fi.click());
dz.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fi.click();}});
['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag');}));
dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)readFile(f);});
fi.addEventListener('change',()=>{if(fi.files[0])readFile(fi.files[0]);});
document.getElementById('btnSample').addEventListener('click',()=>{
  RAW=sampleRows(); autoMap(); toast('Sample business loaded - 12 months of transactions');
  document.getElementById('mappingCard').classList.remove('hidden');
  document.getElementById('mappingCard').scrollIntoView({behavior:'smooth',block:'center'});
});

function readFile(f){
  const name=f.name.toLowerCase();
  const done=rows=>{
    if(!rows||rows.length<2){toast('Could not read rows from that file');return;}
    RAW=rows; autoMap();
    document.getElementById('mappingCard').classList.remove('hidden');
    document.getElementById('mappingCard').scrollIntoView({behavior:'smooth',block:'center'});
    toast('Loaded '+f.name);
  };
  if(name.endsWith('.xlsx')||name.endsWith('.xls')){
    const r=new FileReader();
    r.onload=()=>{try{
      const wb=XLSX.read(r.result,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      done(XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''}));
    }catch(e){toast('Excel parse failed: '+e.message);}};
    r.readAsArrayBuffer(f);
  }else{
    const r=new FileReader();
    r.onload=()=>{let t=r.result; if(/\.tsv$/i.test(name))t=t.replace(/\t/g,','); done(parseCSV(t));};
    r.readAsText(f);
  }
}

/* ---------- column mapping ---------- */
function autoMap(){
  const head=RAW[0].map(h=>String(h).trim());
  const opts=(sel,allowNone)=>{sel.innerHTML=(allowNone?'<option value="">- none -</option>':'')+head.map((h,i)=>`<option value="${i}">${esc(h||'Column '+(i+1))}</option>`).join('');};
  const sD=document.getElementById('mapDate'),sT=document.getElementById('mapDesc'),sC=document.getElementById('mapCat'),sA=document.getElementById('mapAmount');
  opts(sD,false);opts(sT,false);opts(sC,true);opts(sA,false);
  const find=(re)=>head.findIndex(h=>re.test(h.toLowerCase()));
  sD.value=Math.max(0,find(/date|day|posted/));
  sT.value=Math.max(0,find(/desc|narrat|detail|particular|memo|name/));
  sC.value=find(/cat|type|group|head|ledger/);
  let ai=find(/amount|amt|value|total|sum/);
  if(ai<0)ai=find(/debit|credit|withdraw|deposit|paid|received/);
  sA.value=Math.max(0,ai);
  document.getElementById('mapSigned').checked=/amount|amt|value|total/.test(head[sA.value]?.toLowerCase()||'');
}
document.getElementById('btnBuild').addEventListener('click',()=>{
  const iD=+document.getElementById('mapDate').value, iT=+document.getElementById('mapDesc').value,
        iC=document.getElementById('mapCategory')?.value, iCat=document.getElementById('mapCat').value,
        iA=+document.getElementById('mapAmount').value, signed=document.getElementById('mapSigned').checked;
  mapping={iD,iT,iCat:iCat===''?-1:+iCat,iA,signed};
  TX=[];
  for(let r=1;r<RAW.length;r++){
    const row=RAW[r]; if(!row||row.length===0)continue;
    const d=parseDate(row[iD]); const amt=parseAmount(row[iA]);
    if(!d||amt==null)continue;
    TX.push({date:d,desc:String(row[iT]??'').trim()||'(no description)',cat:iCat===''? 'Uncategorized':(String(row[iCat]??'').trim()||'Uncategorized'),amt:signed?amt:amt});
  }
  if(TX.length<2){toast('Only '+TX.length+' usable rows found - check the column mapping');return;}
  TX.sort((a,b)=>a.date-b.date);
  buildDashboard();
});

function parseDate(v){
  if(v==null||v==='')return null;
  if(typeof v==='number'&&v>20000&&v<60000)return new Date(Math.round((v-25569)*86400000));
  const s=String(v).trim();
  let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if(m)return new Date(+m[1],+m[2]-1,+m[3]);
  m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if(m){let a=+m[1],b=+m[2]; if(a>12)return new Date(+m[3],b-1,a); if(b>12)return new Date(+m[3],a-1,b); return new Date(+m[3],b-1,a);}
  const t=Date.parse(s); if(!isNaN(t))return new Date(t);
  return null;
}
function parseAmount(v){
  if(v==null||v==='')return null;
  if(typeof v==='number')return v;
  let s=String(v).replace(/[₹$€£,\s]/g,'');
  let neg=false;
  if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1);}
  const n=parseFloat(s);
  if(isNaN(n))return null;
  return neg?-n:n;
}

/* ---------- dashboard ---------- */
const IN='income';
function monthKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
function monthLabel(k){const[y,m]=k.split('-');return new Date(+y,+m-1,1).toLocaleString('en-US',{month:'short',year:'2-digit'});}

function currentFilters(){return {period:document.getElementById('fltPeriod').value,cat:document.getElementById('fltCategory').value,q:document.getElementById('fltSearch').value.trim().toLowerCase()};}
function buildDashboard(){
  const cats=[...new Set(TX.map(t=>t.cat))].sort((a,b)=>a.localeCompare(b));
  document.getElementById('fltCategory').innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option>${c}</option>`).join('');
  applyFilters();
  document.getElementById('dashboard').scrollIntoView({behavior:'smooth',block:'start'});
}

function applyFilters(){
  const f=currentFilters();let arr=TX.slice();
  if(f.period!=='all'&&TX.length){
    const maxD=TX[TX.length-1].date;
    const cut=new Date(maxD.getFullYear(),maxD.getMonth()-(+f.period.replace('m',''))+1,1);
    arr=arr.filter(t=>t.date>=cut);
  }
  if(f.cat)arr=arr.filter(t=>t.cat===f.cat);
  if(f.q)arr=arr.filter(t=>t.desc.toLowerCase().includes(f.q));
  VIEW=arr; page=0; render();
}

function aggMonths(arr){
  const map=new Map();
  arr.forEach(t=>{const k=monthKey(t.date);if(!map.has(k))map.set(k,{inc:0,exp:0});const o=map.get(k);if(t.amt>=0)o.inc+=t.amt;else o.exp+=-t.amt;});
  return [...map.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(([k,v])=>({k,label:monthLabel(k),...v,net:v.inc-v.exp}));
}
function aggCats(arr,sign){
  const map=new Map();
  arr.forEach(t=>{if((sign>0&&t.amt>=0)||(sign<0&&t.amt<0))map.set(t.cat,(map.get(t.cat)||0)+Math.abs(t.amt));});
  return [...map.entries()].sort((a,b)=>b[1]-a[1]);
}
function css(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}

function render(){
  document.getElementById('dashboard').classList.remove('hidden');
  const arr=VIEW;
  const inc=arr.filter(t=>t.amt>=0).reduce((s,t)=>s+t.amt,0);
  const exp=arr.filter(t=>t.amt<0).reduce((s,t)=>s-t.amt,0);
  const net=inc-exp, margin=inc>0?net/inc:0;
  const months=aggMonths(arr);
  const avgNet=months.length?months.reduce((s,m)=>s+m.net,0)/months.length:0;
  const last=months[months.length-1], prev=months[months.length-2];
  const mom=last&&prev&&prev.net!==0?(last.net-prev.net)/Math.abs(prev.net):null;

  const kpis=[
    {label:'Revenue',value:fmtMoney(inc),delta:months.length?months.length+' months':'',cls:'var(--ok)'},
    {label:'Expenses',value:fmtMoney(exp),delta:'',cls:'var(--bad)'},
    {label:'Net profit',value:fmtMoney(net),delta:mom!=null?((mom>=0?'+':'')+(mom*100).toFixed(1)+'% vs prev month'):'',cls:net>=0?'var(--ok)':'var(--bad)'},
    {label:'Avg monthly net',value:fmtMoney(avgNet),delta:'margin '+(margin*100).toFixed(1)+'%',cls:'var(--accent)'}
  ];
  document.getElementById('kpis').innerHTML=kpis.map(k=>`<div class="card stat rise"><div class="stat-label">${k.label}</div><div class="stat-value" style="color:${k.cls}">${k.value}</div>${k.delta?`<div class="stat-delta muted">${k.delta}</div>`:''}</div>`).join('');

  const cats=aggCats(arr,-1), catsIn=aggCats(arr,1);
  document.getElementById('reportTitle').textContent='Your financial report';
  document.getElementById('reportMeta').textContent=arr.length+' transactions · '+(arr.length?arr[0].date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' – '+arr[arr.length-1].date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'');
  const catSel=document.getElementById('fltCategory');
  if(catSel.options.length<=1){[...new Set(TX.map(t=>t.cat))].sort().forEach(c=>{const o=document.createElement('option');o.value=o.textContent=c;catSel.appendChild(o);});}

  drawMonthly(months); drawCats(cats); drawCum(months); drawTop(catsIn,cats); renderInsights(arr,months,cats); renderAnomalies(arr); renderTable(); scenario();
}

const PALETTE=['#4f46e5','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b'];
function killChart(id){if(charts[id]){charts[id].destroy();delete charts[id];}}
function baseOpts(){return{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:css('--ink-2'),font:{family:'Inter',weight:'600'},boxWidth:12,padding:16}}},scales:{x:{ticks:{color:css('--muted')},grid:{color:css('--border')}},y:{ticks:{color:css('--muted'),callback:v=>'$'+(Math.abs(v)>=1000?(v/1000)+'k':v)},grid:{color:css('--border')}}}};}
function drawMonthly(months){
  killChart('m');const c=document.getElementById('chMonthly');if(!months.length){c.closest('.card').classList.add('hidden');return;}c.closest('.card').classList.remove('hidden');
  charts.m=new Chart(c,{data:{labels:months.map(m=>m.label),datasets:[
    {type:'bar',label:'Revenue',data:months.map(m=>Math.round(m.inc)),backgroundColor:css('--accent'),borderRadius:6,maxBarThickness:26},
    {type:'bar',label:'Expenses',data:months.map(m=>Math.round(m.exp)),backgroundColor:'#f3b0b7',borderRadius:6,maxBarThickness:26},
    {type:'line',label:'Net',data:months.map(m=>Math.round(m.net)),borderColor:'#0e9f6e',backgroundColor:'#0e9f6e',tension:.35,pointRadius:3}]},options:baseOpts()});
}
function drawCats(cats){
  killChart('c');const top=cats.slice(0,8);const other=cats.slice(8).reduce((s,c)=>s+c[1],0);
  const labels=top.map(c=>c[0]).concat(other>0?['Other']:[]),data=top.map(c=>Math.round(c[1])).concat(other>0?[Math.round(other)]:[]);
  charts.c=new Chart(document.getElementById('chCat'),{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:PALETTE,borderWidth:2,borderColor:css('--surface')}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{position:'right',labels:{color:css('--ink-2'),boxWidth:12,padding:10,font:{size:11}}}}}});
}
function drawCum(months){
  killChart('u');let run=0;const data=months.map(m=>Math.round(run+=m.net));
  charts.u=new Chart(document.getElementById('chCum'),{type:'line',data:{labels:months.map(m=>m.label),datasets:[{label:'Cumulative net',data,borderColor:css('--accent'),backgroundColor:css('--accent-soft'),fill:true,tension:.35,pointRadius:3}]},options:baseOpts()});
}
function drawTop(catsIn,cats){
  const rows=[];
  catsIn.slice(0,3).forEach(c=>rows.push({n:c[0],v:c[1],t:'income'}));
  cats.slice(0,5).forEach(c=>rows.push({n:c[0],v:c[1],t:'expense'}));
  document.getElementById('tblTop').innerHTML='<thead><tr><th>Category</th><th>Type</th><th class="num">Total</th><th class="num">Share</th></tr></thead><tbody>'+
    rows.map(r=>{const base=r.t==='income'?catsIn.reduce((s,c)=>s+c[1],0):cats.reduce((s,c)=>s+c[1],0);
      return `<tr><td>${esc(r.n)}</td><td><span class="chip ${r.t==='income'?'chip-ok':'chip-bad'}">${r.t}</span></td><td class="num mono">${fmtMoney(r.v)}</td><td class="num mono">${base?((r.v/base)*100).toFixed(1)+'%':'-'}</td></tr>`;}).join('')+'</tbody>';
}

function renderInsights(arr,months,cats){
  const out=[];const inc=arr.filter(t=>t.amt>=0).reduce((s,t)=>s+t.amt,0),exp=arr.filter(t=>t.amt<0).reduce((s,t)=>s-t.amt,0);
  if(months.length>=2){
    const best=[...months].sort((a,b)=>b.net-a.net)[0],worst=[...months].sort((a,b)=>a.net-b.net)[0];
    out.push({h:'Best and worst months',b:`<b>${best.label}</b> was your strongest month (net ${fmtMoney(best.net)}). <b>${worst.label}</b> was the weakest (net ${fmtMoney(worst.net)}).`});
    const xs=months.map((m,i)=>i),ys=months.map(m=>m.net);
    const n=xs.length,xm=xs.reduce((a,b)=>a+b,0)/n,ym=ys.reduce((a,b)=>a+b,0)/n;
    const slope=xs.reduce((s,x,i)=>s+(x-xm)*(ys[i]-ym),0)/xs.reduce((s,x)=>s+(x-xm)**2,0);
    out.push({h:'Profit trend',b:slope>0?`Net profit is trending <b>up by about ${fmtMoney(Math.abs(slope))} per month</b> on average - the business is improving.`:`Net profit is trending <b>down by about ${fmtMoney(Math.abs(slope))} per month</b> on average - worth investigating.`});
    const grow=months.filter((m,i)=>i>0&&months[i-1].inc>0).map((m,i)=>(m.inc-months[i].inc)/months[i].inc);
    if(grow.length){const g=grow.reduce((a,b)=>a+b,0)/grow.length;out.push({h:'Revenue growth',b:`Average month-over-month revenue growth is <b>${(g*100).toFixed(1)}%</b>.`});}
  }
  const totExp=cats.reduce((s,c)=>s+c[1],0);
  if(cats.length&&totExp>0){
    const[topCat,topVal]=cats[0];const share=topVal/totExp;
    out.push({h:'Biggest cost',b:`<b>${esc(topCat)}</b> is your largest expense at ${fmtMoney(topVal)} (${(share*100).toFixed(1)}% of all spending).`+(share>0.5?' That is a high concentration - a single price change here moves the whole P&L.':'')});
  }
  const margin=inc>0?(inc-exp)/inc:0;
  out.push({h:'Margin read',b:margin>=0.25?`A ${(margin*100).toFixed(1)}% margin is healthy - you keep a solid share of every dollar earned.`:margin>=0?`A ${(margin*100).toFixed(1)}% margin leaves little buffer - small cost increases could push you into loss.`:`You are spending more than you earn (margin ${(margin*100).toFixed(1)}%) - cutting the top expense categories matters most.`});
  const expTx=arr.filter(t=>t.amt<0).sort((a,b)=>a.amt-b.amt)[0];
  if(expTx)out.push({h:'Largest single expense',b:`“${esc(expTx.desc)}” on ${expTx.date.toLocaleDateString()} for ${fmtMoney(-expTx.amt)}.`});
  const anoms=findAnomalies(arr);
  if(anoms.length)out.push({h:'Outliers',b:`${anoms.length} transaction${anoms.length>1?'s':''} sit outside their category's normal range - see the panel on the right.`});
  document.getElementById('insightList').innerHTML=out.map(o=>`<div class="note-box"><b>${o.h}.</b> ${o.b}</div>`).join('')||'<p class="muted">Not enough data yet.</p>';
}
function findAnomalies(arr){
  const byCat={};arr.forEach(t=>{(byCat[t.cat]=byCat[t.cat]||[]).push(t);});
  const res=[];
  Object.values(byCat).forEach(list=>{
    if(list.length<6)return;
    const vals=list.map(t=>Math.abs(t.amt));
    const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
    const sd=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length)||1;
    list.forEach(t=>{const z=(Math.abs(t.amt)-mean)/sd;if(z>2.5)res.push({...t,z});});
  });
  return res.sort((a,b)=>b.z-a.z);
}
function renderAnomalies(arr){
  const an=findAnomalies(arr);
  document.getElementById('anomalyList').innerHTML=an.length?an.slice(0,8).map(a=>`<div class="limit-box" style="border-left-color:var(--bad)"><b>${esc(a.desc)}</b><br><span class="small">${a.date.toLocaleDateString()} · ${esc(a.cat)} · <b class="mono">${fmtMoney(Math.abs(a.amt))}</b> (${a.z.toFixed(1)}× typical)</span></div>`).join(''):'<p class="muted">No statistical outliers found in this view.</p>';
}

/* ---------- table ---------- */
function renderTable(){
  const total=VIEW.length,pages=Math.max(1,Math.ceil(total/PAGE));
  page=Math.min(page,pages-1);
  const rows=VIEW.slice(page*PAGE,(page+1)*PAGE);
  document.getElementById('tblTx').innerHTML='<thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>'+
    rows.map(t=>`<tr><td class="mono" style="white-space:nowrap">${fmtDate(t.date)}</td><td>${esc(t.desc)}</td><td><span class="chip">${esc(t.cat)}</span></td><td class="num mono" style="color:${t.amt>=0?'var(--ok)':'var(--bad)'}">${t.amt>=0?'+':''}${fmtMoney(t.amt)}</td></tr>`).join('')+'</tbody>';
  document.getElementById('txCount').textContent=total+' transactions in view';
  document.getElementById('pgInfo').textContent=`Page ${page+1} of ${pages}`;
}
document.getElementById('pgPrev').addEventListener('click',()=>{if(page>0){page--;renderTable();}});
document.getElementById('pgNext').addEventListener('click',()=>{if((page+1)*PAGE<VIEW.length){page++;renderTable();}});
['fltPeriod','fltCategory'].forEach(id=>document.getElementById(id).addEventListener('change',applyFilters));
document.getElementById('fltSearch').addEventListener('input',debounce(applyFilters,250));
document.getElementById('btnReset').addEventListener('click',()=>location.reload());

/* ---------- what-if ---------- */
function scenario(){
  if(!VIEW.length)return;
  const months=aggMonths(VIEW);
  const avgInc=months.reduce((s,m)=>s+m.inc,0)/months.length, avgExp=months.reduce((s,m)=>s+m.exp,0)/months.length;
  const r=+document.getElementById('scRev').value/100, e=+document.getElementById('scExp').value/100, mo=+document.getElementById('scMo').value;
  document.getElementById('lblRev').textContent=(r>=0?'+':'')+Math.round(r*100)+'%';
  document.getElementById('lblExp').textContent=(e>=0?'+':'')+Math.round(e*100)+'%';
  document.getElementById('lblMo').textContent=mo;
  const pInc=avgInc*(1+r),pExp=avgExp*(1+e),pNet=pInc-pExp;
  document.getElementById('scSummary').innerHTML=[
    ['Projected revenue / mo',fmtMoney(pInc),'var(--ok)'],['Projected expenses / mo',fmtMoney(pExp),'var(--bad)'],['Projected net / mo',fmtMoney(pNet),pNet>=0?'var(--ok)':'var(--bad)'],['Net over '+mo+' months',fmtMoney(pNet*mo),pNet>=0?'var(--ok)':'var(--bad)']
  ].map(([l,v,c])=>`<div class="card stat" style="flex:1;min-width:170px"><div class="stat-label">${l}</div><div class="stat-value" style="color:${c};font-size:1.35rem">${v}</div></div>`).join('');
  killChart('s');
  let run=0;const labels=[],data=[];const lastK=months.length?months[months.length-1].k:'';
  let base=lastK?new Date(+lastK.split('-')[0],+lastK.split('-')[1]-1,1):new Date();
  for(let i=1;i<=mo;i++){const d=new Date(base.getFullYear(),base.getMonth()+i,1);labels.push(d.toLocaleString('en-US',{month:'short',year:'2-digit'}));data.push(Math.round(run+=pNet));}
  charts.s=new Chart(document.getElementById('chSc'),{type:'line',data:{labels,datasets:[{label:'Projected cumulative net',data,borderColor:'#0e9f6e',backgroundColor:'rgba(14,159,110,.12)',fill:true,tension:.3,pointRadius:3}]},options:baseOpts()});
}
['scRev','scExp','scMo'].forEach(id=>document.getElementById(id).addEventListener('input',debounce(scenario,60)));

/* ---------- exports ---------- */
document.getElementById('btnCSV').addEventListener('click',()=>download('filtered-transactions.csv',toCSV([['date','description','category','amount'],...VIEW.map(t=>[fmtDate(t.date),t.desc,t.cat,t.amt])]),'text/csv'));
document.getElementById('btnReport').addEventListener('click',()=>{
  const inc=VIEW.filter(t=>t.amt>=0).reduce((s,t)=>s+t.amt,0),exp=VIEW.filter(t=>t.amt<0).reduce((s,t)=>s-t.amt,0);
  const ins=[...document.querySelectorAll('#insightList .note-box')].map(n=>'- '+n.textContent.trim()).join('\n');
  download('financial-report.md',`# Financial Report\nGenerated ${new Date().toLocaleString()} · ${VIEW.length} transactions\n\n## Summary\n- Revenue: ${fmtMoney(inc)}\n- Expenses: ${fmtMoney(exp)}\n- Net: ${fmtMoney(inc-exp)}\n- Margin: ${inc?((inc-exp)/inc*100).toFixed(1):'0'}%\n\n## Insights\n${ins}\n\n_Report generated locally by Financial Report Analyst - rule-based, not professional advice._`,'text/markdown');
});
document.getElementById('btnPrint').addEventListener('click',()=>window.print());
window._test={sampleRows,parseDate,parseAmount,aggMonths,findAnomalies,setData:rows=>{RAW=rows;},build:()=>document.getElementById('btnBuild').click(),autoMap};
})();
