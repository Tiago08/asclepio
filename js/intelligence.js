// Modelos pequeños, locales y reproducibles. Ninguna predicción modifica registros.
const known = v => v != null && typeof v!=='boolean' && String(v).trim()!=='' && Number.isFinite(Number(v)) && Number(v) >= 0;
const mean = xs => xs.reduce((a,b) => a+b,0) / xs.length;
const median = xs => { const a=[...xs].sort((a,b)=>a-b); return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2 : 0; };
export const nutrientValue = (row,key) => known(row?.[key]) ? Number(row[key]) : known(row?.micros?.[key]) ? Number(row.micros[key]) : null;
const FEATURES = ['kcal','protein_g','carbs_g','fat_g'];
export const IMPUTABLE = ['fiber_g','potassium_mg','magnesium_mg','calcium_mg','iron_mg','zinc_mg','vit_b6_mg'];
const vector = r => FEATURES.every(k=>known(r[k])) ? FEATURES.map(k=>Math.log1p(Number(r[k]))) : null;
const identity = r => String(r.usda_fdc_id || r.id || r.name);

function neighbors(rows, candidate, key, k=5){
  const x=vector(candidate);
  if(!x || !candidate.category) return null;
  const group=rows.filter(r=>r.category===candidate.category && nutrientValue(r,key)!=null && vector(r));
  if(group.length<5) return null;
  // Escalas aprendidas solo del conjunto de entrenamiento de este pliegue.
  const vectors=group.map(vector);
  const centers=FEATURES.map((_,i)=>mean(vectors.map(v=>v[i])));
  const scales=centers.map((c,i)=>Math.max(.35,Math.sqrt(mean(vectors.map(v=>(v[i]-c)**2)))));
  const close=group.map((r,i)=>({r,d:Math.sqrt(mean(x.map((v,j)=>((v-vectors[i][j])/scales[j])**2)))}))
    .sort((a,b)=>a.d-b.d).slice(0,k);
  if(close[0].d>1 || close.at(-1).d>2) return null;
  const weights=close.map(n=>1/(.15+n.d));
  const value=close.reduce((s,n,i)=>s+nutrientValue(n.r,key)*weights[i],0)/weights.reduce((a,b)=>a+b,0);
  return {value,distance:close[0].d,neighbors:close.map(n=>identity(n.r))};
}

/** Validación leave-one-FDC-out; comparación contra mediana de la categoría. */
export function trainMicroModels(reference){
  const rows=[...new Map(reference.filter(r=>r.source==='usda' && !r.brand && vector(r)).map(r=>[identity(r),r])).values()];
  const models={};
  for(const key of IMPUTABLE){
    const errors=[], baseline=[], categoryErrors={};
    for(const row of rows){
      const actual=nutrientValue(row,key);
      if(actual==null) continue;
      const train=rows.filter(r=>identity(r)!==identity(row));
      const prediction=neighbors(train,row,key);
      if(!prediction) continue;
      const group=train.filter(r=>r.category===row.category && nutrientValue(r,key)!=null);
      const error=Math.abs(prediction.value-actual);
      errors.push(error); baseline.push(Math.abs(median(group.map(r=>nutrientValue(r,key)))-actual));
      (categoryErrors[row.category] ||= []).push(error);
    }
    const mae=errors.length?mean(errors):null, base=baseline.length?mean(baseline):null;
    const average=mean(rows.map(r=>nutrientValue(r,key)).filter(v=>v!=null));
    models[key]={key,rows,mae,baseline:base,count:errors.length,categoryErrors,
      active:errors.length>=30 && base>0 && mae<base*.9 && mae<=average*.6};
  }
  return models;
}

export function predictMicro(models,food,key){
  const model=models[key];
  const errors=model?.categoryErrors[food.category];
  if(!model?.active || !errors || errors.length<5 || food.brand || food.source!=='usda') return null;
  // No aprender de un valor ya conocido ni predecir contra el mismo FDC.
  const prediction=neighbors(model.rows.filter(r=>identity(r)!==identity(food)),food,key);
  if(!prediction) return null;
  const sorted=[...errors].sort((a,b)=>a-b), error=sorted[Math.ceil(sorted.length*.9)-1];
  // Abstención si el error observado en alimentos similares supera la estimación.
  if(prediction.value<=0 || error>prediction.value) return null;
  return {...prediction,error,mae:model.mae,validation:model.count};
}

