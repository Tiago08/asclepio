import { supabase } from './supabaseClient.js';
import { sendMagicLink, signOut, getSession, onAuthChange, ensureProfile, getMyProfile, updateDisplayName } from './auth.js';
import {
  NUTRIENT_FIELDS, searchUsda, searchLocalFoods, searchFavorites,
  cacheUsdaFood, addCustomFood, logFood, deleteFoodLog
} from './foods.js';
import { logActivity, deleteActivityLog, getEntriesForDate, getEntriesInRange, getRanking } from './activity.js';
import { buildReportText, downloadText } from './report.js';

/* ================= config por tipo de actividad (no-comida) ================= */

const TYPES = {
  gym: {
    label: 'Gym', icon: '🏋️', color: 'var(--c-gym)',
    fields: [
      { key:'fue', label:'¿Fuiste?', type:'bool', default:true },
      { key:'entreno', label:'Qué entrenaste', type:'text', placeholder:'pierna, espalda...', showIf: d => d.fue },
      { key:'duracion', label:'Duración (min)', type:'number', placeholder:'60', showIf: d => d.fue }
    ],
    summary: d => d.fue === false ? 'No fue' : `${d.entreno || 'Entrenamiento'}${d.duracion ? ' · ' + d.duracion + ' min' : ''}`
  },
  bano: {
    label: 'Baño', icon: '🚽', color: 'var(--c-bano)',
    fields: [{ key:'nota', label:'Nota (opcional)', type:'text', placeholder:'' }],
    summary: d => d.nota ? d.nota : 'Registrado'
  },
  sueno: {
    label: 'Sueño', icon: '🌙', color: 'var(--c-sueno)',
    fields: [
      { key:'dejoTelefono', label:'Dejaste el teléfono', type:'time' },
      { key:'horaDormir', label:'Te dormiste', type:'time' },
      { key:'horaDespertar', label:'Te despertaste', type:'time' },
      { key:'calidad', label:'Calidad', type:'scale', max:5, default:3 }
    ],
    summary: d => `${d.horaDormir || '?'} → ${d.horaDespertar || '?'}${d.calidad ? ' · calidad ' + d.calidad + '/5' : ''}`
  },
  energia: {
    label: 'Energía', icon: '⚡', color: 'var(--c-energia)',
    fields: [
      { key:'nivel', label:'Nivel', type:'scale', max:5, default:3 },
      { key:'momento', label:'Momento del día', type:'select', options:['Mañana','Tarde','Noche'], default:'Tarde' },
      { key:'nota', label:'Nota (opcional)', type:'text' }
    ],
    summary: d => `${d.momento || ''}: ${d.nivel || '?'}/5${d.nota ? ' · ' + d.nota : ''}`
  },
  nota: {
    label: 'Nota', icon: '📝', color: 'var(--c-nota)',
    fields: [{ key:'texto', label:'Texto', type:'textarea', required:true }],
    summary: d => d.texto || ''
  }
};

const CAT_COLOR = {
  comida: 'var(--c-comida)', gym: 'var(--c-gym)', bano: 'var(--c-bano)',
  sueno: 'var(--c-sueno)', energia: 'var(--c-energia)', nota: 'var(--c-nota)'
};
const CAT_LABEL = { comida: 'Comida', gym: 'Gym', bano: 'Baño', sueno: 'Sueño', energia: 'Energía', nota: 'Nota' };

/* ================= estado ================= */

let session = null;
let user = null;
let profile = null;

/* ================= utilidades de fecha ================= */

