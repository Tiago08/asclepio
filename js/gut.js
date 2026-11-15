// Diario y modelos digestivos locales. No estiman bacterias ni diagnostican enfermedades.
import { BASICS } from './basics.js?v=30';
import { foodSignature } from './intelligence.js?v=30';
import { sleepMetrics } from './sleep.js?v=30';
export const GUT_SOURCES = {
  wgo:{label:'WGO · cepas, dosis e indicaciones',url:'https://www.worldgastroenterology.org/UserFiles/file/guidelines/probiotics-and-prebiotics-english-2023.pdf'},
  aga:{label:'AGA · probióticos por indicación',url:'https://gastro.org/clinical-guidance/role-of-probiotics-in-the-management-of-gastrointestinal-disorders/'},
  bloating:{label:'AGA · hinchazón y distensión',url:'https://gastro.org/news/new-clinical-practice-update-belching-bloating-distention/'},
  diet:{label:'AGA · fibra y dieta en intestino irritable',url:'https://pubmed.ncbi.nlm.nih.gov/35337654/'},
  isapp:{label:'ISAPP · fermentados y cultivos vivos',url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC7925329/'},
  stanford:{label:'Sonnenburg y Gardner · ensayo de fermentados, 36 adultos',url:'https://pubmed.ncbi.nlm.nih.gov/34256014/'},
  plants:{label:'American Gut · estudio observacional',url:'https://pubmed.ncbi.nlm.nih.gov/29795809/'},
  consensus:{label:'Consenso internacional · límites de pruebas del microbioma',url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC12343204/'},
  alarm:{label:'NIDDK · señales de alarma',url:'https://www.niddk.nih.gov/health-information/digestive-diseases/constipation/symptoms-causes'},
  fiber:{label:'NIDDK · fibra soluble y tolerancia',url:'https://www.niddk.nih.gov/health-information/digestive-diseases/irritable-bowel-syndrome/eating-diet-nutrition'},
  prebiotics:{label:'ISAPP · componentes y límites de los prebióticos',url:'https://enviromicro-journals.onlinelibrary.wiley.com/doi/10.1111/jam.14424'}
};
const plantGroups=[
  ['arroz',['168878','168877','169704']],['avena',['173904','173905']],['trigo',['169737','174924','172688','175037']],
  ['maíz',['168070','168922','175036','169999']],['quinoa',['168917']],['papa',['170440','170093','169264']],
  ['batata',['168483']],['yuca',['169985']],['plátano/cambur',['169130','168216','168199','173944']],
  ['frijol común',['173735','175194']],['lenteja',['172421']],['garbanzo',['173757']],['soya',['172475']],
  ['manzana',['1750341']],['naranja',['169097']],['mandarina',['169105']],['fresa',['167762']],['uva',['174683','168164']],
  ['piña',['169124']],['mango',['169910']],['lechosa',['169926']],['patilla',['167765']],['melón',['169092']],
  ['pera',['169118']],['durazno',['169928']],['guayaba',['173044']],['parchita',['169108']],['aguacate',['171705']],
  ['limón',['167746']],['kiwi',['168153']],['arándano',['171711']],['tomate',['170457']],['cebolla',['170000']],
  ['lechuga',['169247']],['zanahoria',['170393']],['brócoli/coliflor/repollo',['169967','169986','169975']],
  ['espinaca',['168462']],['pepino',['168409']],['pimentón',['170108']],['calabacín/auyama',['169291','168448']],
  ['berenjena',['169228']],['ajo',['169230']],['remolacha',['169145']]
];
const plantMap=new Map(plantGroups.flatMap(([plant,ids])=>ids.map(id=>[id,plant])));
const fermented=new Set(['171284','330137','328637','171257']);
const substrates={'173904':'beta-glucanos','173905':'beta-glucanos','170000':'fructanos','169230':'fructanos','173735':'galactooligosacáridos','175194':'galactooligosacáridos','172421':'galactooligosacáridos','173757':'galactooligosacáridos'};
export const GUT_FOODS=BASICS.filter(f=>plantMap.has(f.usda_fdc_id)||fermented.has(f.usda_fdc_id)).map(f=>({
  fdcId:f.usda_fdc_id,name:f.name,plant:plantMap.get(f.usda_fdc_id)||null,
  fermented:fermented.has(f.usda_fdc_id),live:null,substrate:substrates[f.usda_fdc_id]||null,
  source:'https://fdc.nal.usda.gov/food-details/'+f.usda_fdc_id+'/nutrients',componentSource:GUT_SOURCES.prebiotics.url
}));
const finite=v=>v!=null && String(v).trim()!=='' && typeof v!=='boolean' && Number.isFinite(Number(v));
export const gutLevel=v=>finite(v)&&Number(v)>=0&&Number(v)<=10?Number(v):null;
const mean=xs=>xs.reduce((s,x)=>s+x,0)/xs.length;
const shift=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function normalizeBowel(data={}){
  const bristol=Number(data.bristol);
  return {went:data.fue===false?false:true,bristol:data.fue!==false&&Number.isInteger(bristol)&&bristol>=1&&bristol<=7?bristol:null,
    legacy:data.tipo||null,pain:gutLevel(data.dolor),bloating:gutLevel(data.hinchazon),effort:gutLevel(data.esfuerzo),urgency:gutLevel(data.urgencia)};
}
export function bowelText(data={}){
  const n=normalizeBowel(data);
  return [n.went?(n.bristol?`Bristol ${n.bristol}`:n.legacy||'Deposición'):'No fui hoy',
    ...[['Dolor',n.pain],['Hinchazón',n.bloating],['Esfuerzo',n.effort],['Urgencia',n.urgency]].filter(([,v])=>v!=null).map(([k,v])=>`${k} ${v}/10`),
    Array.isArray(data.extras)?data.extras.join(', '):'',data.nota||''].filter(Boolean).join(' · ');
}
export function gutStorage(userId,storage){
  if(!userId)throw new Error('Falta la cuenta');
  const key='asclepio_gut_'+userId;
  return {load(){
    const raw=storage.getItem(key);if(!raw)return {days:{},probiotics:[],tolerance:{}};
    const value=JSON.parse(raw);
    if(!value || Array.isArray(value) || typeof value!=='object')throw new Error('Formato del diario no válido');
    if(value.days && (Array.isArray(value.days)||typeof value.days!=='object'||Object.entries(value.days).some(([date,day])=>!/^\d{4}-\d{2}-\d{2}$/.test(date)||!day||Array.isArray(day)||typeof day!=='object')))throw new Error('Contexto diario no válido');
    if(value.probiotics && (!Array.isArray(value.probiotics)||value.probiotics.some(p=>!p||typeof p!=='object'||typeof p.name!=='string')))throw new Error('Fichas de probióticos no válidas');
    if(value.tolerance && (Array.isArray(value.tolerance)||typeof value.tolerance!=='object'||Object.values(value.tolerance).some(p=>!p||typeof p!=='object'||typeof p.name!=='string')))throw new Error('Preferencias de tolerancia no válidas');
    return {days:value.days&&typeof value.days==='object'&&!Array.isArray(value.days)?value.days:{},probiotics:Array.isArray(value.probiotics)?value.probiotics:[],tolerance:value.tolerance&&typeof value.tolerance==='object'?value.tolerance:{}};
  },save(value){storage.setItem(key,JSON.stringify(value));}};
}
export function digestiveNutrition(logs,catalog){
  const byId=new Map(catalog.filter(f=>f.id).map(f=>[f.id,f]));
  const metadata=new Map(GUT_FOODS.map(f=>[f.fdcId,f]));
  const plants=new Set(),substratesFound=new Set();let covered=0,fiber=0,fiberKnown=0,ferments=0;
  for(const log of logs){
    if(finite(log.fiber_g)&&Number(log.fiber_g)>=0){fiber+=Number(log.fiber_g);fiberKnown++;}
    const f=byId.get(log.food_id),entry=f&&metadata.get(String(f.usda_fdc_id));
    if(!entry)continue;covered++;
    if(entry.plant)plants.add(entry.plant);
    if(entry.substrate)substratesFound.add(entry.substrate);
    if(entry.fermented)ferments++;
  }
  return {plants:[...plants],substrates:[...substratesFound],covered,total:logs.length,fiber,fiberKnown,ferments};
}
export function digestiveAlarms(day={}){
  const signals=[];
  if(day.blood===true)signals.push('Sangre en las heces');
  if(day.persistentPain===true)signals.push('Dolor abdominal persistente');
  if(day.weightLoss===true)signals.push('Pérdida de peso involuntaria');
  return signals;
}
export function validateProbiotic(product){
  if(!String(product.name||'').trim())return 'Escribe el nombre del producto';
  if(product.cfu!=='' && product.cfu!=null && (!finite(product.cfu)||Number(product.cfu)<=0))return 'Las UFC por dosis deben ser un número positivo';
  for(const key of ['start','end','expiry'])if(product[key] && !/^\d{4}-\d{2}-\d{2}$/.test(product[key]))return 'Revisa las fechas';
  if(product.start&&product.end&&product.end<product.start)return 'La fecha final debe ser posterior al inicio';
  if(product.evidence && !/^https:\/\/(pubmed\.ncbi\.nlm\.nih\.gov|pmc\.ncbi\.nlm\.nih\.gov|gastro\.org|www\.worldgastroenterology\.org)\//.test(product.evidence))return 'Usa un enlace HTTPS de PubMed, PMC, AGA o WGO';
  return null;
}

/** Predice dolor diario con contexto del día anterior, nunca con síntomas del día objetivo. */
export function digestiveModel(days,foods,candidateDate){
  const features=date=>{
    const previous=days[shift(date,-1)];if(!previous || digestiveAlarms(previous).length)return null;
    const pain=gutLevel(previous.pain),bloating=gutLevel(previous.bloating),stress=gutLevel(previous.stress);
    if([pain,bloating,stress].some(v=>v==null))return null;
    return [pain,bloating,stress];
  };
  const rows=Object.keys(days).filter(date=>date<candidateDate && gutLevel(days[date].pain)!=null && !digestiveAlarms(days[date]).length)
    .sort().map(date=>({date,x:features(date),y:gutLevel(days[date].pain)})).filter(r=>r.x);
  if(rows.length<32)return {state:'collecting',count:rows.length,needed:32};
  const predict=(history,x)=>{
    const centers=[0,1,2].map(i=>mean(history.map(r=>r.x[i])));
    const scales=centers.map((c,i)=>Math.max(1,Math.sqrt(mean(history.map(r=>(r.x[i]-c)**2)))));
    const close=history.map(r=>({...r,d:Math.sqrt(mean(x.map((v,i)=>((v-r.x[i])/scales[i])**2)))})).sort((a,b)=>a.d-b.d).slice(0,5);
    if(close[0].d>2)return null;
    const weights=close.map(r=>1/(.5+r.d));
    return close.reduce((s,r,i)=>s+r.y*weights[i],0)/weights.reduce((s,w)=>s+w,0);
  };
  const errors=[],baseline=[],persistence=[];
  for(let i=rows.length-12;i<rows.length;i++){
    const train=rows.slice(0,i),p=predict(train,rows[i].x);
    if(p==null)return {state:'baseline',count:rows.length};
    errors.push(Math.abs(p-rows[i].y));baseline.push(Math.abs(mean(train.map(r=>r.y))-rows[i].y));persistence.push(Math.abs(rows[i].x[0]-rows[i].y));
  }
  const mae=mean(errors),base=Math.min(mean(baseline),mean(persistence));
  const stable=[0,6].every(start=>mean(errors.slice(start,start+6))<Math.min(mean(baseline.slice(start,start+6)),mean(persistence.slice(start,start+6))));
  const active=base>0&&mae<base*.9&&mae<=2&&stable;
  const result={state:active?'active':'baseline',count:rows.length,mae,baseline:base,validation:12};
  const x=features(candidateDate);
  if(active && x && !digestiveAlarms(days[candidateDate]).length){const value=predict(rows,x);if(value!=null)result.prediction=Math.round(value*10)/10;}
  return result;
}

export function digestiveAssociations(days,foods,entries,completed={}){
  const byDate={};for(const r of foods)(byDate[r.log_date] ||= []).push(r);
  const pairs=Object.keys(days).filter(date=>gutLevel(days[date].pain)!=null).sort().map(date=>{
    const previous=shift(date,-1),logs=byDate[previous]||[],context=days[previous]||{};
    const knownFiber=logs.length>0&&logs.every(r=>finite(r.fiber_g))&&completed[previous]===foodSignature(logs);
    const sleep=entries.filter(e=>e.type==='sueno'&&e.date===previous).at(-1)?.data;
    const duration=sleep?sleepMetrics(sleep).dur:null;
    return {date,pain:gutLevel(days[date].pain),fiber:knownFiber?logs.reduce((s,r)=>s+Number(r.fiber_g),0):null,stress:gutLevel(context.stress),medication:context.medicationTaken===true?1:context.medicationTaken===false?0:null,sleep:duration!=null?duration/60:null};
  });
  const results=[];
  for(const [key,label] of [['fiber','fibra registrada'],['stress','estrés declarado'],['medication','medicación declarada'],['sleep','sueño registrado']]){
    const known=pairs.filter(p=>p[key]!=null);if(known.length<12)continue;
    const threshold=key==='medication'?.5:mean(known.map(p=>p[key]));
    const low=known.filter(p=>p[key]<threshold),high=known.filter(p=>p[key]>=threshold);
    if(Math.min(low.length,high.length)<5)continue;
    results.push({label,threshold,low:low.length,high:high.length,difference:mean(high.map(p=>p.pain))-mean(low.map(p=>p.pain)),count:known.length});
  }
  return results;
}
