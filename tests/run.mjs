import puppeteer from 'puppeteer-core';
import fs from 'fs';
const base='http://localhost:8051';
const out='/tmp/shots51/dash';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars']});
let fails=[];
const check=(name,ok,extra='')=>{console.log((ok?'PASS':'FAIL')+' '+name+(extra?' — '+extra:''));if(!ok)fails.push(name);};
for(const v of [{name:'desktop',w:1440,h:900},{name:'mobile',w:390,h:844}]){
 for(const theme of ['light','dark']){
  const page=await browser.newPage();
  await page.setViewport({width:v.w,height:v.h,deviceScaleFactor:1});
  const errs=[];page.on('pageerror',e=>errs.push(String(e)));page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await page.evaluateOnNewDocument(t=>localStorage.setItem('theme',t),theme);
  await page.goto(base,{waitUntil:'networkidle2'});
  await page.click('#btnSample');
  await page.waitForSelector('#mappingCard:not(.hidden)',{timeout:5000});
  await page.click('#btnBuild');
  await page.waitForSelector('#dashboard:not(.hidden)',{timeout:5000});
  await new Promise(s=>setTimeout(s,900));
  const kpis=await page.$$eval('#kpis .stat-value',els=>els.map(e=>e.textContent));
  check(`${v.name}/${theme} KPIs rendered`,kpis.length===4&&kpis.every(k=>k.includes('$')),JSON.stringify(kpis));
  const insightCount=await page.$$eval('#insightList .note-box',els=>els.length);
  check(`${v.name}/${theme} insights`,insightCount>=4,insightCount+' insights');
  const anoms=await page.$$eval('#anomalyList .limit-box',els=>els.length);
  check(`${v.name}/${theme} anomalies flagged`,anoms>=1,anoms+' anomalies');
  const txRows=await page.$$eval('#tblTx tbody tr',els=>els.length);
  check(`${v.name}/${theme} transaction rows`,txRows===15,txRows+' rows');
  const canvasPainted=await page.$$eval('canvas',cs=>cs.filter(c=>c.width>0).length);
  check(`${v.name}/${theme} 4 charts painted`,canvasPainted>=4,canvasPainted+' canvases');
  // what-if slider reacts
  const before=await page.$eval('#scSummary',e=>e.textContent);
  await page.$eval('#scRev',el=>{el.value=40;el.dispatchEvent(new Event('input'));});
  await new Promise(s=>setTimeout(s,300));
  const after=await page.$eval('#scSummary',e=>e.textContent);
  check(`${v.name}/${theme} what-if reacts`,before!==after);
  // category filter
  await page.select('#fltCategory','Rent');
  await new Promise(s=>setTimeout(s,300));
  const filtered=await page.$eval('#txCount',e=>e.textContent);
  check(`${v.name}/${theme} category filter`,filtered.startsWith('12 '),filtered);
  await page.select('#fltCategory','');
  await new Promise(s=>setTimeout(s,300));
  // screenshots
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`${out}/dash-top-${v.name}-${theme}.png`});
  await page.evaluate(()=>document.getElementById('insights').scrollIntoView());
  await new Promise(s=>setTimeout(s,300));
  await page.screenshot({path:`${out}/dash-insights-${v.name}-${theme}.png`});
  await page.evaluate(()=>document.getElementById('scenarios').scrollIntoView());
  await new Promise(s=>setTimeout(s,300));
  await page.screenshot({path:`${out}/dash-scenarios-${v.name}-${theme}.png`});
  check(`${v.name}/${theme} no console errors`,errs.length===0,errs.slice(0,3).join(' | '));
  await page.close();
 }
}
await browser.close();
if(fails.length){console.log('\nFAILURES: '+fails.join(', '));process.exit(1);}
console.log('\nALL PASS');
