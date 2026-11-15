// Ejecutar con servidor local en 8765 y Playwright disponible en NODE_PATH.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mock = `
const date = n => { const d = new Date(); d.setDate(d.getDate()-n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const profile = {id:'test-user',display_name:'Prueba',streak_current:3,streak_best:5,goal_kcal:2000,goal_protein_g:150,goal_carbs_g:200,goal_fat_g:65,goal_water_ml:2500};
window.db = {profiles:[profile],ranking_profiles:[profile], foods:[], food_logs:[], activity_logs:[0,1,2].map(n=>({id:'sleep-'+n,user_id:'test-user',type:'sueno',log_date:date(n),log_time:'07:00',data:{horaDormir:'23:00',horaDespertar:'07:00',calidad:4}})), daily_points:Array.from({length:1100},(_,i)=>({user_id:'test-user',log_date:date(i),points:1}))};
window.writes = []; window.reads = [];
export const supabase = {
 auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'test-user',email:'test@example.com'}}}}),signOut:async()=>({}),signInWithOtp:async()=>({}),verifyOtp:async()=>({})},
 from(table){
  let filters=[], op='select', payload, single=false, order=[], from=0, to=Infinity;
  const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},gte(k,v){filters.push(r=>r[k]>=v);return q},lte(k,v){filters.push(r=>r[k]<=v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},or(){return q},order(k,o){order.push([k,o?.ascending!==false]);return q},limit(n){to=n-1;return q},range(a,b){from=a;to=b;return q},single(){single=true;return q},maybeSingle(){single=true;return q},insert(v){op='insert';payload=v;return q},update(v){op='update';payload=v;return q},upsert(v){op='upsert';payload=v;return q},delete(){op='delete';return q},then(resolve,reject){return Promise.resolve().then(()=>{
   const db=window.db; db[table] ||= [];
   if(op==='select')window.reads.push(table);
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
    return route.fulfill({contentType:'text/javascript',body:source+'\nwindow.testApp={openQuantityStep,openQuickAddForm,openNewFoodForm,openActivityForm,openWaterForm,showPanel,renderSleep,renderRings,renderInsight,refreshAfterLog,foodDecimal};'});
   }
   if(!url.startsWith('http://127.0.0.1:8765')) return route.fulfill({contentType:url.includes('fonts')?'text/css':'text/javascript',body:''});
   return route.continue();
  });
  await page.goto('http://127.0.0.1:8765');
  await page.waitForFunction(()=>window.testApp && document.querySelector('#goalKcal').value==='2000').catch(async e=>{console.error(await page.locator('body').innerText());throw e;});
  await page.waitForFunction(()=>document.querySelector('#todayTimeline .spinner')===null && window.reads.includes('activity_logs'));
  assert.equal(await page.evaluate(()=>window.reads.filter(t=>t==='activity_logs').length),1,'Hoy y estadísticas comparten lectura');
  assert.equal(await page.evaluate(()=>window.reads.filter(t=>t==='daily_points').length),0,'Ranking no se carga al arrancar');
  assert.equal(await page.evaluate(()=>window.reads.filter(t=>t==='profiles').length),1,'Una sola lectura de perfil existente');
  console.log('Arranque: 1 lectura de actividades para Hoy + estadísticas; 0 lecturas de puntos.');
  assert.match(await page.locator('.kh-remaining').textContent(),/2[.\s]?000kcal restantes/);
  assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-tab'),'hoy');
  assert.equal(await page.locator('#logoutBtn').isVisible(),false,'Cerrar sesión pertenece a Datos');
  for(const selector of ['#dayPrev','.meal-add']){
   const box=await page.locator(selector).first().boundingBox();
   assert.ok(box.width>=44 && box.height>=44,selector+' admite un toque de 44 px');
  }
  if(process.env.SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'hoy.png'),fullPage:true});
  await page.evaluate(()=>window.testApp.renderRings([{data:{kcal:2400,protein_g:160,carbs_g:200,fat_g:70}}]));
  assert.match(await page.locator('.kh-remaining').textContent(),/400sobre la meta/);
  assert.equal(await page.getByRole('meter').getAttribute('aria-valuenow'),'2000');
  assert.match(await page.locator('.macro-remaining').nth(1).textContent(),/10 g sobre la meta/);
  await page.evaluate(()=>window.testApp.renderRings([]));
  const patterns=await page.evaluate(async()=>{
   const day=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
   const entries=[];
   for(let i=0;i<6;i++){
    entries.push({date:day(i),type:'gym',data:{fue:i<3}});
    entries.push({date:day(i),type:'energia',data:{nivel:i===0?5:1}});
   }
   for(let i=0;i<3;i++)entries.push({date:day(0),type:'energia',data:{nivel:5}});
   await window.testApp.renderInsight(entries);
   const paired=document.querySelector('#insightArea').textContent;
   await window.testApp.renderInsight(entries.filter(e=>e.type!=='gym'||e.data.fue));
   const unknown=document.querySelector('#insightArea').textContent;
   await window.testApp.renderInsight(entries.filter(e=>e.type!=='energia'||e.date===day(0)||e.date===day(3)));
   const insufficient=document.querySelector('#insightArea').textContent;
   await window.testApp.renderInsight(entries.map(e=>({...e,date:day(-1)})));
   return {paired,unknown,insufficient,future:document.querySelector('#insightArea').textContent};
  });
  assert.match(patterns.paired,/2.3\/5/,'Promedio por día, no por número de registros');
  assert.match(patterns.paired,/3 días de gym · 3 de descanso/);
  assert.equal(patterns.unknown,'','No registrar gym no equivale a descanso');
  assert.equal(patterns.insufficient,'','La muestra mínima requiere días con ambas mediciones');
  assert.equal(patterns.future,'','No se usan datos posteriores al día seleccionado');
  await page.locator('#dayPrev').click();
  await page.waitForFunction(()=>document.querySelector('.kh-label').textContent==='Balance del día');
  await page.locator('#dayNext').click();
  await page.waitForFunction(()=>document.querySelector('.kh-label').textContent==='Tu balance de hoy');
  const breakfastAdd=page.getByRole('button',{name:'Agregar a Desayuno',exact:true});
  await breakfastAdd.tap();
  await page.waitForSelector('#sheet:not(.hidden)');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sheet.hidden',{state:'attached'});
  assert.equal(await breakfastAdd.evaluate(el=>el===document.activeElement),true,'Cerrar devuelve el foco al disparador');
  const food={id:'food-1',name:'Alimento prueba',source:'custom',serving_label:'100 g',serving_grams:100,kcal:200,protein_g:10,carbs_g:20,fat_g:4};
  await page.evaluate(f=>window.testApp.openQuantityStep(f),food);
  assert.equal(await page.locator('#appShell').evaluate(el=>el.inert),true);
  await page.locator('#sheetGrip').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#sheet').evaluate(el=>el.contains(document.activeElement)),true);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#sheetGrip').evaluate(el=>el===document.activeElement),true);
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
  assert.equal(await page.locator('#appShell').evaluate(el=>el.inert),false);
  assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-tab'),'datos');
  assert.equal(await page.locator('#logoutBtn').isVisible(),true);
  // Primer uso: el cálculo se abre, con un solo paso visible.
  assert.equal(await page.locator('[data-objective-step]:visible').count(),1);
  assert.equal(await page.locator('#goalKcal').isVisible(),false);
  assert.match(await page.locator('#goalOverview').textContent(),/2.000/);
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
  assert.equal(await page.locator('#goalKcal').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.db.goal_history.length),2);
  assert.equal(await page.evaluate(()=>window.db.goal_history[0].goal_kcal),2000);
  await page.locator('#goalEditor summary').click();
  await page.locator('#goalKcal').fill('2345');
  await page.evaluate(()=>window.failTable='goal_history');
  await page.locator('#saveGoalsBtn').click();
  await page.waitForFunction(()=>!document.querySelector('#saveGoalsBtn').disabled);
  assert.match(await page.locator('#goalStatus').textContent(),/sin guardar/);
  await page.evaluate(()=>window.failTable=null);
  await page.locator('#cancelGoalEdit').click();
  assert.equal(await page.locator('#goalKcal').isVisible(),false);
  assert.equal(await page.locator('#goalStatus').textContent(),'Esta es tu meta actual');
  await page.locator('button[data-tab="sueno"]').click();
  await page.waitForSelector('.sleep-score');
  assert.match(await page.locator('.sleep-score').textContent(),/96/);
  await page.locator('[data-sleep-day]').last().click();
  assert.match(await page.locator('#sleepBarDetail').textContent(),/8 h/);
  assert.match(await page.locator('.night-score').textContent(),/100/);
  assert.equal(await page.locator('.night-score').getAttribute('aria-valuenow'),'96');
  assert.equal(await page.locator('.night-score svg circle').count(),2);
  await page.getByLabel('Objetivo de sueño').selectOption('9');
  assert.equal(await page.locator('.night-score').getAttribute('aria-valuenow'),'89');
  assert.match(await page.locator('.night-score').textContent(),/89/);
  await page.getByLabel('Objetivo de sueño').selectOption('8');
  assert.match(await page.locator('.sleep-model').textContent(),/0\/40/);
  await page.locator('[data-sleep-edit]').click();
  const times=page.locator('#formArea input[type="time"]');
  await times.nth(1).fill('07:00');
  await times.nth(2).fill('07:00');
  await page.locator('#saveBtn').click();
  assert.equal(await page.locator('#saveBtn').isVisible(),true);
  await times.nth(1).fill('23:30');
  await times.nth(2).fill('07:30');
  await page.locator('#formArea input[type="number"]').first().fill('30');
  await page.locator('.sleep-journal > summary').click();
  await page.locator('#journal_descanso').fill('6');
  await page.locator('#saveBtn').click();
  assert.equal(await page.locator('#saveBtn').isVisible(),true);
  await page.locator('#journal_descanso').fill('4');
  await page.locator('#journal_estres').fill('2');
  await page.locator('.journal-settings summary').click();
  await page.locator('[data-track="ruido"]').check();
  await page.locator('.journal-settings summary').click();
  await page.locator('#journal_ruido').selectOption('1');
  if(process.env.SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'diario.png')});
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>window.db.activity_logs[0].data.despierto_min==='30');
  assert.equal(await page.evaluate(()=>window.db.activity_logs[0].data.descanso),'4');
  assert.equal(await page.evaluate(()=>window.db.activity_logs[0].data.alcohol),undefined);
  assert.equal(await page.evaluate(()=>window.db.activity_logs[0].data.ruido),'1');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('asclepio_sleep_test-user')).fields.includes('ruido')),true);
  assert.equal(await page.evaluate(()=>window.db.activity_logs[0].data.duracion_h),7.5);
  await page.locator('button[data-tab="ranking"]').click();
  const ranking=await page.evaluate(async()=> (await import('/js/activity.js?v=30')).getRanking('2000-01-01'));
  assert.equal(ranking[0].points_total,1100);
  const pointReads=await page.evaluate(()=>window.reads.filter(t=>t==='daily_points').length);
  await page.locator('[data-rank-mode="total"]').click();
  assert.equal(await page.evaluate(()=>window.reads.filter(t=>t==='daily_points').length),pointReads,'Cambiar modo reutiliza puntos');
  for(const tab of ['hoy','habitos','sueno','ranking','datos']){
   await page.locator('button[data-tab="'+tab+'"]').click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true,tab+' sin desbordamiento');
  }
  const metrics=await page.evaluate(async()=>{
   const m=await import('/js/sleep.js?v=30');
   return [m.sleepMetrics({horaDormir:'23:30',horaDespertar:'07:00',despierto_min:30}),m.sleepMetrics({horaDormir:'07:00',horaDespertar:'07:00'}),m.sleepScore([],420)];
  });
  assert.equal(metrics[0].dur,420);assert.equal(metrics[1].dur,null);assert.equal(metrics[2],null);
  const invalid=await page.evaluate(async()=> (await import('/js/health.js?v=30')).suggestGoals({sex:'hombre',height_cm:175,birth_year:2020,training_days:3},75));
  assert.equal(invalid,null);
  // Límites del cálculo y sueño cruzando medianoche, sin datos suficientes.
  const boundary=await page.evaluate(async()=>{
   const {suggestGoals}=await import('/js/health.js?v=30');
   const {sleepMetrics,sleepScore}=await import('/js/sleep.js?v=30');
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
  const account=page.locator('.account-editor').first();
  assert.equal(await page.locator('#displayNameInput').isVisible(),false);
  await account.locator('summary').click();
  await page.getByLabel('Nombre', {exact:true}).fill('Santiago UX');
  await page.locator('#saveNameBtn').click();
  await page.waitForFunction(()=>document.querySelector('#accountSummary').textContent==='Santiago UX');
  assert.equal(await page.locator('#displayNameInput').isVisible(),false);
  await page.locator('.account-editor').last().locator('summary').click();
  await page.getByLabel('Período del reporte').selectOption('week');
  assert.equal(await page.locator('#reportBtn').isVisible(),true);
  await page.locator('.account-editor').last().locator('summary').click();
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
  const nutrientChecks=await page.evaluate(async()=>{
   const {microTotals,microStatus,microTargets}=await import('/js/micros.js?v=30');
   const {usdaFoodToRow}=await import('/js/foods.js?v=30');
   const a=microTotals([{iron_mg:0,micros:{zinc_mg:1}},{iron_mg:null,micros:{zinc_mg:''}}]);
   const target=microTargets('mujer',30,2000).find(t=>t.key==='iron_mg');
   const converted=usdaFoodToRow({fdcId:1,description:'Test',foodNutrients:[
    {nutrientNumber:'304',value:.1,unitName:'G'},
    {nutrientNumber:'328',value:5,unitName:'µg'},
    {nutrientNumber:'320',value:100,unitName:'IU'},
    {nutrientNumber:'417',value:200,unitName:'UG'},
    {nutrientNumber:'629',value:.2,unitName:'G'}]});
   return {coverage:a.coverage,zero:a.totals.iron_mg,partial:microStatus(target,0,true,false),
    sugar:microTargets('mujer',30,2000).find(t=>t.key==='sugars_g'),
    vitaminD:microTargets('hombre',75,2000).find(t=>t.key==='vit_d_mcg'),converted};
  });
  assert.deepEqual(nutrientChecks.coverage.iron_mg,{known:1,total:2});
  assert.deepEqual(nutrientChecks.coverage.zinc_mg,{known:1,total:2});
  assert.equal(nutrientChecks.zero,0);assert.equal(nutrientChecks.partial,'partial');
  assert.equal(nutrientChecks.sugar.max,null);assert.equal(nutrientChecks.vitaminD.goal,20);
  assert.equal(nutrientChecks.converted.micros.magnesium_mg,100);
  assert.equal(nutrientChecks.converted.vit_d_mcg,5);
  assert.equal(nutrientChecks.converted.vit_a_mcg,null);
  assert.equal(nutrientChecks.converted.micros.folate_mcg,undefined);
  assert.equal(nutrientChecks.converted.micros.omega3_mg,undefined);
  await page.locator('button[data-tab="hoy"]').click();
  await page.locator('#smartDiary > summary').click();
  assert.ok(await page.locator('[data-smart-food]').count()>0);
  const firstSuggestion=await page.locator('[data-smart-food]').first().textContent();
  await page.locator('[data-smart-hide]').first().click();
  assert.equal(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('asclepio_learning_test-user')).rejections)[0].reason),'dislike');
  assert.notEqual(await page.locator('[data-smart-food]').first().textContent(),firstSuggestion);
  await page.locator('#smartFoodArea details summary').click();
  await page.locator('[data-restore-preference]').first().click();
  assert.equal(await page.locator('[data-smart-food]').first().textContent(),firstSuggestion);
  await page.locator('[data-smart-hide]').first().click();
  await page.locator('#smartFoodArea details summary').click();
  await page.locator('#resetHiddenFoods').click();
  assert.equal(await page.locator('[data-smart-food]').first().textContent(),firstSuggestion);
  await page.locator('[data-smart-food]').first().tap();
  assert.equal(await page.locator('#f_qty').isVisible(),true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sheet.hidden',{state:'attached'});
  await page.locator('#completeFoodDay').check();
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('asclepio_learning_test-user')).completed).length),1);
  await page.locator('#microArea > details > summary').click();
  const beforeEstimate=await page.evaluate(()=>window.writes.length);
  await page.locator('#estimateMicrosToggle').check();
  await page.waitForFunction(()=>document.querySelector('#microArea').textContent.includes('1 de 7 modelos superan la referencia'));
  assert.equal(await page.evaluate(()=>window.writes.length),beforeEstimate,'Entrenar no escribe datos');
  await page.evaluate(async()=>{
   const {BASICS}=await import('/js/basics.js?v=30');
   const f={...BASICS.find(f=>f.name==='Avena en hojuelas'),id:'synthetic-food',usda_fdc_id:'synthetic-food',name:'Prueba ML'};
   f.micros={...f.micros};delete f.micros.zinc_mg;
   window.db.foods.push(f);
   const d=new Date(),date=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
   window.db.food_logs.push({...f,id:'ml-log',food_id:f.id,user_id:'test-user',log_date:date,log_time:'12:00',quantity:1,momento:'Almuerzo',food_name_snapshot:f.name});
   await window.testApp.refreshAfterLog();
  });
  assert.equal(await page.locator('#completeFoodDay').isChecked(),false,'Cambiar comida invalida la confirmación');
  assert.match(await page.locator('#microArea').textContent(),/estimados aparte/);
  assert.match(await page.locator('#microArea').textContent(),/ML: vecinos nutricionales/);
  if(process.env.SCREENSHOT_DIR){
   await page.locator('#microArea').scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'micros-ml.png'),fullPage:true});
  }
  await page.locator('#estimateMicrosToggle').uncheck();
  assert.equal(await page.locator('.micro-estimate').count(),0);
  await page.locator('button[data-tab="datos"]').click();
  await page.locator('#energyModelCard > summary').click();
  await page.waitForFunction(()=>!document.querySelector('#refreshEnergyBtn').disabled);
  assert.match(await page.locator('#energyModelArea').textContent(),/Recopilando/);
  assert.ok(await page.locator('[data-complete-date]').count()>0);
  await page.locator('#energyModelCard > details').first().locator('summary').click();
  await page.locator('[data-complete-date]').first().check();
  const learningWrites=await page.evaluate(()=>window.writes.length);
  await page.evaluate(async()=>{
   const {foodSignature}=await import('/js/intelligence.js?v=30');
   const {suggestGoals}=await import('/js/health.js?v=30');
   const day=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
   const body=window.db.body_profiles[0],prior=suggestGoals(body,80).tdee,actual=prior+400;
   const foods=[],weights=[],completed={};
   for(let i=0;i<50;i++){
    const r={id:'energy-'+i,user_id:'test-user',log_date:day(50-i),log_time:'12:00',kcal:2200};
    foods.push(r);weights.push({id:'weight-'+i,user_id:'test-user',log_date:r.log_date,weight_kg:80+(2200-actual)/7700*i});
    completed[r.log_date]=foodSignature([r]);
   }
   window.db.food_logs=foods;window.db.weight_logs=weights;
   const settings=JSON.parse(localStorage.getItem('asclepio_learning_test-user'));
   settings.completed=completed;localStorage.setItem('asclepio_learning_test-user',JSON.stringify(settings));
  });
  await page.locator('#refreshEnergyBtn').click();
  await page.waitForSelector('#useAdaptiveGoal',{timeout:5000}).catch(async error=>{console.error('Modelo:',await page.locator('#energyModelArea').textContent());throw error;});
  assert.match(await page.locator('#energyModelArea').textContent(),/Gasto estimado/);
  if(process.env.SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'energia-modelo.png'),fullPage:true});
  await page.locator('#useAdaptiveGoal').click();
  assert.equal(await page.locator('#goalEditor').getAttribute('open'),'');
  assert.match(await page.locator('#goalStatus').textContent(),/sin guardar/);
  assert.equal(await page.evaluate(()=>window.writes.length),learningWrites,'Proponer no guarda metas');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true);
  // Salud digestiva y preferencias explícitas: ninguna impresión equivale a rechazo.
  await page.locator('button[data-tab="hoy"]').click();
  const preferenceSnapshot=await page.evaluate(()=>localStorage.getItem('asclepio_learning_test-user'));
  await page.locator('#smartDiary > summary').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('asclepio_learning_test-user')),preferenceSnapshot);
  await page.locator('#tileBano').click();
  await page.waitForSelector('#gutRegister');
  assert.equal(await page.locator('.tab-btn').count(),5);
  assert.match(await page.locator('#gutArea').textContent(),/frecuencia desconocida/);
  const gutWrites=await page.evaluate(()=>window.writes.length);
  await page.locator('#gutContext > summary').click();
  await page.locator('#g_pain').fill('0');await page.locator('#g_bloating').fill('0');await page.locator('#g_stress').fill('4');
  await page.locator('#g_blood').selectOption('no');
  await page.locator('#gutDayForm button[type="submit"]').click();
  const context=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('asclepio_gut_test-user')).days)[0]);
  assert.equal(context.pain,0);assert.equal(context.medicationTaken,null);assert.equal(context.blood,false);
  assert.equal(await page.evaluate(()=>window.writes.length),gutWrites,'Contexto y probióticos locales no escriben puntos ni actividades');
  await page.locator('#g_blood').selectOption('yes');await page.locator('#gutDayForm button[type="submit"]').click();
  assert.match(await page.locator('.gut-alert').textContent(),/valoración médica/);
  await page.locator('#gutProbiotics > summary').click();
  await page.locator('#p_name').fill('Producto <script> literal');await page.locator('#p_species').fill('Especie declarada');
  await page.locator('#p_strain').fill('Cepa de prueba');await page.locator('#p_cfu').fill('1000000000');
  await page.locator('#p_evidence').fill('https://pubmed.ncbi.nlm.nih.gov/34256014/');
  await page.locator('#gutProductForm button[type="submit"]').click();
  assert.equal(await page.locator('#gutProductList script').count(),0);
  assert.match(await page.locator('#gutProductList').textContent(),/Producto <script> literal/);
  await page.locator('[data-gut-taken]').check();
  await page.locator('[data-gut-product]').click();
  await page.locator('#p_storage').fill('Según etiqueta');
  await page.locator('#gutProductForm button[type="submit"]').click();
  assert.equal(await page.locator('[data-gut-taken]').isChecked(),true,'Editar la ficha conserva las tomas');
  assert.equal(await page.evaluate(()=>window.writes.length),gutWrites);
  const downloading=page.waitForEvent('download');await page.locator('#gutExport').click();
  const downloaded=await downloading;const digestiveReport=fs.readFileSync(await downloaded.path(),'utf8');
  assert.match(digestiveReport,/dolor 0\/10/);assert.match(digestiveReport,/Cepa de prueba/);
  await page.locator('#gutRegister').click();await page.locator('#b_bristol').selectOption('4');
  await page.locator('#b_dolor').fill('0');await page.locator('#b_hinchazon').fill('2');
  await page.locator('#b_esfuerzo').fill('1');await page.locator('#b_urgencia').fill('3');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>window.db.activity_logs.some(r=>r.type==='bano'&&r.data.bristol===4));
  await page.waitForSelector('[data-gut-edit]');
  assert.match(await page.locator('[data-gut-edit]').first().textContent(),/Dolor 0\/10/);
  await page.locator('[data-gut-edit]').first().click();await page.locator('#restBtn').click();
  await page.waitForFunction(()=>window.db.activity_logs.some(r=>r.type==='bano'&&r.data.fue===false));
  const noBowel=await page.evaluate(()=>window.db.activity_logs.find(r=>r.type==='bano').data);
  assert.equal(noBowel.dolor,0);assert.equal(noBowel.bristol,null);
  await page.waitForSelector('#gutRegister');
  if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'salud-digestiva.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true,'Diario digestivo sin desbordamiento');
  assert.deepEqual(errors,[]);
  console.log('OK: decimales, nutrientes, validación, objetivos, historial, fallo de guardado, sueño, ranking paginado y 5 pestañas a 390x844; sin errores de consola.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
