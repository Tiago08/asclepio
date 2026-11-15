// Ejecutar con servidor local en 8765 y Playwright disponible en NODE_PATH.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mock = `
const date = n => { const d = new Date(); d.setDate(d.getDate()-n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const profile = {id:'test-user',display_name:'Prueba',streak_current:3,streak_best:5,goal_kcal:2000,goal_protein_g:150,goal_carbs_g:200,goal_fat_g:65,goal_water_ml:2500};
window.db = {profiles:[profile],ranking_profiles:[profile], foods:[], food_logs:[], activity_logs:[0,1,2].map(n=>({id:'sleep-'+n,user_id:'test-user',type:'sueno',log_date:date(n),log_time:'07:00',data:{horaDormir:'23:00',horaDespertar:'07:00',calidad:4}})), daily_points:Array.from({length:1100},(_,i)=>({user_id:'test-user',log_date:date(i),points:1}))};
window.writes = [];
export const supabase = {
 auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'test-user',email:'test@example.com'}}}}),signOut:async()=>({}),signInWithOtp:async()=>({}),verifyOtp:async()=>({})},
 from(table){
  let filters=[], op='select', payload, single=false, order=[], from=0, to=Infinity;
  const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},gte(k,v){filters.push(r=>r[k]>=v);return q},lte(k,v){filters.push(r=>r[k]<=v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},or(){return q},order(k,o){order.push([k,o?.ascending!==false]);return q},limit(n){to=n-1;return q},range(a,b){from=a;to=b;return q},single(){single=true;return q},maybeSingle(){single=true;return q},insert(v){op='insert';payload=v;return q},update(v){op='update';payload=v;return q},upsert(v){op='upsert';payload=v;return q},delete(){op='delete';return q},then(resolve,reject){return Promise.resolve().then(()=>{
   const db=window.db; db[table] ||= [];
   if(window.failTable===table && op!=='select') return {data:null,error:{message:'Fallo simulado'}};
   let rows=db[table].filter(r=>filters.every(f=>f(r)));
   if(op==='insert'||op==='upsert') {rows=(Array.isArray(payload)?payload:[payload]).map(v=>({id:crypto.randomUUID(),...v}));if(op==='upsert') for(const r of rows) db[table]=db[table].filter(x=>!(x.user_id===r.user_id && (r.valid_from ? x.valid_from===r.valid_from : r.log_date ? x.log_date===r.log_date : true)));db[table].push(...rows);}
   if(op==='update') rows.forEach(r=>Object.assign(r,payload));
   if(op==='delete') db[table]=db[table].filter(r=>!rows.includes(r));
   if(op!=='select') window.writes.push({table,op,payload});
   rows=[...rows].sort((a,b)=>{for(const [k,asc] of order){if(a[k]!==b[k]) return (a[k]<b[k]?-1:1)*(asc?1:-1);}return 0;}).slice(from,to+1);
   return {data:single?(rows[0]||null):rows,error:null};
  }).then(resolve,reject)}};return q;
 }
};`;

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'es-VE'});
  const errors=[];
  page.on('pageerror',e=>{errors.push(e.message); console.error('Browser:',e.message)});
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text())});
  await page.route('**/*',async route=>{
   const url=route.request().url();
   if(url.includes('/js/supabaseClient.js')) return route.fulfill({contentType:'text/javascript',body:mock});
   if(url.includes('/js/app.js')) {
    const source=fs.readFileSync(path.join(__dirname,'../js/app.js'),'utf8');
    return route.fulfill({contentType:'text/javascript',body:source+'\nwindow.testApp={openQuantityStep,openQuickAddForm,openNewFoodForm,openActivityForm,openWaterForm,showPanel,renderSleep,foodDecimal};'});
   }
   if(!url.startsWith('http://127.0.0.1:8765')) return route.fulfill({contentType:url.includes('fonts')?'text/css':'text/javascript',body:''});
   return route.continue();
  });
  await page.goto('http://127.0.0.1:8765');
  await page.waitForFunction(()=>window.testApp && document.querySelector('#goalKcal').value==='2000').catch(async e=>{console.error(await page.locator('body').innerText());throw e;});
  const food={id:'food-1',name:'Alimento prueba',source:'custom',serving_label:'100 g',serving_grams:100,kcal:200,protein_g:10,carbs_g:20,fat_g:4};
  await page.evaluate(f=>window.testApp.openQuantityStep(f),food);
  await page.locator('#f_qty').fill('1');
  await page.locator('#f_qty').press('End');
  await page.locator('#f_qty').pressSequentially(',5');
  assert.equal(await page.locator('#f_qty').inputValue(),'1,5');
  assert.match(await page.locator('#qtyCalc').textContent(),/3 kcal/);
  await page.locator('#f_qty').fill('12.5');
  assert.match(await page.locator('#qtyCalc').textContent(),/25 kcal/);
  await page.locator('#f_qty').fill('12,5');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>window.db.food_logs.length===1);
  assert.equal(await page.evaluate(()=>window.db.food_logs[0].quantity),0.125);
  assert.equal(await page.evaluate(()=>window.db.food_logs[0].kcal),25);
  await page.evaluate(()=>window.testApp.openQuickAddForm());
  await page.locator('#qa_protein').fill('2,5');
  await page.locator('#qa_fat').fill('1.5');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>window.db.food_logs.length===2);
  assert.equal(await page.evaluate(()=>window.db.food_logs[1].kcal),24);
  assert.equal(await page.evaluate(()=>window.db.food_logs[1].protein_g),2.5);
  await page.evaluate(()=>window.testApp.openQuickAddForm());
  await page.locator('#qa_kcal').fill('1,2,3');
  await page.locator('#saveBtn').click();
  assert.equal(await page.evaluate(()=>window.db.food_logs.length),2);
  await page.evaluate(()=>window.testApp.openNewFoodForm());
  await page.locator('#nf_name').fill('Nuevo decimal');
  await page.locator('#nf_serving_g').fill('80,5');
  await page.locator('[data-nutri="kcal"]').fill('120,5');
  await page.locator('[data-nutri="protein_g"]').fill('3.2');
  await page.locator('details').filter({has:page.locator('[data-micro]')}).locator('summary').click();
  await page.locator('[data-micro="zinc_mg"]').fill('0,25');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>window.db.foods.length===1);
  assert.equal(await page.evaluate(()=>window.db.foods[0].micros.zinc_mg),0.25);
  assert.equal(await page.evaluate(()=>window.db.foods[0].serving_grams),80.5);
  await page.keyboard.press('Escape');
  await page.locator('button[data-tab="datos"]').click();
  // Primer uso: el cálculo se abre, con un solo paso visible.
  assert.equal(await page.locator('[data-objective-step]:visible').count(),1);
  await page.locator('#objectiveNext').click();
  assert.match(await page.locator('#objectiveProgress').textContent(),/Paso 1/);
  await page.locator('[data-sex="hombre"]').click();
  await page.locator('#bodyAge').fill('25');
  await page.locator('#bodyHeight').fill('175,5');
  await page.locator('#bodyWeight').fill('74,5');
  await page.locator('#objectiveNext').click();
  await page.locator('[data-pace="-0.25"]').click();
  await page.locator('#objectiveNext').click();
  assert.match(await page.locator('#objectiveProgress').textContent(),/Paso 3/);
  await page.locator('#saveObjectiveBtn').click();
  await page.waitForFunction(()=>document.querySelector('#goalStatus').textContent==='Cambios sin guardar');
  assert.equal(await page.evaluate(()=>window.db.profiles[0].goal_kcal),2000);
  await page.locator('#saveGoalsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#goalStatus').textContent==='Esta es tu meta actual');
  assert.equal(await page.evaluate(()=>window.db.goal_history.length),2);
  assert.equal(await page.evaluate(()=>window.db.goal_history[0].goal_kcal),2000);
  await page.locator('#goalKcal').fill('2345');
  await page.evaluate(()=>window.failTable='goal_history');
  await page.locator('#saveGoalsBtn').click();
  await page.waitForFunction(()=>!document.querySelector('#saveGoalsBtn').disabled);
  assert.match(await page.locator('#goalStatus').textContent(),/sin guardar/);
  await page.evaluate(()=>window.failTable=null);
  await page.locator('button[data-tab="sueno"]').click();
  await page.waitForSelector('.sleep-score');
  assert.match(await page.locator('.sleep-score').textContent(),/96/);
  await page.locator('[data-sleep-day]').last().click();
  assert.match(await page.locator('#sleepBarDetail').textContent(),/8 h/);
  await page.locator('[data-sleep-edit]').click();
  const times=page.locator('#formArea input[type="time"]');
  await times.nth(1).fill('07:00');
  await times.nth(2).fill('07:00');
  await page.locator('#saveBtn').click();
  assert.equal(await page.locator('#saveBtn').isVisible(),true);
  await times.nth(1).fill('23:30');
  await times.nth(2).fill('07:30');
  await page.locator('#formArea input[type="number"]').fill('30');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>window.db.activity_logs[0].data.despierto_min==='30');
  assert.equal(await page.evaluate(()=>window.db.activity_logs[0].data.duracion_h),7.5);
  await page.locator('button[data-tab="ranking"]').click();
  const ranking=await page.evaluate(async()=> (await import('/js/activity.js?v=24')).getRanking('2000-01-01'));
  assert.equal(ranking[0].points_total,1100);
  for(const tab of ['hoy','habitos','sueno','ranking','datos']){
   await page.locator('button[data-tab="'+tab+'"]').click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true,tab+' sin desbordamiento');
  }
  const metrics=await page.evaluate(async()=>{
   const m=await import('/js/sleep.js?v=24');
   return [m.sleepMetrics({horaDormir:'23:30',horaDespertar:'07:00',despierto_min:30}),m.sleepMetrics({horaDormir:'07:00',horaDespertar:'07:00'}),m.sleepScore([],420)];
  });
  assert.equal(metrics[0].dur,420);assert.equal(metrics[1].dur,null);assert.equal(metrics[2],null);
  const invalid=await page.evaluate(async()=> (await import('/js/health.js?v=24')).suggestGoals({sex:'hombre',height_cm:175,birth_year:2020,training_days:3},75));
  assert.equal(invalid,null);
  // Límites del cálculo y sueño cruzando medianoche, sin datos suficientes.
  const boundary=await page.evaluate(async()=>{
   const {suggestGoals}=await import('/js/health.js?v=24');
   const {sleepMetrics,sleepScore}=await import('/js/sleep.js?v=24');
   const s=suggestGoals({sex:'hombre',height_cm:175.5,birth_year:2001,training_days:0,pace_kg_week:-0.75},74.5,2026);
   return {floor:s.goals.goal_kcal>=10*74.5+6.25*175.5-5*25+5,
    awake:sleepMetrics({horaDormir:'23:00',horaDespertar:'07:00',despierto_min:480}).dur,
    short:sleepScore([{data:{horaDormir:'23:30',horaDespertar:'07:00',calidad:4}}],420)};
  });
  assert.equal(boundary.floor,true);assert.equal(boundary.awake,null);assert.equal(boundary.short,null);
  await page.evaluate(f=>window.testApp.openQuantityStep({...f,_units:[{label:'taza',grams:80.5}]}),food);
  await page.locator('#f_qty').fill('1,5');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>window.db.food_logs.length===3);
  assert.equal(await page.evaluate(()=>window.db.food_logs[2].quantity),1.2075);
  await page.evaluate(()=>window.testApp.openWaterForm());
  await page.locator('#formArea details summary').click();
  await page.locator('#w_ml').fill('330');
  await page.locator('#w_mg').fill('12,5');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>window.db.water_logs?.length===1);
  assert.equal(await page.evaluate(()=>window.db.water_logs[0].magnesium_mg),12.5);
  await page.keyboard.press('Escape');
  await page.locator('button[data-tab="datos"]').click();
  await page.locator('[data-del-weight]').first().click();
  await page.waitForFunction(()=>window.db.weight_logs.length===0);
  await page.locator('#toast button').click();
  await page.waitForFunction(()=>window.db.weight_logs.length===1);
  if(process.env.SCREENSHOT_DIR){
   await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'datos.png'),fullPage:true});
   await page.locator('#calcGoals summary').click();
   assert.equal(await page.locator('[data-objective-step]:visible').count(),1);
   await page.locator('#calcGoals').scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'calculadora.png')});
   await page.locator('button[data-tab="sueno"]').click();
   await page.waitForSelector('.sleep-score');
   await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'sueno.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('OK: decimales, nutrientes, validación, objetivos, historial, fallo de guardado, sueño, ranking paginado y 5 pestañas a 390x844; sin errores de consola.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