function pad(n){ return n.toString().padStart(2,'0'); }
function todayStr(){ const d = new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function nowStr(){ const d = new Date(); return pad(d.getHours())+':'+pad(d.getMinutes()); }
function daysAgoStr(n){ const d = new Date(); d.setDate(d.getDate()-n); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function guessMomento(){
  const h = new Date().getHours();
  if(h < 11) return 'Desayuno';
  if(h < 16) return 'Almuerzo';
  if(h < 21) return 'Cena';
  return 'Snack';
}

/* ================= DOM refs ================= */

const loginScreen = document.getElementById('loginScreen');
const appShell = document.getElementById('appShell');
const loginEmail = document.getElementById('loginEmail');
const loginBtn = document.getElementById('loginBtn');
const loginStatus = document.getElementById('loginStatus');
const logoutBtn = document.getElementById('logoutBtn');
const todayDateEl = document.getElementById('todayDate');
const statStrip = document.getElementById('statStrip');
const ringRow = document.getElementById('ringRow');
const insightArea = document.getElementById('insightArea');
const favoritesRow = document.getElementById('favoritesRow');
const quickGrid = document.getElementById('quickGrid');
const formArea = document.getElementById('formArea');
const toastEl = document.getElementById('toast');

function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1600);
}
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/* ================= login ================= */

loginBtn.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  if(!email){ loginStatus.textContent = 'Escribe tu correo.'; loginStatus.classList.add('error'); return; }
  loginBtn.disabled = true;
  loginStatus.classList.remove('error');
  loginStatus.innerHTML = '<span class="spinner"></span> enviando...';
  try{
    await sendMagicLink(email);
    loginStatus.textContent = 'Revisa tu correo y toca el link para entrar.';
  }catch(err){
    loginStatus.textContent = 'No se pudo enviar: ' + err.message;
    loginStatus.classList.add('error');
  }finally{
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  await signOut();
});

onAuthChange(async (s) => {
  session = s;
  if(session){
    user = session.user;
    loginScreen.classList.add('hidden');
    appShell.classList.remove('hidden');
    await bootApp();
  }else{
    user = null; profile = null;
    appShell.classList.add('hidden');
    loginScreen.classList.remove('hidden');
  }
});

/* ================= boot ================= */

async function bootApp(){
  todayDateEl.textContent = new Date().toLocaleDateString('es-VE', { weekday:'short', day:'numeric', month:'short' });
  try{
    await ensureProfile(user);
    profile = await getMyProfile(user.id);
  }catch(err){
    showToast('Error cargando perfil: ' + err.message);
    return;
  }
  document.getElementById('displayNameInput').value = profile.display_name;
  renderQuickGrid();
  await Promise.all([renderFavorites(), renderToday(), renderStats(), renderRanking()]);
  renderHistoryPlaceholder();
}

/* ================= quick grid ================= */

function renderQuickGrid(){
  quickGrid.innerHTML = '';
  const comidaBtn = document.createElement('button');
  comidaBtn.className = 'quick-btn';
  comidaBtn.style.setProperty('--cat-color', CAT_COLOR.comida);
  comidaBtn.innerHTML = `<span class="ic">🍽️</span><span class="lb">Comida</span>`;
  comidaBtn.addEventListener('click', openFoodForm);
  quickGrid.appendChild(comidaBtn);

  Object.keys(TYPES).forEach(typeKey => {
    const t = TYPES[typeKey];
    const btn = document.createElement('button');
    btn.className = 'quick-btn';
    btn.style.setProperty('--cat-color', t.color);
    btn.innerHTML = `<span class="ic">${t.icon}</span><span class="lb">${t.label}</span>`;
    btn.addEventListener('click', () => openActivityForm(typeKey));
    quickGrid.appendChild(btn);
  });
}

/* ================= favoritos (1-toque) ================= */

async function renderFavorites(){
  try{
    const favs = await searchFavorites(user.id, 6);
    if(favs.length === 0){ favoritesRow.innerHTML = ''; return; }
    favoritesRow.innerHTML = favs.map(f => `<button class="fav-chip" data-fav="${f.id}">${escapeHtml(f.name)}</button>`).join('');
    favoritesRow.querySelectorAll('[data-fav]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const food = favs.find(f => f.id === btn.dataset.fav);
        btn.classList.add('pulse');
        try{
          await logFood({ userId: user.id, foodRow: food, quantity: 1, momento: guessMomento(), date: todayStr(), time: nowStr() });
          showToast(`${food.name} registrado`);
          await refreshAfterLog();
        }catch(err){ showToast('Error: ' + err.message); }
      });
    });
  }catch(err){ /* silencioso: favoritos no son críticos */ }
}

/* ================= formulario: actividades (no-comida) ================= */

