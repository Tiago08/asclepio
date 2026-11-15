import { GUT_SOURCES,GUT_FOODS,gutStorage,gutLevel,bowelText,normalizeBowel,digestiveNutrition,digestiveAlarms,validateProbiotic,digestiveModel,digestiveAssociations } from './gut.js?v=30';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=key=>`<a href="${GUT_SOURCES[key].url}" target="_blank" rel="noopener">${GUT_SOURCES[key].label}</a>`;
const field=(id,label,value='',type='text',extra='')=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value)}" ${extra}></div>`;
const level=(id,label,value)=>field(id,label,value??'','number','min="0" max="10" step="1" inputmode="numeric"');
const choice=(id,label,value)=>`<div class="field"><label for="${id}">${label}</label><select id="${id}"><option value="">Sin registrar</option><option value="yes" ${value===true?'selected':''}>Sí</option><option value="no" ${value===false?'selected':''}>No</option></select></div>`;
const readChoice=element=>element.value==='yes'?true:element.value==='no'?false:null;

export function wireBowelFields(card,data){
  const block=document.createElement('div');block.className='bowel-fields';
  block.innerHTML=`<div class="field"><label for="b_bristol">Escala de Bristol</label><select id="b_bristol"><option value="">Sin registrar${data.tipo?' · anterior: '+esc(data.tipo):''}</option>${['Bolitas duras','Salchicha grumosa','Salchicha con grietas','Lisa y blanda','Trozos blandos','Trozos pastosos','Líquida'].map((label,i)=>`<option value="${i+1}" ${Number(data.bristol)===i+1?'selected':''}>${i+1} · ${label}</option>`).join('')}</select></div>
    <div class="row-2">${level('b_dolor','Dolor (0–10)',data.dolor)}${level('b_hinchazon','Hinchazón (0–10)',data.hinchazon)}${level('b_esfuerzo','Esfuerzo (0–10)',data.esfuerzo)}${level('b_urgencia','Urgencia (0–10)',data.urgencia)}</div>
    <p class="form-hint">0 significa ausencia. Vacío significa desconocido. La frecuencia se cuenta por deposiciones registradas, sin asumir cero en días vacíos.</p>
    ${field('b_nota','Nota (opcional)',data.nota||'')}`;
  card.appendChild(block);
  block.querySelector('#b_bristol').onchange=ev=>{data.bristol=ev.target.value?Number(ev.target.value):null;if(data.bristol)data.tipo='Bristol '+data.bristol;else delete data.tipo;};
  for(const key of ['dolor','hinchazon','esfuerzo','urgencia'])block.querySelector('#b_'+key).oninput=ev=>{if(ev.target.value==='')delete data[key];else{data[key]=Number(ev.target.value);if(key==='hinchazon'&&Array.isArray(data.extras))data.extras=data.extras.filter(x=>x!=='Hinchazón');}};
  block.querySelector('#b_nota').oninput=ev=>data.nota=ev.target.value;
}
export function validateBowelFields(card){return [...card.querySelectorAll('.bowel-fields input')].every(input=>input.reportValidity());}

