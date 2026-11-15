import { sleepMetrics } from './sleep.js?v=26';

export const JOURNAL_FIELDS = [
  {key:'intentoDormir',label:'Intentaste dormir',type:'time'},
  {key:'despertares',label:'Número de despertares',type:'number',max:50},
  {key:'descanso',label:'Descanso al despertar (1–5)',type:'number',min:1,max:5},
  {key:'somnolencia',label:'Somnolencia durante el día (1–5)',type:'number',min:1,max:5},
  {key:'cafeinaHora',label:'Última cafeína (vacío si no lo sabes)',type:'time'},
  {key:'cafeinaTarde',label:'Cafeína en las 8 h previas',type:'choice'},
  {key:'alcohol',label:'Alcohol antes de esta noche',type:'choice'},
  {key:'siesta',label:'Siesta previa (minutos)',type:'number',max:240},
  {key:'cenaHora',label:'Terminaste de cenar',type:'time'},
  {key:'estres',label:'Estrés antes de dormir (1–5)',type:'number',min:1,max:5},
  {key:'ejercicioTarde',label:'Ejercicio en las 3 h previas',type:'choice'},
  {key:'pantallas',label:'Pantallas en los 30 min previos',type:'choice'},
  {key:'ruido',label:'Ruido que molestó',type:'choice'},
  {key:'calor',label:'Calor que molestó',type:'choice'}
];
export function nightScore(data, target){
  const {dur}=sleepMetrics(data);
  if(dur==null || !(Number(data.calidad)>=1 && Number(data.calidad)<=5)) return null;
  const span=dur+Number(data.despierto_min||0);
  const duration=Math.round(60*Math.min(1,dur/target));
  const continuity=Math.round(20*dur/span);
  const quality=Math.round(20*Number(data.calidad)/5);
  return {total:duration+continuity+quality,duration,continuity,quality};
}
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const known=v=>v!=='' && v!=null && Number.isFinite(Number(v));
const FEATURES=[['dur', 'duración'],['estres','estrés'],['cafeinaTarde','cafeína previa'],['alcohol','alcohol'],['siesta','siesta'],['ejercicioTarde','ejercicio tarde']];
const values=e=>({...e.data,dur:sleepMetrics(e.data).dur==null?null:sleepMetrics(e.data).dur/60});
// Regresión ridge pequeña, entrenada localmente. Normalización solo con entrenamiento.
function fit(rows,keys){
  const centers=keys.map(k=>mean(rows.filter(r=>known(r.x[k])).map(r=>Number(r.x[k]))));
  const scales=keys.map((k,i)=>Math.sqrt(mean(rows.filter(r=>known(r.x[k])).map(r=>(Number(r.x[k])-centers[i])**2)))||1);
  const encode=x=>[1,...keys.map((k,i)=>(known(x[k])?Number(x[k])-centers[i]:0)/scales[i])];
  const n=keys.length+1, matrix=Array.from({length:n},()=>Array(n+1).fill(0));
  rows.forEach(r=>{const x=encode(r.x);for(let i=0;i<n;i++){for(let j=0;j<n;j++)matrix[i][j]+=x[i]*x[j];matrix[i][n]+=x[i]*r.y;}});
  for(let i=1;i<n;i++)matrix[i][i]+=10;
  for(let i=0;i<n;i++){
    let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(matrix[j][i])>Math.abs(matrix[pivot][i]))pivot=j;
    [matrix[i],matrix[pivot]]=[matrix[pivot],matrix[i]];
    const d=matrix[i][i];if(Math.abs(d)<1e-10)return null;
    for(let k=i;k<=n;k++)matrix[i][k]/=d;
    for(let j=0;j<n;j++)if(j!==i){const factor=matrix[j][i];for(let k=i;k<=n;k++)matrix[j][k]-=factor*matrix[i][k];}
  }
  return x=>Math.max(1,Math.min(5,encode(x).reduce((s,v,i)=>s+v*matrix[i][n],0)));
}
export function personalModel(entries, candidate=null){
  const rows=[...new Map(entries.map(e=>[e.date,e])).values()].sort((a,b)=>a.date.localeCompare(b.date))
    .filter(e=>(!candidate || e.date<candidate.date) && sleepMetrics(e.data).dur!=null && known(e.data.descanso) && Number(e.data.descanso)>=1 && Number(e.data.descanso)<=5)
    .map(e=>({x:values(e),y:Number(e.data.descanso)}));
  if(rows.length<40)return {state:'collecting',count:rows.length,needed:40};
  const split=rows.length-10,train=rows.slice(0,split);
  const keys=FEATURES.map(f=>f[0]).filter(k=>train.filter(r=>known(r.x[k])).length>=train.length*0.8);
  const first=fit(train,keys);if(!first)return {state:'insufficient',count:rows.length};
  // Evaluación temporal: cada noche se predice solo usando las anteriores.
  const errors=[],baseline=[];
  for(let i=split;i<rows.length;i++){
    const history=rows.slice(0,i),predict=fit(history,keys);if(!predict)return {state:'insufficient',count:rows.length};
    errors.push(Math.abs(predict(rows[i].x)-rows[i].y));baseline.push(Math.abs(mean(history.map(r=>r.y))-rows[i].y));
  }
  const mae=mean(errors),base=mean(baseline),active=base>0 && mae<base*0.9;
  const result={state:active?'active':'baseline',count:rows.length,mae,baseline:base,keys,validation:10};
  if(active && candidate){
    const x=values(candidate);
    if(keys.every(k=>known(x[k])) && x.dur!=null)result.prediction=fit(rows,keys)(x);
    else result.missing=true;
  }
  return result;
}
export function journalPatterns(entries){
  return JOURNAL_FIELDS.filter(f=>f.type==='choice').map(f=>{
    const groups=[0,1].map(v=>entries.filter(e=>known(e.data[f.key]) && Number(e.data[f.key])===v && known(e.data.descanso) && Number(e.data.descanso)>=1 && Number(e.data.descanso)<=5).map(e=>Number(e.data.descanso)));
    if(groups.some(g=>g.length<8))return null;
    return {label:f.label,difference:mean(groups[1])-mean(groups[0]),yes:groups[1].length,no:groups[0].length};
  }).filter(Boolean).sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference)).slice(0,3);
}