function openActivityForm(typeKey){
  const t = TYPES[typeKey];
  const data = {};
  t.fields.forEach(f => { if(f.default !== undefined) data[f.key] = f.default; });

  formArea.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', t.color);

  const heading = document.createElement('h3');
  heading.innerHTML = `<span>${t.icon}</span> ${t.label}`;
  card.appendChild(heading);

  const rowDT = document.createElement('div');
  rowDT.className = 'row-2';
  rowDT.innerHTML = `
    <div class="field"><label>Fecha</label><input type="date" id="f_fecha" value="${todayStr()}"></div>
    <div class="field"><label>Hora</label><input type="time" id="f_hora" value="${nowStr()}"></div>`;
  card.appendChild(rowDT);

  const fieldsWrap = document.createElement('div');
  card.appendChild(fieldsWrap);

  function renderFields(){
    fieldsWrap.innerHTML = '';
    t.fields.forEach(f => {
      if(f.showIf && !f.showIf(data)) return;
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.textContent = f.label;
      wrap.appendChild(label);

      if(f.type === 'text'){
        const inp = document.createElement('input'); inp.type = 'text';
        inp.placeholder = f.placeholder || ''; inp.value = data[f.key] || '';
        inp.addEventListener('input', () => { data[f.key] = inp.value; });
        wrap.appendChild(inp);
      } else if(f.type === 'textarea'){
        const inp = document.createElement('textarea');
        inp.placeholder = f.placeholder || ''; inp.value = data[f.key] || '';
        inp.addEventListener('input', () => { data[f.key] = inp.value; });
        wrap.appendChild(inp);
      } else if(f.type === 'number'){
        const inp = document.createElement('input'); inp.type = 'number';
        inp.placeholder = f.placeholder || ''; inp.value = data[f.key] || '';
        inp.addEventListener('input', () => { data[f.key] = inp.value; });
        wrap.appendChild(inp);
      } else if(f.type === 'time'){
        const inp = document.createElement('input'); inp.type = 'time'; inp.value = data[f.key] || '';
        inp.addEventListener('input', () => { data[f.key] = inp.value; });
        wrap.appendChild(inp);
      } else if(f.type === 'select'){
        const sel = document.createElement('select');
        f.options.forEach(opt => {
          const o = document.createElement('option'); o.value = opt; o.textContent = opt;
          if((data[f.key] || f.default) === opt) o.selected = true;
          sel.appendChild(o);
        });
        data[f.key] = data[f.key] || f.default;
        sel.addEventListener('change', () => { data[f.key] = sel.value; });
        wrap.appendChild(sel);
      } else if(f.type === 'bool'){
        const row = document.createElement('div'); row.className = 'toggle-pair';
        ['Sí','No'].forEach(opt => {
          const b = document.createElement('button'); b.type = 'button';
          b.className = 'pill-btn' + (((data[f.key] ?? f.default) === (opt === 'Sí')) ? ' selected' : '');
          b.textContent = opt;
          b.addEventListener('click', () => { data[f.key] = (opt === 'Sí'); renderFields(); });
          row.appendChild(b);
        });
        wrap.appendChild(row);
      } else if(f.type === 'scale'){
        const row = document.createElement('div'); row.className = 'scale-row';
        for(let i=1;i<=f.max;i++){
          const b = document.createElement('button'); b.type = 'button';
          b.className = 'pill-btn' + ((data[f.key] === i) ? ' selected' : '');
          b.textContent = i;
          b.addEventListener('click', () => { data[f.key] = i; renderFields(); });
          row.appendChild(b);
        }
        wrap.appendChild(row);
      }
      fieldsWrap.appendChild(wrap);
    });
  }
  renderFields();

  const actions = document.createElement('div');
  actions.className = 'form-actions';
  actions.innerHTML = `<button class="btn-ghost" id="cancelBtn">Cancelar</button><button class="btn-primary" id="saveBtn">Guardar</button>`;
  card.appendChild(actions);
  formArea.appendChild(card);

  card.querySelector('#cancelBtn').addEventListener('click', closeForm);
  card.querySelector('#saveBtn').addEventListener('click', async () => {
    const required = t.fields.filter(f => f.required && (!f.showIf || f.showIf(data)));
    for(const f of required){
      if(!data[f.key] || (typeof data[f.key] === 'string' && !data[f.key].trim())){
        showToast(`Falta: ${f.label}`); return;
      }
    }
    const fecha = document.getElementById('f_fecha').value || todayStr();
    const hora = document.getElementById('f_hora').value || nowStr();
    const saveBtn = card.querySelector('#saveBtn');
    saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
    try{
      await logActivity({ userId: user.id, type: typeKey, date: fecha, time: hora, data });
      closeForm();
      showToast('Guardado');
      await refreshAfterLog();
    }catch(err){
      showToast('Error: ' + err.message);
      saveBtn.disabled = false; saveBtn.textContent = 'Guardar';
    }
  });

  card.scrollIntoView({ behavior:'smooth', block:'start' });
}