/** Estimaciones efímeras, separadas del total documentado y nunca persistidas. */
export function estimateMissing(rows,catalog,models){
  const byId=new Map(catalog.filter(f=>f.id).map(f=>[f.id,f]));
  return rows.map(row=>{
    const source=byId.get(row.food_id), q=Number(row.quantity);
    if(!source || !(q>0) || !(Number(source.serving_grams)>0)) return {};
    const factor=q*Number(source.serving_grams)/100;
    const normalized={...source};
    for(const key of FEATURES) normalized[key]=known(row[key]) ? Number(row[key])/factor : null;
    const estimates={};
    for(const key of IMPUTABLE){
      if(nutrientValue(row,key)!=null) continue;
      const reference=nutrientValue(source,key);
      if(reference!=null){
        estimates[key]={value:reference*q,error:0,method:'catalog',neighbors:[identity(source)]};
        continue;
      }
      const predicted=predictMicro(models,normalized,key);
      if(predicted) estimates[key]={value:predicted.value*factor,error:predicted.error*factor,method:'knn',neighbors:predicted.neighbors};
    }
    return estimates;
  });
}

export function foodSignature(rows){
  return JSON.stringify(rows.map(r=>[r.id,known(r.kcal)?Number(r.kcal):null]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}
const dayNumber = date => Date.parse(date+'T12:00:00Z')/86400000;

function expenditureFit(rows,prior){
  const mx=mean(rows.map(r=>r.x)), my=mean(rows.map(r=>r.y));
  const variance=rows.reduce((s,r)=>s+(r.x-mx)**2,0);
  const penalty=variance*.2;
  if(variance<=0) return null;
  const slope=(rows.reduce((s,r)=>s+(r.x-mx)*(r.y-my),0)-penalty*prior/7700)/(variance+penalty);
  return {tdee:-slope*7700,predict:x=>my+slope*(x-mx),baseline:x=>my-prior/7700*(x-mx)};
}

/** Regresión regularizada del balance energético, con prueba temporal sin fuga. */
export function adaptiveEnergy({foods,weights,completed,prior,bmr,today}){
  if(!(prior>0) || !(bmr>0)) return {state:'profile'};
  const byDate={};
  foods.filter(r=>r.log_date<today).forEach(r=>(byDate[r.log_date] ||= []).push(r));
  const dates=Object.keys(byDate).filter(d=>completed[d]===foodSignature(byDate[d]) && byDate[d].every(r=>known(r.kcal))).sort();
  // Bloque consecutivo más reciente: no rellenar días ausentes con cero calorías.
  const runs=[];
  for(const d of dates){
    if(!runs.length || dayNumber(d)-dayNumber(runs.at(-1).at(-1))!==1) runs.push([]);
    runs.at(-1).push(d);
  }
  const run=runs.at(-1)||[];
  const count=run.length;
  if(count<35) return {state:'collecting',days:count,needed:35};
  if(dayNumber(today)-dayNumber(run.at(-1))>7) return {state:'stale',days:count};
  const start=dayNumber(run[0]), energyByDate={};let cumulative=0;
  for(const date of run){energyByDate[date]=cumulative;cumulative+=byDate[date].reduce((s,r)=>s+Number(r.kcal),0);}
  const last=run.at(-1), end=new Date((dayNumber(last)+1)*86400000).toISOString().slice(0,10);
  energyByDate[end]=cumulative;
  const samples=[...new Map(weights.filter(w=>known(w.weight_kg) && Number(w.weight_kg)>20 && w.log_date<today && energyByDate[w.log_date]!=null).map(w=>[w.log_date,w])).values()]
    .sort((a,b)=>a.log_date.localeCompare(b.log_date)).map(w=>({x:dayNumber(w.log_date)-start,y:Number(w.weight_kg)-energyByDate[w.log_date]/7700,date:w.log_date}));
  if(samples.length<18 || samples.at(-1).x-samples[0].x<28) return {state:'collecting',days:count,weights:samples.length,needed:35};
  const split=samples.length-6;
  if(samples[split-1].x-samples[0].x<21) return {state:'collecting',days:count,weights:samples.length,needed:35};
  const errors=[],baseErrors=[];
  for(let i=split;i<samples.length;i++){
    const fitted=expenditureFit(samples.slice(0,i),prior);
    if(!fitted) return {state:'baseline',days:count};
    errors.push(Math.abs(fitted.predict(samples[i].x)-samples[i].y));
    baseErrors.push(Math.abs(fitted.baseline(samples[i].x)-samples[i].y));
  }
  const fit=expenditureFit(samples,prior),mae=mean(errors),baseline=mean(baseErrors);
  const active=baseline>0 && mae<baseline*.9 && mae<=.6 && fit.tdee>=bmr && fit.tdee<=bmr*2.6;
  return {state:active?'active':'baseline',days:count,weights:samples.length,mae,baseline,tdee:active?Math.round(fit.tdee/10)*10:null,validation:6};
}

const foodKey = f => f.usda_fdc_id ? 'fdc:'+f.usda_fdc_id : f.id ? 'id:'+f.id : null;
const mealName = m => m==='Snack'?'Merienda':m;
function preferenceFit(logs,idMap){
  const global={},meals={};
  for(const log of logs){
    const key=idMap.get(log.food_id);if(!key)continue;
    global[key]=(global[key]||0)+1;
    const meal=mealName(log.momento);(meals[meal] ||= {})[key]=((meals[meal]||{})[key]||0)+1;
  }
  const total=Object.values(global).reduce((a,b)=>a+b,0),vocab=Object.keys(global).length;
  return {global,prob(key,meal){
    const prior=(global[key]||0)+1,denominator=total+vocab+1;
    const group=meals[meal]||{},n=Object.values(group).reduce((a,b)=>a+b,0);
    return {baseline:prior/denominator,conditional:((group[key]||0)+8*prior/denominator)/(n+8)};
  }};
}

/** Modelo categórico bayesiano de elección por comida, evaluado en días posteriores. */
export function trainPreferences(logs,catalog){
  const idMap=new Map(catalog.filter(f=>f.id).map(f=>[f.id,foodKey(f)]));
  const rows=logs.filter(r=>idMap.has(r.food_id)).sort((a,b)=>(a.log_date+a.log_time).localeCompare(b.log_date+b.log_time));
  const dates=[...new Set(rows.map(r=>r.log_date))];
  if(rows.length<40 || dates.length<14) return {active:false,count:rows.length};
  const cutoff=dates[Math.floor(dates.length*.75)],train=rows.filter(r=>r.log_date<cutoff),test=rows.filter(r=>r.log_date>=cutoff);
  if(train.length<25 || test.length<10) return {active:false,count:rows.length};
  const fit=preferenceFit(train,idMap),loss=[],base=[];
  for(const r of test){const p=fit.prob(idMap.get(r.food_id),mealName(r.momento));loss.push(-Math.log(p.conditional));base.push(-Math.log(p.baseline));}
  const error=mean(loss),baseline=mean(base),final=preferenceFit(rows,idMap);
  return {active:error<baseline*.95,count:rows.length,error,baseline,validation:test.length,prob:final.prob};
}

export function recommendFoods({catalog,targets,totals,coverage,goals,kcal,protein,logs,meal,hidden=[],completeMacros=true}){
  const remaining=Number(goals.goal_kcal)-kcal;
  if(!completeMacros || !Number.isFinite(remaining) || remaining<80) return {items:[],preference:{active:false,count:0}};
  const preference=trainPreferences(logs,catalog),seen=new Set(),items=[];
  for(const food of catalog){
    const key=foodKey(food);
    if(!key || seen.has(key) || hidden.includes(key)) continue;seen.add(key);
    if(food.brand || !food.category || /crud[oa]|harina|cerveza|vino|licor/i.test(food.name))continue;
    const grams=Number(food.serving_grams);
    if(!(grams>0) || !FEATURES.every(k=>known(food[k])))continue;
    const portionLimit=/frutos secos|semillas/i.test(food.category)?40:/queso/i.test(food.name)?60:250;
    const unit=food._units?.filter(u=>u.grams>=15 && u.grams<=portionLimit).sort((a,b)=>a.grams-b.grams)[0];
    const portion=unit?unit.grams:/frutos secos|semillas/i.test(food.category)?30:/queso/i.test(food.name)?30:100;
    const factor=portion/grams,energy=Number(food.kcal)*factor;
    if(energy<20 || energy>remaining || energy>600)continue;
    const contributions=[];let score=0,blocked=false;
    for(const t of targets){
      const v=nutrientValue(food,t.key);if(v==null)continue;
      const value=v*factor,current=totals[t.key]||0;
      if(t.max && current+value>t.max && value>t.max*.1){blocked=true;break;}
      if(t.key==='sodium_mg')continue;
      // Una suma parcial no demuestra una carencia: no dirigir recomendaciones con ella.
      if(!t.goal || (coverage[t.key]?.known||0)<(coverage[t.key]?.total||1))continue;
      const gain=Math.min(Math.max(0,t.goal-current),value)/t.goal;
      score+=gain;
      if(gain>=.05)contributions.push({label:t.label,gain});
    }
    if(blocked)continue;
    const proteinGain=Math.min(Math.max(0,goals.goal_protein_g-protein),Number(food.protein_g)*factor)/Math.max(1,goals.goal_protein_g);
    score+=proteinGain*1.5;
    if(proteinGain>=.05)contributions.push({label:'Proteína',gain:proteinGain});
    if(score<=.02)continue;
    if(preference.active) score*=1+Math.min(.3,preference.prob(key,meal).conditional);
    contributions.sort((a,b)=>b.gain-a.gain);
    items.push({food,key,portion,quantity:factor,kcal:Math.round(energy),score,reason:contributions.slice(0,2).map(c=>c.label).join(' y ')||'Tus metas',unit:unit?.label});
  }
  items.sort((a,b)=>b.score-a.score || a.key.localeCompare(b.key));
  const chosen=[];const categories=new Set();
  for(const item of items){if(categories.has(item.food.category))continue;chosen.push(item);categories.add(item.food.category);if(chosen.length===3)break;}
  return {items:chosen,preference};
}