export function sleepPreferences(userId){
  try{const p=JSON.parse(localStorage.getItem('asclepio_sleep_'+userId)||'{}');return {fields:Array.isArray(p.fields)?p.fields:['descanso','estres','cafeinaTarde','siesta'],wake:/^([01]\d|2[0-3]):[0-5]\d$/.test(p.wake)?p.wake:'07:00',hours:Number(p.hours)>=6 && Number(p.hours)<=10?Number(p.hours):8};}catch{return {fields:['descanso','estres','cafeinaTarde','siesta'],wake:'07:00',hours:8};}
}
export function storeSleepPreferences(userId,p){
  try{localStorage.setItem('asclepio_sleep_'+userId,JSON.stringify(p));return true;}catch{return false;}
}
export function wireSleepJournal(card,data,userId){
  const prefs=sleepPreferences(userId),details=document.createElement('details');
  details.className='more-fields sleep-journal';
  details.innerHTML=`<summary>Añadir detalles de esta noche</summary><p class="form-hint">Todo es opcional. Vacío significa sin registrar. Los hábitos corresponden al día anterior a despertar.</p><details class="journal-settings"><summary>Elegir qué quiero seguir</summary><div class="journal-options">${JOURNAL_FIELDS.map(f=>`<label><input type="checkbox" data-track="${f.key}" ${prefs.fields.includes(f.key)?'checked':''}> ${f.label}</label>`).join('')}</div><p class="form-hint">Tu selección se recuerda en este dispositivo. Los registros se guardan en tu cuenta.</p></details><div class="journal-inputs"></div>`;
  const inputs=details.querySelector('.journal-inputs');
  JOURNAL_FIELDS.forEach(f=>{
    const row=document.createElement('div');row.className='field';row.dataset.journalRow=f.key;
    const value=data[f.key]??'';
    row.innerHTML=`<label for="journal_${f.key}">${f.label}</label>`;
    const input=document.createElement(f.type==='choice'?'select':'input');input.id='journal_'+f.key;input.dataset.journal=f.key;
    if(f.type==='choice')input.innerHTML='<option value="">Sin registrar</option><option value="0">No</option><option value="1">Sí</option>';
    else {input.type=f.type;if(f.type==='number'){input.min=f.min??0;input.max=f.max??1440;input.step=1;input.inputMode='numeric';}}
    input.value=value;
    input.addEventListener('input',()=>{if(input.value==='')delete data[f.key];else data[f.key]=input.value;});
    row.hidden=!prefs.fields.includes(f.key) && value==='';row.appendChild(input);inputs.appendChild(row);
  });
  details.querySelectorAll('[data-track]').forEach(input=>input.addEventListener('change',()=>{
    prefs.fields=[...details.querySelectorAll('[data-track]:checked')].map(el=>el.dataset.track);
    details.querySelectorAll('[data-journal-row]').forEach(row=>{row.hidden=!prefs.fields.includes(row.dataset.journalRow) && (data[row.dataset.journalRow]==null || data[row.dataset.journalRow]==='');});
    storeSleepPreferences(userId,prefs);
  }));
  card.appendChild(details);
}
export function validateSleepJournal(card){
  for(const input of card.querySelectorAll('[data-journal]')){
    if(input.value!=='' && !input.checkValidity()){input.closest('.sleep-journal').open=true;input.closest('.field').hidden=false;input.reportValidity();return false;}
  }
  return true;
}