function closeForm(){ formArea.innerHTML = ''; }

/* ================= formulario: comida (búsqueda USDA + local) ================= */

function openFoodForm(){
  formArea.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);
  card.innerHTML = `
    <h3><span>🍽️</span> Comida</h3>
    <div class="field">
      <label>Buscar alimento</label>
      <input type="text" id="foodSearchInput" placeholder="arepa, arroz, Savoy...">
    </div>
    <div id="foodSearchResults"></div>
    <button class="add-new-food-btn" id="addNewFoodBtn" type="button">+ agregar un alimento nuevo</button>
    <div class="form-actions">
      <button class="btn-ghost" id="cancelFoodBtn">Cancelar</button>
    </div>
  `;
  formArea.appendChild(card);
  card.querySelector('#cancelFoodBtn').addEventListener('click', closeForm);
  card.querySelector('#addNewFoodBtn').addEventListener('click', openNewFoodForm);

  const input = card.querySelector('#foodSearchInput');
  const resultsWrap = card.querySelector('#foodSearchResults');
  let debounceTimer = null;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if(q.length < 2){ resultsWrap.innerHTML = ''; return; }
    debounceTimer = setTimeout(() => runFoodSearch(q, resultsWrap), 350);
  });

  input.focus();
}

async function runFoodSearch(query, resultsWrap){
  resultsWrap.innerHTML = `<div class="search-empty"><span class="spinner"></span> buscando...</div>`;
  let local = [], usda = [];
  try{
    [local, usda] = await Promise.all([
      searchLocalFoods(query).catch(() => []),
      searchUsda(query, user.email).catch(() => [])
    ]);
  }catch(err){ /* ya atrapado arriba */ }

  // evita duplicar un alimento local que ya es copia cacheada de un fdcId que también salió en USDA
  const cachedFdcIds = new Set(local.filter(f => f.source === 'usda').map(f => f.usda_fdc_id));
  usda = usda.filter(f => !cachedFdcIds.has(f.usda_fdc_id));

  const all = [...local, ...usda];
  if(all.length === 0){
    resultsWrap.innerHTML = `<div class="search-empty">Sin resultados. Puedes agregarlo como alimento nuevo.</div>`;
    return;
  }
  resultsWrap.innerHTML = `<div class="food-search-results">${all.map((f, i) => `
    <div class="food-result" data-idx="${i}">
      <div class="fr-name">${escapeHtml(f.name)}</div>
      <div class="fr-meta">${f.kcal != null ? f.kcal + ' kcal' : 'sin kcal'} · ${escapeHtml(f.serving_label)}${f.brand ? ' · ' + escapeHtml(f.brand) : ''}</div>
    </div>`).join('')}</div>`;

  resultsWrap.querySelectorAll('[data-idx]').forEach(el => {
    el.addEventListener('click', () => openQuantityStep(all[Number(el.dataset.idx)]));
  });
}