export function buildDigestiveReport({date,entries,state,foods=[]}){
  const bowel=entries.filter(e=>e.type==='bano'&&e.date<=date);
  const lines=['ASCLEPIO · salud digestiva',`Hasta ${date}`,'Datos declarados; no diagnostican microbiota ni intolerancias.',''];
  for(const e of bowel)lines.push(`${e.date} ${e.time}: ${bowelText(e.data)}`);
  lines.push('','Contexto alimentario y sueño (solo registros disponibles):');
  for(const row of foods.filter(r=>r.log_date<=date))lines.push(`${row.log_date} ${row.log_time||''} · ${row.food_name_snapshot||'Comida'} · cantidad ${row.quantity??'sin dato'} · fibra ${row.fiber_g??'sin dato'} g`);
  for(const e of entries.filter(e=>e.type==='sueno'&&e.date<=date))lines.push(`${e.date} · Sueño declarado: ${e.data.horaDormir||'?'} → ${e.data.horaDespertar||'?'} · calidad ${e.data.calidad??'sin dato'}/5`);
  for(const [day,data] of Object.entries(state.days).filter(([day])=>day<=date).sort()){
    lines.push(`${day} · dolor ${data.pain??'sin dato'}/10 · hinchazón ${data.bloating??'sin dato'}/10 · estrés ${data.stress??'sin dato'}/10`);
    if(data.medication)lines.push(`Medicación declarada: ${data.medication}; toma: ${data.medicationTaken===true?'sí':data.medicationTaken===false?'no':'sin dato'}`);
    const alarms=digestiveAlarms(data);if(alarms.length)lines.push('Señales declaradas: '+alarms.join(', '));
  }
  lines.push('','Productos registrados (sin recomendación automática):');
  for(const p of state.probiotics)lines.push(`${p.name} · especie ${p.species||'sin dato'} · cepa ${p.strain||'sin dato'} · ${p.cfu||'sin dato'} UFC/dosis · dosis ${p.dose||'sin dato'} · ${p.start||'?'} a ${p.end||'?'} · caducidad ${p.expiry||'?'} · conservación ${p.storage||'sin dato'} · motivo ${p.reason||'sin dato'} · evidencia ${p.evidence||'sin aportar'}\nTomas declaradas: ${Object.entries(p.taken||{}).filter(([day,v])=>day<=date&&v===true).map(([day])=>day).join(', ')||'sin registro'}`);
  return lines.join('\n');
}