async function openQuantityStep(foodResult){
  formArea.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);

  const momento = guessMomento();
  card.innerHTML = `
    <h3><span>🍽️</span> Comida</h3>
    <div class="selected-food-card">
      <button class="sf-change" id="changeFoodBtn" type="button">cambiar</button>
      <div class="sf-name">${escapeHtml(foodResult.name)}</div>
      <div class="sf-sub">${escapeHtml(foodResult.serving_label)} · ${foodResult.kcal != null ? foodResult.kcal + ' kcal / porción' : 'sin datos de kcal'}</div>
    </div>
    <div class="row-2">
      <div class="field"><label>Fecha</label><input type="date" id="f_fecha" value="${todayStr()}"></div>
      <div class="field"><label>Hora</label><input type="time" id="f_hora" value="${nowStr()}"></div>
    </div>
    <div class="field">
      <label>Momento</label>
      <select id="f_momento">
        ${['Desayuno','Almuerzo','Cena','Snack'].map(o => `<option value="${o}" ${o===momento?'selected':''}>${o}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Cantidad (en porciones de ${escapeHtml(foodResult.serving_label)})</label>
      <input type="number" id="f_qty" value="1" min="0.1" step="0.1">
    </div>
    <div class="form-actions">
      <button class="btn-ghost" id="cancelBtn">Cancelar</button>
      <button class="btn-primary" id="saveBtn" style="--cat-color: var(--c-comida)">Guardar</button>
    </div>
  `;
  formArea.appendChild(card);

  card.querySelector('#changeFoodBtn').addEventListener('click', openFoodForm);
  card.querySelector('#cancelBtn').addEventListener('click', closeForm);
  card.querySelector('#saveBtn').addEventListener('click', async () => {
    const saveBtn = card.querySelector('#saveBtn');
    saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
    try{
      let foodRow = foodResult;
      if(foodResult.source === 'usda' && !foodResult.id){
        foodRow = await cacheUsdaFood(foodResult, user.id);
      }
      const qty = Number(card.querySelector('#f_qty').value) || 1;
      const fecha = card.querySelector('#f_fecha').value || todayStr();
      const hora = card.querySelector('#f_hora').value || nowStr();
      const momentoVal = card.querySelector('#f_momento').value;
      await logFood({ userId: user.id, foodRow, quantity: qty, momento: momentoVal, date: fecha, time: hora });
      closeForm();
      showToast('Comida registrada');
      await refreshAfterLog();
    }catch(err){
      showToast('Error: ' + err.message);
      saveBtn.disabled = false; saveBtn.textContent = 'Guardar';
    }
  });
}

function openNewFoodForm(){
  formArea.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);

  const nutrientInputs = NUTRIENT_FIELDS.map(f => `
    <div class="field">
      <label>${f.label} (${f.unit})</label>
      <input type="number" step="0.1" data-nutri="${f.key}" placeholder="opcional">
    </div>`).join('');

  card.innerHTML = `
    <h3><span>🍽️</span> Alimento nuevo</h3>
    <div class="field"><label>Nombre</label><input type="text" id="nf_name" placeholder="Ej: Arepa de maíz"></div>
    <div class="row-2">
      <div class="field"><label>Categoría</label><input type="text" id="nf_cat" placeholder="Ej: Panadería"></div>
      <div class="field"><label>Porción de referencia</label><input type="text" id="nf_serving" placeholder="Ej: 100 g, 1 unidad" value="100 g"></div>
    </div>
    <p style="font-size:12px; color:var(--text-dim); margin: 2px 0 10px;">Los valores de abajo son por esa porción de referencia. Deja en blanco lo que no sepas — lo puedes completar después.</p>
    ${nutrientInputs}
    <div class="form-actions">
      <button class="btn-ghost" id="cancelBtn">Cancelar</button>
      <button class="btn-primary" id="saveBtn" style="--cat-color: var(--c-comida)">Guardar y continuar</button>
    </div>
  `;
  formArea.appendChild(card);

  card.querySelector('#cancelBtn').addEventListener('click', openFoodForm);
  card.querySelector('#saveBtn').addEventListener('click', async () => {
    const name = card.querySelector('#nf_name').value.trim();
    if(!name){ showToast('Falta el nombre'); return; }
    const fields = {
      name,
      category: card.querySelector('#nf_cat').value.trim() || null,
      serving_label: card.querySelector('#nf_serving').value.trim() || '100 g'
    };
    NUTRIENT_FIELDS.forEach(f => {
      const v = card.querySelector(`[data-nutri="${f.key}"]`).value;
      fields[f.key] = v === '' ? null : Number(v);
    });
    const saveBtn = card.querySelector('#saveBtn');
    saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
    try{
      const foodRow = await addCustomFood(fields, user.id);
      showToast('Alimento agregado');
      await openQuantityStep(foodRow);
    }catch(err){
      showToast('Error: ' + err.message);
      saveBtn.disabled = false; saveBtn.textContent = 'Guardar y continuar';
    }
  });
}

/* ================= tabs ================= */

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    if(btn.dataset.tab === 'historial') await renderHistory();
    if(btn.dataset.tab === 'ranking') await renderRanking();
  });
});

/* ================= timeline ================= */

function entryRow(e){
  const color = CAT_COLOR[e.kind === 'food' ? 'comida' : e.type];
  const label = CAT_LABEL[e.kind === 'food' ? 'comida' : e.type];
  let summary = '';
  if(e.kind === 'food'){
    const d = e.data;
    summary = `${d.momento}: ${escapeHtml(d.food_name_snapshot)} x${d.quantity}${d.kcal != null ? ` · ${Math.round(d.kcal)} kcal` : ''}`;
  } else {
    const t = TYPES[e.type];
    summary = escapeHtml(t ? t.summary(e.data) : '');
  }
  const delAttr = e.kind === 'food' ? `data-del-food="${e.id}"` : `data-del-activity="${e.id}"`;
  return `
    <div class="entry" style="--cat-color:${color}">
      <button class="entry-del" ${delAttr} aria-label="Eliminar">eliminar</button>
      <div class="entry-top"><span class="entry-time mono">${e.time}</span><span class="entry-type">${label}</span></div>
      <div class="entry-summary">${summary}</div>
    </div>`;
}

async function renderToday(){
  const wrap = document.getElementById('todayTimeline');
  wrap.innerHTML = `<div class="search-empty"><span class="spinner"></span> cargando...</div>`;
  try{
    const list = await getEntriesForDate(user.id, todayStr());
    if(list.length === 0){
      wrap.innerHTML = `<div class="empty-state">Nada registrado todavía hoy.<br>Usa los botones de arriba.</div>`;
    } else {
      wrap.innerHTML = `<div class="timeline">${list.map(entryRow).join('')}</div>`;
    }
    renderRings(list.filter(e => e.kind === 'food'));
  }catch(err){
    wrap.innerHTML = `<div class="empty-state">Error cargando: ${escapeHtml(err.message)}</div>`;
    renderRings([]);
  }
}

function renderHistoryPlaceholder(){
  document.getElementById('historyList').innerHTML = `<div class="empty-state">Abre esta pestaña para cargar tu historial.</div>`;
}

async function renderHistory(){
  const wrap = document.getElementById('historyList');
  wrap.innerHTML = `<div class="search-empty"><span class="spinner"></span> cargando...</div>`;
  try{
    const list = await getEntriesInRange(user.id, daysAgoStr(60), todayStr());
    const byDate = {};
    list.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
    const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));
    if(dates.length === 0){ wrap.innerHTML = `<div class="empty-state">Aún no hay historial.</div>`; return; }
    wrap.innerHTML = dates.map(date => {
      const entries = byDate[date].sort((a,b) => a.time.localeCompare(b.time));
      const label = new Date(date + 'T12:00:00').toLocaleDateString('es-VE', { weekday:'short', day:'numeric', month:'short' });
      return `
        <details class="day-block">
          <summary class="day-summary"><span class="d-date">${label}</span><span class="d-count mono">${entries.length} registro${entries.length===1?'':'s'}</span></summary>
          <div class="day-body"><div class="timeline">${entries.map(entryRow).join('')}</div></div>
        </details>`;
    }).join('');
  }catch(err){
    wrap.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

document.addEventListener('click', async (e) => {
  const delFood = e.target.getAttribute && e.target.getAttribute('data-del-food');
  const delActivity = e.target.getAttribute && e.target.getAttribute('data-del-activity');
  if(delFood){
    try{ await deleteFoodLog(delFood); showToast('Eliminado'); await refreshAfterLog(); await renderHistory(); }
    catch(err){ showToast('Error: ' + err.message); }
  } else if(delActivity){
    try{ await deleteActivityLog(delActivity); showToast('Eliminado'); await refreshAfterLog(); await renderHistory(); }
    catch(err){ showToast('Error: ' + err.message); }
  }
});

/* ================= ranking ================= */

async function renderRanking(){
  const wrap = document.getElementById('rankingList');
  wrap.innerHTML = `<div class="search-empty"><span class="spinner"></span> cargando...</div>`;
  try{
    const rows = await getRanking();
    if(rows.length === 0){ wrap.innerHTML = `<div class="empty-state">Nadie ha registrado nada todavía.</div>`; return; }
    wrap.innerHTML = rows.map((r, i) => `
      <div class="rank-row ${r.id === user.id ? 'me' : ''}">
        <div class="rank-left">
          <span class="rank-pos mono">${i+1}</span>
          <span class="rank-name">${escapeHtml(r.display_name)}${r.id === user.id ? ' (tú)' : ''}</span>
        </div>
        <div style="text-align:right;">
          <div class="rank-streak">${r.streak_current}d</div>
          <div class="rank-best">mejor: ${r.streak_best}d</div>
        </div>
      </div>`).join('');
  }catch(err){
    wrap.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

/* ================= tarjeta de hoy: calorías + macros ================= */

function pctWidth(value, goal){
  if(!goal) return '0%';
  return Math.max(0, Math.min(100, (value / goal) * 100)) + '%';
}

function renderRings(foodEntries){
  if(!profile){ ringRow.innerHTML = ''; return; }
  const totals = { kcal:0, protein_g:0, carbs_g:0, fat_g:0 };
  foodEntries.forEach(e => {
    const d = e.data;
    ['kcal','protein_g','carbs_g','fat_g'].forEach(k => { if(d[k] != null) totals[k] += Number(d[k]); });
  });
  const left = Math.max(0, Math.round(profile.goal_kcal - totals.kcal));
  const macros = [
    { key:'carbs_g', label:'Carbos', color:'var(--c-comida)', goal: profile.goal_carbs_g },
    { key:'protein_g', label:'Proteína', color:'var(--c-gym)', goal: profile.goal_protein_g },
    { key:'fat_g', label:'Grasa', color:'var(--c-sueno)', goal: profile.goal_fat_g }
  ];

  ringRow.innerHTML = `
    <div class="today-card">
      <div class="kh-top">
        <span class="kh-label">Calorías</span>
        <span class="kh-num"><b>${Math.round(totals.kcal)}</b> / ${Math.round(profile.goal_kcal)} · ${left} restantes</span>
      </div>
      <div class="kh-bar"><div class="kh-bar-fill" style="width:${pctWidth(totals.kcal, profile.goal_kcal)}"></div></div>
      <div class="macro-row">
        ${macros.map(m => `
          <div class="macro-item">
            <div class="macro-top"><span>${m.label}</span><b>${Math.round(totals[m.key])}g</b></div>
            <div class="macro-bar"><div class="macro-bar-fill" style="width:${pctWidth(totals[m.key], m.goal)}; background:${m.color};"></div></div>
          </div>`).join('')}
      </div>
    </div>`;
}

/* ================= stats + insights ================= */

async function renderStats(){
  statStrip.innerHTML = `<span class="stat-chip">racha <b>${profile.streak_current}d</b></span>`;
  const fullStats = document.getElementById('fullStats');
  fullStats.innerHTML = `
    <div class="stat-tile"><div class="v mono">${profile.streak_current}</div><div class="l">racha actual (días)</div></div>
    <div class="stat-tile"><div class="v mono">${profile.streak_best}</div><div class="l">mejor racha (días)</div></div>`;

  try{
    const list = await getEntriesInRange(user.id, daysAgoStr(13), todayStr());
    await renderInsight(list);
  }catch(err){ insightArea.innerHTML = ''; }
}

async function renderInsight(entries){
  const byDate = {};
  entries.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });

  const gymDays = new Set(), energiaByDate = {}, sleepHoursByDate = {};
  Object.entries(byDate).forEach(([date, list]) => {
    list.forEach(e => {
      if(e.type === 'gym' && e.data.fue !== false) gymDays.add(date);
      if(e.type === 'energia' && e.data.nivel) {
        energiaByDate[date] = energiaByDate[date] || [];
        energiaByDate[date].push(Number(e.data.nivel));
      }
      if(e.type === 'sueno' && e.data.horaDormir && e.data.horaDespertar){
        const [h1,m1] = e.data.horaDormir.split(':').map(Number);
        const [h2,m2] = e.data.horaDespertar.split(':').map(Number);
        let mins = (h2*60+m2) - (h1*60+m1);
        if(mins < 0) mins += 24*60;
        sleepHoursByDate[date] = mins/60;
      }
    });
  });

  const avgEnergiaOn = (dateSet) => {
    const vals = [...dateSet].flatMap(d => energiaByDate[d] || []);
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
  };

  const allDates = Object.keys(byDate);
  const nonGymDays = allDates.filter(d => !gymDays.has(d));
  const eGym = avgEnergiaOn(gymDays);
  const eNoGym = avgEnergiaOn(nonGymDays);

  let text = null;
  if(gymDays.size >= 3 && nonGymDays.length >= 3 && eGym != null && eNoGym != null && Math.abs(eGym - eNoGym) >= 0.4){
    text = eGym > eNoGym
      ? `Tu energía promedio es <b>${eGym.toFixed(1)}/5</b> los días que vas al gym, vs <b>${eNoGym.toFixed(1)}/5</b> los días que no.`
      : `Tu energía promedio es más baja (<b>${eGym.toFixed(1)}/5</b>) los días que vas al gym que los que no (<b>${eNoGym.toFixed(1)}/5</b>) — vale la pena ver si es por falta de recuperación.`;
  } else {
    // alterna: sueño vs energía del mismo día
    const pairs = Object.keys(sleepHoursByDate).filter(d => energiaByDate[d]);
    if(pairs.length >= 4){
      const highSleep = pairs.filter(d => sleepHoursByDate[d] >= 7);
      const lowSleep = pairs.filter(d => sleepHoursByDate[d] < 7);
      if(highSleep.length >= 2 && lowSleep.length >= 2){
        const avg = (arr) => arr.flatMap(d => energiaByDate[d]).reduce((a,b)=>a+b,0) / arr.flatMap(d => energiaByDate[d]).length;
        const eHigh = avg(highSleep), eLow = avg(lowSleep);
        if(Math.abs(eHigh - eLow) >= 0.4){
          text = `Los días que duermes 7h o más, tu energía promedio es <b>${eHigh.toFixed(1)}/5</b>, contra <b>${eLow.toFixed(1)}/5</b> cuando duermes menos.`;
        }
      }
    }
  }

  insightArea.innerHTML = text ? `<div class="insight-card">${text}</div>` : '';
}

async function refreshAfterLog(){
  try{ profile = await getMyProfile(user.id); }catch(err){}
  await Promise.all([renderToday(), renderStats(), renderFavorites()]);
}

/* ================= perfil / nombre ================= */

document.getElementById('saveNameBtn').addEventListener('click', async () => {
  const val = document.getElementById('displayNameInput').value.trim();
  if(!val) return;
  try{
    await updateDisplayName(user.id, val);
    profile.display_name = val;
    showToast('Nombre actualizado');
  }catch(err){ showToast('Error: ' + err.message); }
});

/* ================= reporte ================= */

document.getElementById('reportBtn').addEventListener('click', async () => {
  const range = document.getElementById('reportRange').value;
  const to = todayStr();
  const from = range === 'week' ? daysAgoStr(6) : to;
  try{
    const entries = await getEntriesInRange(user.id, from, to);
    const text = buildReportText({ displayName: profile.display_name, fromDate: from, toDate: to, entries, profile });
    downloadText(`asclepio-${profile.display_name}-${to}.txt`, text);
  }catch(err){ showToast('Error generando reporte: ' + err.message); }
});

/* ================= arranque ================= */

(async function init(){
  session = await getSession();
  if(session){
    user = session.user;
    loginScreen.classList.add('hidden');
    appShell.classList.remove('hidden');
    await bootApp();
  }
})();