export function renderGut({host,userId,date,entries,foods,catalog,completed,onRegister,onEdit,onBack,onDownload,onChange}){
  let store,state;
  try{store=gutStorage(userId,localStorage);state=store.load();}
  catch(error){host.innerHTML=`<p role="alert">No se pudo abrir el diario local: ${esc(error.message)}. No se reemplazaron tus datos.</p><button id="gutBack" class="btn-ghost">Volver</button>`;host.querySelector('#gutBack').onclick=onBack;return;}
  let confirmed=JSON.stringify(state);
  const save=()=>{try{store.save(state);confirmed=JSON.stringify(state);}catch{state=JSON.parse(confirmed);host.querySelector('#gutStatus').textContent='No se pudo guardar en este dispositivo. Tus cambios no se confirmaron.';return false;}onChange?.();return true;};
  const redraw=()=>renderGut({host,userId,date,entries,foods,catalog,completed,onRegister,onEdit,onBack,onDownload,onChange});
  const day=state.days[date]||{},bowel=entries.filter(e=>e.type==='bano'&&e.date===date),went=bowel.filter(e=>e.data.fue!==false);
  const conflicting=went.length&&bowel.some(e=>e.data.fue===false);
  const weekStart=new Date(Date.parse(date+'T12:00:00Z')-6*86400000).toISOString().slice(0,10);
  const nutrition=digestiveNutrition(foods.filter(f=>f.log_date>=weekStart&&f.log_date<=date),catalog);
  const model=digestiveModel(state.days,foods,date);
  const patterns=digestiveAssociations(Object.fromEntries(Object.entries(state.days).filter(([d])=>d<=date)),foods,entries,completed);
  const alarms=digestiveAlarms(day);
  host.innerHTML=`<button class="btn-link back-link" id="gutBack" type="button">‹ Hoy</button>
    <div class="data-heading"><div><p class="data-eyebrow">TU DIARIO</p><h1>Salud digestiva</h1></div></div><p class="data-intro">${esc(date)} · hábitos, tolerancia y registros.</p>
    <p class="gut-local-note">Contexto diario, probióticos y tolerancia: solo en este dispositivo y por cuenta. Las deposiciones se guardan en tu cuenta. Puedes exportar el detalle.</p>
    <div id="gutStatus" role="status" aria-live="polite"></div>
    ${alarms.length?`<div class="gut-alert" role="alert">${alarms.map(esc).join(' · ')}. Busca valoración médica pronta; si el dolor es intenso o hay sangrado abundante, atención urgente. ${link('alarm')}</div>`:''}
    <section class="data-card"><h2>Baño de este día</h2><p>${went.length?`${went.length} deposición${went.length===1?'':'es'} registrada${went.length===1?'':'s'}`:bowel.length?'Declaraste que no fuiste':'Sin registro; frecuencia desconocida'}${conflicting?' · Hay registros contradictorios: revísalos.':''}.</p><button class="btn-primary" id="gutRegister" type="button">Registrar baño</button>
    ${bowel.map(e=>`<button class="gut-entry" type="button" data-gut-edit="${esc(e.id)}"><span>${esc(e.time)}</span> ${esc(bowelText(e.data))} ›</button>`).join('')}</section>
    <details class="data-card" id="gutContext"><summary>Cómo estuvo tu digestión</summary><form id="gutDayForm"><div class="row-2">${level('g_pain','Dolor del día (0–10)',day.pain)}${level('g_bloating','Hinchazón del día (0–10)',day.bloating)}${level('g_stress','Estrés del día (0–10)',day.stress)}</div><p class="form-hint">Valoración diaria, distinta del síntoma en una deposición. Vacío se mantiene desconocido.</p>
    ${field('g_medication','Medicación, antibiótico o cambio de dosis (opcional)',day.medication||'')}${choice('g_medicationTaken','¿La tomaste este día?',day.medicationTaken)}
    ${choice('g_blood','¿Viste sangre en las heces?',day.blood)}${choice('g_persistentPain','¿Hubo dolor abdominal persistente?',day.persistentPain)}${choice('g_weightLoss','¿Hay pérdida de peso involuntaria?',day.weightLoss)}<button class="btn-primary" type="submit">Guardar contexto del día</button></form></details>
    <section class="data-card"><h2>Alimentación · últimos 7 días</h2><p><b>${nutrition.plants.length}</b> grupos vegetales identificados · <b>${nutrition.ferments}</b> registros de fermentados.</p><p class="form-hint">Catálogo identificado en ${nutrition.covered}/${nutrition.total} registros. Fibra documentada: ${nutrition.fiberKnown ? nutrition.fiber.toFixed(1)+' g acumulados' : 'sin datos'}; dato en ${nutrition.fiberKnown}/${nutrition.total} registros. La cobertura no demuestra ingesta completa.</p>
    <details><summary>Ver alimentos y componentes</summary><p>${nutrition.plants.map(esc).join(', ')||'Sin vegetales identificados en el catálogo.'}</p><p>Componentes documentados: ${nutrition.substrates.map(esc).join(', ')||'sin identificar'}. Sin estimar gramos ni efecto individual.</p><p class="form-hint">Preparaciones de un mismo vegetal se agrupan. No es una medición de diversidad bacteriana ni una meta clínica de 30 plantas.</p>${link('plants')} · ${link('prebiotics')}<div class="gut-catalog">${GUT_FOODS.map(f=>`<p><b>${esc(f.name)}</b> · ${f.plant?'grupo '+esc(f.plant):'fermentado'}${f.fermented?' · cultivos vivos: verificar etiqueta':''}${f.substrate?' · '+esc(f.substrate):''} · <a href="${f.source}" target="_blank" rel="noopener">USDA</a></p>`).join('')}</div></details></section>
    <details class="data-card"><summary>Tolerancia que tú conoces</summary><p>No se infiere una intolerancia por una correlación. Si prefieres empezar con menos cantidad, elige el alimento y registra esa preferencia.</p><div class="field"><label for="gutToleranceFood">Alimento</label><select id="gutToleranceFood"><option value="">Elegir</option>${catalog.map((f,i)=>`<option value="${i}">${esc(f.name)}</option>`).join('')}</select></div><button class="btn-ghost" id="gutSmall" type="button">Prefiero una porción pequeña</button><div id="gutToleranceList">${Object.keys(state.tolerance).map(key=>`<button class="btn-link" data-clear-tolerance="${esc(key)}" type="button">Restaurar porción habitual: ${esc(state.tolerance[key].name)}</button>`).join('')}</div></details>
    <section class="data-card"><h2>Patrones y modelo personal</h2><p>${model.state==='collecting'?`Recopilando contexto: ${model.count} días utilizables. Se necesitan al menos 32 para una primera evaluación, sin garantía de fiabilidad.`:model.state==='active'?'El modelo supera las referencias en esta evaluación.':'La referencia sencilla sigue siendo más fiable.'}</p>
    ${model.mae!=null?`<p class="form-hint">12 días posteriores: error medio ${model.mae.toFixed(1)} frente a ${model.baseline.toFixed(1)} puntos /10. Debe mejorar en ambas mitades de la prueba.</p>`:''}
    ${model.prediction!=null?`<p>Dolor diario estimado: ${model.prediction}/10. Calculado con contexto previo, sin usar el dolor declarado de este día. Error histórico medio ±${model.mae.toFixed(1)}; no es un intervalo garantizado.</p>`:''}
    ${patterns.length?patterns.map(p=>`<p>Con ${esc(p.label)} por encima de tu referencia (${p.threshold.toFixed(1)}), el dolor del día siguiente difiere ${p.difference>=0?'+':''}${p.difference.toFixed(1)} puntos /10: ${p.high} frente a ${p.low} días.</p>`).join(''):'<p class="form-hint">Sin pares suficientes para comparar fibra, sueño, estrés o medicación con dolor posterior.</p>'}
    <details><summary>Cómo interpretar el análisis</summary><p>Asociaciones observacionales, sin ajuste causal completo: comidas y dosis, estrés, sueño y medicación pueden coincidir. No prueban que un alimento cause síntomas. El modelo local k-NN usa dolor, hinchazón y estrés del día anterior; las otras variables se comparan por separado. Exige 32 pares y reduce el error al menos un 10 % frente al promedio y al dolor anterior, con estabilidad en dos ventanas. No extrapola ante contexto alejado ni señales de alarma. No estima microbiota, intolerancias o disbiosis.</p>${link('consensus')}</details></section>
    <details class="data-card" id="gutProbiotics"><summary>Mis probióticos</summary><p>Registrar no equivale a recomendar. Verifica especie, cepa y UFC con la etiqueta; más UFC no significa mayor beneficio. Si estás inmunodeprimido o gravemente enfermo, consúltalo antes con tu profesional.</p>
    <div id="gutProductList">${state.probiotics.map((p,i)=>`<div class="gut-product"><b>${esc(p.name)}</b><p>${esc(p.species||'Especie desconocida')} · ${esc(p.strain||'Cepa desconocida')} · ${esc(p.cfu||'UFC desconocidas')}${p.expiry&&p.expiry<date?' · vencimiento superado':''}</p><label class="learning-toggle"><input type="checkbox" data-gut-taken="${i}" ${p.taken?.[date]===true?'checked':''}> Toma declarada en ${esc(date)}</label><button class="btn-link" type="button" data-gut-product="${i}">Editar ficha</button></div>`).join('')||'<p class="form-hint">Sin productos registrados.</p>'}</div>
    <form id="gutProductForm"><input id="p_index" type="hidden" value=""><h3 id="p_heading">Registrar producto</h3>
    ${field('p_name','Nombre del producto','','text','required maxlength="120"')}${field('p_species','Especie(s)')}${field('p_strain','Cepa(s) exacta(s)')}${field('p_cfu','UFC por dosis (vacío si no lo sabes)','','number','min="1" step="any" inputmode="decimal"')}${field('p_dose','Dosis de la etiqueta o indicada por tu profesional')}${field('p_storage','Conservación indicada')}${field('p_reason','Motivo de uso')}
    <div class="row-2">${field('p_start','Inicio','','date')}${field('p_end','Finalización','','date')}${field('p_expiry','Vencimiento','','date')}</div>${field('p_evidence','Enlace de evidencia: PubMed, PMC, AGA o WGO','','url')}<p class="form-hint">La evidencia debe corresponder a la misma cepa, dosis, indicación y población. Un enlace no verifica que este producto sea equivalente.</p><button class="btn-primary" type="submit">Guardar ficha</button></form>
    ${link('wgo')}<p>AGA restringe probióticos en intestino irritable al contexto de ensayos y no los recomienda para tratar distensión. Otras guías admiten beneficios específicos; no hay un producto universal.</p>${link('aga')} · ${link('bloating')}</details>
    <details class="data-card"><summary>Qué respalda la evidencia</summary><p>La fibra soluble puede ayudar en intestino irritable; aumentar gradualmente según tolerancia. No toda fibra es prebiótica ni todos los fermentados contienen cultivos vivos o cepas probióticas con beneficio demostrado.</p>${link('fiber')} · ${link('isapp')}<p>El ensayo de Stanford en 36 adultos sanos encontró cambios de diversidad y algunos marcadores inflamatorios con fermentados; no demuestra curación individual ni permite estimar bacterias desde la app.</p>${link('stanford')}<p>FODMAP: una intervención clínica temporal, con profesional, reintroducción y personalización; no una eliminación automática de grupos. Las guías describen una fase restrictiva de hasta 4–6 semanas.</p>${link('diet')}</details>
    <button class="btn-ghost" id="gutExport" type="button">Descargar reporte digestivo para consulta</button>`;
  host.querySelector('#gutBack').onclick=onBack;host.querySelector('#gutRegister').onclick=onRegister;
  host.querySelectorAll('[data-gut-edit]').forEach(button=>button.onclick=()=>onEdit(entries.find(e=>e.id===button.dataset.gutEdit)));
  host.querySelector('#gutDayForm').onsubmit=ev=>{
    ev.preventDefault();const next={};
    for(const key of ['pain','bloating','stress']){const input=host.querySelector('#g_'+key);if(!input.reportValidity())return;next[key]=input.value===''?null:Number(input.value);}
    for(const key of ['blood','persistentPain','weightLoss','medicationTaken'])next[key]=readChoice(host.querySelector('#g_'+key));
    next.medication=host.querySelector('#g_medication').value.trim();state.days[date]=next;
    if(save()){redraw();host.querySelector('#gutContext').open=true;host.querySelector('#gutStatus').textContent='Contexto guardado en este dispositivo';}
  };
  host.querySelector('#gutSmall').onclick=()=>{
    const value=host.querySelector('#gutToleranceFood').value;if(value==='')return;
    const f=catalog[Number(value)],key=f.usda_fdc_id?'fdc:'+f.usda_fdc_id:'id:'+f.id;state.tolerance[key]={name:f.name,portion:'small'};
    if(save())redraw();
  };
  host.querySelectorAll('[data-clear-tolerance]').forEach(button=>button.onclick=()=>{delete state.tolerance[button.dataset.clearTolerance];if(save())redraw();});
  host.querySelectorAll('[data-gut-taken]').forEach(input=>input.onchange=()=>{const p=state.probiotics[Number(input.dataset.gutTaken)];p.taken||={};p.taken[date]=input.checked;if(!save())input.checked=!input.checked;});
  host.querySelectorAll('[data-gut-product]').forEach(button=>button.onclick=()=>{
    const i=Number(button.dataset.gutProduct),p=state.probiotics[i];host.querySelector('#p_index').value=i;host.querySelector('#p_heading').textContent='Editar ficha';
    for(const key of ['name','species','strain','cfu','dose','storage','reason','start','end','expiry','evidence'])host.querySelector('#p_'+key).value=p[key]??'';
    host.querySelector('#gutProductForm').scrollIntoView({block:'start'});
  });
  host.querySelector('#gutProductForm').onsubmit=ev=>{
    ev.preventDefault();const value=host.querySelector('#p_index').value,p={};
    for(const key of ['name','species','strain','cfu','dose','storage','reason','start','end','expiry','evidence'])p[key]=host.querySelector('#p_'+key).value.trim();
    const error=validateProbiotic(p);if(error){host.querySelector('#gutStatus').textContent=error;return;}
    if(value==='')state.probiotics.push({...p,id:crypto.randomUUID(),taken:{}});else state.probiotics[Number(value)]={...state.probiotics[Number(value)],...p};
    if(save()){redraw();host.querySelector('#gutProbiotics').open=true;host.querySelector('#gutStatus').textContent='Ficha guardada en este dispositivo';}
  };
  host.querySelector('#gutExport').onclick=()=>onDownload(buildDigestiveReport({date,entries,state,foods}));
}
