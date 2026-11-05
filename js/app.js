import { supabase } from './supabaseClient.js?v=8';
import {
  sendMagicLink, verifyEmailCode, signOut, getSession, onAuthChange,
  ensureProfile, getMyProfile, updateDisplayName, updateGoals
} from './auth.js?v=8';
import {
  NUTRIENT_FIELDS, searchUsda, searchLocalFoods, searchFavorites,
  cacheUsdaFood, addCustomFood, logFood, deleteFoodLog, rankFoods, pickForDisplay, translateToSpanish, foodLogLabel
} from './foods.js?v=8';
import { logActivity, deleteActivityLog, getEntriesForDate, getEntriesInRange, getRanking } from './activity.js?v=8';
import { buildReportText, downloadText } from './report.js?v=8';
import { BASICS, searchBasics } from './basics.js?v=8';

/* ================= utilidades de hora ================= */

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

// momento del día para el registro de energía, según la hora del teléfono
function momentoDelDia(){
  const h = new Date().getHours();
  if(h < 12) return 'Mañana';
  if(h < 15) return 'Mediodía';
  if(h < 20) return 'Tarde';
  return 'Noche';
}

function toMin(hhmm){
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
// minutos desde a hasta b, cruzando la medianoche si hace falta
function minsBetween(a, b){
  return (toMin(b) - toMin(a) + 1440) % 1440;
}
function fmtDur(mins){
  const h = Math.floor(mins / 60), m = mins % 60;
  if(h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// duración total y latencia (tiempo entre soltar el teléfono y dormirse)
function calcSleep(d){
  const out = { dur: null, lat: null };
  if(d.horaDormir && d.horaDespertar){
    const m = minsBetween(d.horaDormir, d.horaDespertar);
    if(m > 0 && m <= 16 * 60) out.dur = m;
  }
  if(d.dejoTelefono && d.horaDormir){
    const m = minsBetween(d.dejoTelefono, d.horaDormir);
    if(m <= 6 * 60) out.lat = m;   // más de 6 h probablemente significa que soltó el teléfono después de dormir
  }
  return out;
}

/* ================= config por tipo de actividad (no-comida) ================= */

const TYPES = {
  gym: {
    label: 'Gym', icon: '🏋️', color: 'var(--c-gym)',
    base: { fue: true },
    fields: [
      { key:'tipos', label:'Qué entrenaste', type:'chips', multi:true,
        options:['Push','Pull','Legs','Upper','Lower','Fútbol','Cardio / HIIT'] },
      { key:'rpe', label:'Esfuerzo percibido (RPE 1–10)', type:'scale', max:10 },
      { key:'duracion', label:'Duración (min)', type:'number', placeholder:'60' }
    ],
    restAction: { label:'Hoy es día de descanso', data:{ fue:false } },
    finalize: d => ({ ...d, duracion: d.duracion ? Number(d.duracion) : undefined }),
    summary: d => {
      if(d.fue === false) return 'Día de descanso';
      const tipos = Array.isArray(d.tipos) && d.tipos.length ? d.tipos.join(' + ') : (d.entreno || 'Entrenamiento');
      return `${tipos}${d.duracion ? ' · ' + d.duracion + ' min' : ''}${d.rpe ? ' · RPE ' + d.rpe : ''}`;
    }
  },
  bano: {
    label: 'Baño', icon: '🚽', color: 'var(--c-bano)',
    fields: [
      { key:'tipo', label:'Cómo fue (escala de Bristol)', type:'chips', multi:false,
        options:['Duro (1–2)','Normal (3–4)','Suelto (5–6)','Líquido (7)'] },
      { key:'extras', label:'Además', type:'chips', multi:true, options:['Hinchazón'] },
      { key:'nota', label:'Nota (opcional)', type:'text', placeholder:'' }
    ],
    summary: d => {
      const parts = [];
      if(d.tipo) parts.push(d.tipo);
      if(Array.isArray(d.extras) && d.extras.length) parts.push(d.extras.join(', '));
      if(d.nota) parts.push(d.nota);
      return parts.length ? parts.join(' · ') : 'Registrado';
    }
  },
  sueno: {
    label: 'Sueño', icon: '🌙', color: 'var(--c-sueno)',
    fields: [
      { key:'dejoTelefono', label:'Dejaste el teléfono', type:'time' },
      { key:'horaDormir', label:'Te dormiste', type:'time' },
      { key:'horaDespertar', label:'Te despertaste', type:'time' },
      { key:'_calc', type:'calc' },
      { key:'calidad', label:'Calidad', type:'scale', max:5, default:3 }
    ],
    calc: d => {
      const { dur, lat } = calcSleep(d);
      if(dur == null && lat == null) return 'Completa las horas para calcular duración y latencia.';
      const parts = [];
      parts.push(dur != null ? `Dormiste <b>${fmtDur(dur)}</b>` : 'Duración: falta hora de dormir o despertar');
      parts.push(lat != null ? `Tardaste <b>${fmtDur(lat)}</b> en dormirte tras soltar el teléfono` : 'Latencia: falta hora de soltar el teléfono');
      return parts.join('<br>');
    },
    finalize: d => {
      const { dur, lat } = calcSleep(d);
      const out = { ...d };
      if(dur != null) out.duracion_h = Math.round(dur / 6) / 10;   // horas con 1 decimal
      if(lat != null) out.latencia_min = lat;
      return out;
    },
    summary: d => {
      const dur = d.duracion_h != null ? ` · ${d.duracion_h} h` : '';
      const lat = d.latencia_min != null ? ` · latencia ${d.latencia_min} min` : '';
      return `${d.horaDormir || '?'} → ${d.horaDespertar || '?'}${dur}${lat}${d.calidad ? ' · calidad ' + d.calidad + '/5' : ''}`;
    }
  },
  energia: {
    label: 'Energía', icon: '⚡', color: 'var(--c-energia)',
    fields: [
      { key:'nivel', label:'Nivel', type:'scale', max:5, default:3 },
      { key:'momento', label:'Momento del día', type:'select', options:['Mañana','Mediodía','Tarde','Noche'], default: momentoDelDia },
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
let bootedFor = null;   // evita repetir el arranque cuando Supabase refresca el token

/* ================= DOM refs ================= */

const bootScreen = document.getElementById('bootScreen');
const loginScreen = document.getElementById('loginScreen');
const appShell = document.getElementById('appShell');
const tabBar = document.getElementById('tabBar');
const loginEmail = document.getElementById('loginEmail');
const loginCode = document.getElementById('loginCode');
const loginBtn = document.getElementById('loginBtn');
const verifyBtn = document.getElementById('verifyBtn');
const backToEmailBtn = document.getElementById('backToEmailBtn');
const loginStepEmail = document.getElementById('loginStepEmail');
const loginStepCode = document.getElementById('loginStepCode');
const loginStatus = document.getElementById('loginStatus');
const logoutBtn = document.getElementById('logoutBtn');
const todayDateEl = document.getElementById('todayDate');
const statStrip = document.getElementById('statStrip');
const ringRow = document.getElementById('ringRow');
const insightArea = document.getElementById('insightArea');
const favoritesRow = document.getElementById('favoritesRow');
const quickGrid = document.getElementById('quickGrid');
const formArea = document.getElementById('formArea');
const sheet = document.getElementById('sheet');
const sheetBackdrop = document.getElementById('sheetBackdrop');
const toastEl = document.getElementById('toast');

function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1600);
}
function showError(msg){
  let b = document.getElementById('errBanner');
  if(!b){
    b = document.createElement('div');
    b.id = 'errBanner';
    b.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top) + 8px);z-index:999;background:#5a1d1d;color:#fff;padding:12px 14px;border-radius:12px;font:13px/1.4 system-ui;word-break:break-word';
    b.addEventListener('click', () => b.remove());
    document.body.appendChild(b);
  }
  b.textContent = msg + ' (toca para cerrar)';
}
window.addEventListener('error', e => showError('Error: ' + e.message));
window.addEventListener('unhandledrejection', e => showError('Error: ' + ((e.reason && e.reason.message) || e.reason)));

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/* ================= bottom sheet ================= */

function openSheet(){
  sheet.classList.remove('hidden');
  sheetBackdrop.classList.remove('hidden');
  document.body.classList.add('sheet-open');
  sheet.scrollTop = 0;
}
function resetForm(){
  formArea.innerHTML = '';
  openSheet();
}
function closeForm(){
  formArea.innerHTML = '';
  sheet.classList.add('hidden');
  sheetBackdrop.classList.add('hidden');
  document.body.classList.remove('sheet-open');
}
sheetBackdrop.addEventListener('click', closeForm);

/* ================= login ================= */

let pendingEmail = '';

function setLoginStatus(msg, isError){
  loginStatus.classList.toggle('error', !!isError);
  loginStatus.innerHTML = msg;
}

loginBtn.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  if(!email){ setLoginStatus('Escribe tu correo.', true); return; }
  loginBtn.disabled = true;
  setLoginStatus('<span class="spinner"></span> enviando...');
  try{
    await sendMagicLink(email);
    pendingEmail = email;
    loginStepEmail.classList.add('hidden');
    loginStepCode.classList.remove('hidden');
    loginCode.value = '';
    loginCode.focus();
    setLoginStatus('Te enviamos un correo. Escribe el código que trae (o toca el link del correo).');
  }catch(err){
    setLoginStatus('No se pudo enviar: ' + escapeHtml(err.message), true);
  }finally{
    loginBtn.disabled = false;
  }
});

verifyBtn.addEventListener('click', async () => {
  const code = loginCode.value.trim();
  if(!code){ setLoginStatus('Escribe el código del correo.', true); return; }
  verifyBtn.disabled = true;
  setLoginStatus('<span class="spinner"></span> verificando...');
  try{
    await verifyEmailCode(pendingEmail, code);
    setLoginStatus('');
  }catch(err){
    setLoginStatus('Código inválido o vencido. Pide uno nuevo.', true);
  }finally{
    verifyBtn.disabled = false;
  }
});

backToEmailBtn.addEventListener('click', () => {
  loginStepCode.classList.add('hidden');
  loginStepEmail.classList.remove('hidden');
  setLoginStatus('');
});

logoutBtn.addEventListener('click', async () => {
  await signOut();
});

async function handleSession(s){
  session = s;
  if(s){
    user = s.user;
    if(bootedFor === user.id) return;
    bootedFor = user.id;
    bootScreen.classList.add('hidden');
    loginScreen.classList.add('hidden');
    appShell.classList.remove('hidden');
    tabBar.classList.remove('hidden');
    await bootApp();
  }else{
    user = null; profile = null; bootedFor = null;
    closeForm();
    bootScreen.classList.add('hidden');
    appShell.classList.add('hidden');
    tabBar.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    loginStepCode.classList.add('hidden');
    loginStepEmail.classList.remove('hidden');
    setLoginStatus('');
  }
}

onAuthChange(handleSession);

/* ================= boot ================= */

async function bootApp(){
  todayDateEl.textContent = new Date().toLocaleDateString('es-VE', { weekday:'short', day:'numeric', month:'short' });
  renderQuickGrid();
  try{
    await ensureProfile(user);
    profile = await getMyProfile(user.id);
  }catch(err){
    showError('Error cargando perfil: ' + (err.message || err));
    return;
  }
  document.getElementById('displayNameInput').value = profile.display_name;
  fillGoalInputs();
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

// alimentos que el usuario ya registró (por frecuencia): suben en la búsqueda
// y se muestran al abrir el buscador
let usedFoods = [];
let usedFoodIds = new Set();

async function renderFavorites(){
  try{
    const used = await searchFavorites(user.id, 30);
    usedFoods = used;
    usedFoodIds = new Set(used.map(f => f.id));
    const favs = used.slice(0, 6);
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
  const data = { ...(t.base || {}) };
  t.fields.forEach(f => {
    if(f.default !== undefined) data[f.key] = typeof f.default === 'function' ? f.default() : f.default;
  });

  resetForm();
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

  function refreshCalc(){
    const box = card.querySelector('.calc-box');
    if(box && t.calc) box.innerHTML = t.calc(data);
  }
  function setVal(key, val){
    data[key] = val;
    refreshCalc();
  }

  function renderFields(){
    fieldsWrap.innerHTML = '';
    t.fields.forEach(f => {
      if(f.type === 'calc'){
        const box = document.createElement('div');
        box.className = 'calc-box';
        box.innerHTML = t.calc(data);
        fieldsWrap.appendChild(box);
        return;
      }

      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.textContent = f.label;
      wrap.appendChild(label);

      if(f.type === 'text'){
        const inp = document.createElement('input'); inp.type = 'text';
        inp.placeholder = f.placeholder || ''; inp.value = data[f.key] || '';
        inp.addEventListener('input', () => setVal(f.key, inp.value));
        wrap.appendChild(inp);
      } else if(f.type === 'textarea'){
        const inp = document.createElement('textarea');
        inp.placeholder = f.placeholder || ''; inp.value = data[f.key] || '';
        inp.addEventListener('input', () => setVal(f.key, inp.value));
        wrap.appendChild(inp);
      } else if(f.type === 'number'){
        const inp = document.createElement('input'); inp.type = 'number'; inp.inputMode = 'numeric';
        inp.placeholder = f.placeholder || ''; inp.value = data[f.key] || '';
        inp.addEventListener('input', () => setVal(f.key, inp.value));
        wrap.appendChild(inp);
      } else if(f.type === 'time'){
        const inp = document.createElement('input'); inp.type = 'time'; inp.value = data[f.key] || '';
        inp.addEventListener('input', () => setVal(f.key, inp.value));
        wrap.appendChild(inp);
      } else if(f.type === 'select'){
        const sel = document.createElement('select');
        f.options.forEach(opt => {
          const o = document.createElement('option'); o.value = opt; o.textContent = opt;
          if(data[f.key] === opt) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => setVal(f.key, sel.value));
        wrap.appendChild(sel);
      } else if(f.type === 'chips'){
        const row = document.createElement('div'); row.className = 'chip-row';
        f.options.forEach(opt => {
          const isOn = f.multi ? (data[f.key] || []).includes(opt) : data[f.key] === opt;
          const b = document.createElement('button'); b.type = 'button';
          b.className = 'chip' + (isOn ? ' selected' : '');
          b.textContent = opt;
          b.addEventListener('click', () => {
            if(f.multi){
              const cur = data[f.key] || [];
              data[f.key] = cur.includes(opt) ? cur.filter(x => x !== opt) : [...cur, opt];
            } else {
              data[f.key] = data[f.key] === opt ? null : opt;
            }
            renderFields();
          });
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

  if(t.restAction){
    const rest = document.createElement('button');
    rest.className = 'btn-link'; rest.type = 'button'; rest.id = 'restBtn';
    rest.textContent = t.restAction.label;
    card.appendChild(rest);
  }
  formArea.appendChild(card);

  async function persist(payload, button, idleLabel){
    const fecha = document.getElementById('f_fecha').value || todayStr();
    const hora = document.getElementById('f_hora').value || nowStr();
    button.disabled = true; button.textContent = 'Guardando...';
    try{
      await logActivity({ userId: user.id, type: typeKey, date: fecha, time: hora, data: payload });
      closeForm();
      showToast('Guardado');
      await refreshAfterLog();
    }catch(err){
      showToast('Error: ' + err.message);
      button.disabled = false; button.textContent = idleLabel;
    }
  }

  card.querySelector('#cancelBtn').addEventListener('click', closeForm);
  card.querySelector('#saveBtn').addEventListener('click', async (ev) => {
    const required = t.fields.filter(f => f.required);
    for(const f of required){
      if(!data[f.key] || (typeof data[f.key] === 'string' && !data[f.key].trim())){
        showToast(`Falta: ${f.label}`); return;
      }
    }
    const payload = t.finalize ? t.finalize(data) : { ...data };
    await persist(payload, ev.currentTarget, 'Guardar');
  });
  if(t.restAction){
    card.querySelector('#restBtn').addEventListener('click', (ev) => {
      persist({ ...t.restAction.data }, ev.currentTarget, t.restAction.label);
    });
  }
}

/* ================= formulario: comida ================= */
/* Como MyFitnessPal: al abrir, tus frecuentes; al escribir, tus alimentos y los
   básicos (al instante, sin red); USDA solo si hace falta o si lo pides. */

const MAX_MAIN_RESULTS = 8;   // lista principal corta: tus alimentos + básicos
const MAX_USDA_RESULTS = 15;
// Cada búsqueda lleva un número; si llega la respuesta de una búsqueda vieja
// (el usuario ya escribió otra cosa), se descarta para no pisar la nueva.
let foodSearchSeq = 0;

// básicos por fdcId, para dar porciones caseras a copias ya guardadas en la tabla
const BASICS_BY_FDC = new Map(BASICS.map(b => [b.usda_fdc_id, b]));
function withUnits(f){
  if(f._units || f.source !== 'usda') return f;
  const b = BASICS_BY_FDC.get(f.usda_fdc_id);
  // una copia guardada de un básico sigue siendo básico (✓, porciones y orden)
  return b ? Object.assign(f, { _units: b._units, _kind: 'basic', _rank: b._rank }) : f;
}

function foodMeta(f){
  const kcal = f.kcal != null ? Math.round(f.kcal) + ' kcal' : 'sin kcal';
  return `${f.brand ? escapeHtml(f.brand) + ' · ' : ''}${kcal} · ${escapeHtml(f.serving_label)}`;
}

function foodListHtml(items, offset = 0){
  return items.map((f, i) => `
    <div class="food-result" data-idx="${i + offset}">
      <div class="fr-name">${escapeHtml(f.name)}${f._kind === 'basic' ? ' <span class="fr-check" title="Básico verificado con USDA">✓</span>' : ''}</div>
      <div class="fr-meta">${foodMeta(f)}</div>
    </div>`).join('');
}

function openFoodForm(){
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);
  card.innerHTML = `
    <h3><span>🍽️</span> Comida</h3>
    <div class="field">
      <label>Buscar alimento</label>
      <input type="search" id="foodSearchInput" placeholder="arroz, cambur, Savoy..." autocomplete="off" enterkeyhint="search">
    </div>
    <div id="foodSearchResults"></div>
    <div class="food-extra-actions">
      <button class="add-new-food-btn" id="quickAddBtn" type="button">⚡ Agregar rápido (kcal y macros a mano)</button>
      <button class="add-new-food-btn" id="addNewFoodBtn" type="button">+ Crear un alimento nuevo</button>
    </div>
    <div class="form-actions">
      <button class="btn-ghost" id="cancelFoodBtn">Cancelar</button>
    </div>
  `;
  formArea.appendChild(card);
  card.querySelector('#cancelFoodBtn').addEventListener('click', closeForm);
  card.querySelector('#addNewFoodBtn').addEventListener('click', openNewFoodForm);
  card.querySelector('#quickAddBtn').addEventListener('click', openQuickAddForm);

  const input = card.querySelector('#foodSearchInput');
  const resultsWrap = card.querySelector('#foodSearchResults');
  let debounceTimer = null;

  renderRecentFoods(resultsWrap);
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if(q.length < 2){ foodSearchSeq++; renderRecentFoods(resultsWrap); return; }
    debounceTimer = setTimeout(() => runFoodSearch(q, resultsWrap), 250);
  });

  input.focus();
}

/** Sin escribir nada: lo que más registras, para tocar y listo. */
function renderRecentFoods(resultsWrap){
  const items = usedFoods.slice(0, MAX_MAIN_RESULTS).map(withUnits);
  if(!items.length){
    resultsWrap.innerHTML = `<div class="search-empty">Escribe para buscar. Lo que registres aparecerá aquí la próxima vez.</div>`;
    return;
  }
  resultsWrap.innerHTML = `<div class="search-section-title">Frecuentes</div>
    <div class="food-search-results">${foodListHtml(items)}</div>`;
  resultsWrap.querySelectorAll('[data-idx]').forEach(el => {
    el.addEventListener('click', () => openQuantityStep(items[Number(el.dataset.idx)]));
  });
}

async function runFoodSearch(query, resultsWrap){
  const seq = ++foodSearchSeq;
  const isCurrent = () => seq === foodSearchSeq && resultsWrap.isConnected;

  const basics = searchBasics(query);
  let local = [];
  let usdaState = 'idle'; // idle | loading | done
  let usdaItems = [];

  const render = () => {
    // tus alimentos que ya son copia de un básico se muestran una sola vez
    const localFdc = new Set(local.filter(f => f.source === 'usda').map(f => f.usda_fdc_id));
    const main = rankFoods([...local.map(withUnits), ...basics.filter(b => !localFdc.has(b.usda_fdc_id))],
      query, '', usedFoodIds).slice(0, MAX_MAIN_RESULTS);
    const all = [...main, ...usdaItems];

    let html = main.length
      ? `<div class="food-search-results">${foodListHtml(main)}</div>`
      : (usdaState === 'idle' ? `<div class="search-empty">Nada en tus alimentos ni en los básicos.</div>` : '');
    if(usdaState === 'idle'){
      html += `<button class="more-usda-btn" id="moreUsdaBtn" type="button">Buscar más en USDA ›</button>`;
    }else if(usdaState === 'loading'){
      html += `<div class="search-empty"><span class="spinner"></span> buscando en USDA...</div>`;
    }else if(usdaItems.length){
      html += `<div class="search-section-title">Más resultados (USDA)</div>
        <div class="food-search-results">${foodListHtml(usdaItems, main.length)}</div>`;
    }else{
      html += `<div class="search-empty">USDA tampoco tiene resultados. Puedes crearlo como alimento nuevo.</div>`;
    }
    resultsWrap.innerHTML = html;
    resultsWrap.querySelectorAll('[data-idx]').forEach(el => {
      el.addEventListener('click', () => openQuantityStep(all[Number(el.dataset.idx)]));
    });
    const moreBtn = resultsWrap.querySelector('#moreUsdaBtn');
    if(moreBtn) moreBtn.addEventListener('click', loadUsda);
  };

  const loadUsda = async () => {
    usdaState = 'loading';
    render();
    const { rows, enQuery } = await searchUsda(query, user.email).catch(() => ({ rows: [], enQuery: '' }));
    if(!isCurrent()) return;
    // fuera lo que ya está arriba (tus copias guardadas y los básicos)
    const shownFdc = new Set([...local, ...basics].map(f => f.usda_fdc_id).filter(Boolean));
    const ranked = rankFoods(rows.filter(r => !shownFdc.has(r.usda_fdc_id)), query, enQuery, usedFoodIds);
    usdaItems = pickForDisplay(ranked, MAX_USDA_RESULTS);
    usdaState = 'done';
    render();
    // los nombres que no estaban en caché se traducen y se cambian en su sitio
    usdaItems.forEach(f => {
      if(!f._needsTr) return;
      const before = f.name;
      translateToSpanish(f._en, user.email).then(es => {
        if(es === before || !isCurrent()) return; // sin traducción (sin cuota o sin red)
        f.name = es;
        f._needsTr = false;
        render();
      });
    });
  };

  // 1) básicos: al instante, sin red
  render();
  // 2) tus alimentos (Supabase)
  local = await searchLocalFoods(query).catch(() => []);
  if(!isCurrent()) return;
  render();
  // 3) USDA solo si casi no hay nada; si no, queda el botón
  const localFdc = new Set(local.map(f => f.usda_fdc_id).filter(Boolean));
  const mainCount = local.length + basics.filter(b => !localFdc.has(b.usda_fdc_id)).length;
  if(mainCount < 3) await loadUsda();
}

/* ---- paso de cantidad: unidades caseras y cálculo en vivo ---- */

/** Unidades posibles para un alimento: [{ label, grams|null, def }] (grams null = porción). */
function unitOptions(f){
  const per100 = Number(f.serving_grams) === 100 || /^100\s*g$/i.test(String(f.serving_label || '').trim());
  const opts = [];
  (f._units || []).forEach(u => opts.push({ label: u.label, grams: u.grams, def: 1 }));
  if(per100 || f.serving_grams){
    opts.push({ label: 'g', grams: 1, def: per100 ? 100 : Number(f.serving_grams) });
  }
  if(!per100) opts.unshift({ label: `porción (${f.serving_label})`, grams: null, def: 1 });
  return opts;
}

/** multiplicador de la porción de referencia del alimento */
function quantityFor(f, unit, amount){
  if(unit.grams == null) return amount;
  const base = Number(f.serving_grams) || 100;
  return (amount * unit.grams) / base;
}

function amountLabel(unit, amount){
  const n = Number.isInteger(amount) ? amount : Math.round(amount * 100) / 100;
  if(unit.label === 'g') return `${n} g`;
  if(unit.grams == null) return n === 1 ? '1 porción' : `${n} porciones`;
  return `${n} ${unit.label}`;
}

async function openQuantityStep(foodResult){
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);

  const f = withUnits(foodResult);
  const units = unitOptions(f);
  let unit = units[0];
  const momento = guessMomento();
  card.innerHTML = `
    <h3><span>🍽️</span> Comida</h3>
    <div class="selected-food-card">
      <button class="sf-change" id="changeFoodBtn" type="button">cambiar</button>
      <div class="sf-name">${escapeHtml(f.name)}${f._kind === 'basic' ? ' <span class="fr-check">✓</span>' : ''}</div>
      <div class="sf-sub">${foodMeta(f)}</div>
    </div>
    <div class="field">
      <label>Cantidad</label>
      <div class="qty-row">
        <input type="number" id="f_qty" value="${unit.def}" min="0" step="any" inputmode="decimal">
        <div class="chip-row unit-chips">
          ${units.map((u, i) => `<button type="button" class="chip${i === 0 ? ' selected' : ''}" data-unit="${i}">${escapeHtml(u.label)}${u.grams && u.label !== 'g' ? ` <span class="chip-g">${Math.round(u.grams)} g</span>` : ''}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="calc-box" id="qtyCalc"></div>
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
    <div class="form-actions">
      <button class="btn-ghost" id="cancelBtn">Cancelar</button>
      <button class="btn-primary" id="saveBtn" style="--cat-color: var(--c-comida)">Guardar</button>
    </div>
  `;
  formArea.appendChild(card);

  const qtyInput = card.querySelector('#f_qty');
  const calc = card.querySelector('#qtyCalc');
  const fmt = v => (v == null ? '–' : Math.round(v));
  const updateCalc = () => {
    const q = quantityFor(f, unit, Number(qtyInput.value) || 0);
    const v = k => (f[k] == null ? null : Number(f[k]) * q);
    const grams = unit.grams != null ? Math.round((Number(qtyInput.value) || 0) * unit.grams) : null;
    calc.innerHTML = `<b>${fmt(v('kcal'))} kcal</b>${grams != null && unit.label !== 'g' ? ` · ${grams} g` : ''}
      <br>Proteína <b>${fmt(v('protein_g'))} g</b> · Carbos <b>${fmt(v('carbs_g'))} g</b> · Grasa <b>${fmt(v('fat_g'))} g</b>`;
  };
  card.querySelectorAll('[data-unit]').forEach(btn => {
    btn.addEventListener('click', () => {
      card.querySelectorAll('[data-unit]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      unit = units[Number(btn.dataset.unit)];
      qtyInput.value = unit.def;
      updateCalc();
    });
  });
  qtyInput.addEventListener('input', updateCalc);
  updateCalc();

  card.querySelector('#changeFoodBtn').addEventListener('click', openFoodForm);
  card.querySelector('#cancelBtn').addEventListener('click', closeForm);
  card.querySelector('#saveBtn').addEventListener('click', async () => {
    const amount = Number(qtyInput.value);
    if(!(amount > 0)){ showToast('Escribe una cantidad'); return; }
    const saveBtn = card.querySelector('#saveBtn');
    saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
    try{
      let foodRow = f;
      if(f.source === 'usda' && !f.id){
        foodRow = await cacheUsdaFood(f, user.id, user.email);
      }
      await logFood({
        userId: user.id, foodRow,
        quantity: quantityFor(f, unit, amount),
        label: `${foodRow.name} · ${amountLabel(unit, amount)}`,
        momento: card.querySelector('#f_momento').value,
        date: card.querySelector('#f_fecha').value || todayStr(),
        time: card.querySelector('#f_hora').value || nowStr()
      });
      closeForm();
      showToast('Comida registrada');
      await refreshAfterLog();
    }catch(err){
      showToast('Error: ' + err.message);
      saveBtn.disabled = false; saveBtn.textContent = 'Guardar';
    }
  });
}

/* ---- agregar rápido: kcal y macros a mano, sin crear un alimento ---- */

function openQuickAddForm(){
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);
  const momento = guessMomento();
  card.innerHTML = `
    <h3><span>⚡</span> Agregar rápido</h3>
    <p class="form-hint">Para algo que comes una sola vez: se registra en tu día, pero no se guarda como alimento.</p>
    <div class="field"><label>Descripción (opcional)</label><input type="text" id="qa_name" placeholder="Ej: Cachapa en la carretera"></div>
    <div class="field"><label>Calorías (kcal)</label><input type="number" id="qa_kcal" inputmode="decimal" min="0" step="any"></div>
    <div class="row-3">
      <div class="field"><label>Proteína (g)</label><input type="number" id="qa_protein" inputmode="decimal" min="0" step="any" placeholder="opcional"></div>
      <div class="field"><label>Carbos (g)</label><input type="number" id="qa_carbs" inputmode="decimal" min="0" step="any" placeholder="opcional"></div>
      <div class="field"><label>Grasa (g)</label><input type="number" id="qa_fat" inputmode="decimal" min="0" step="any" placeholder="opcional"></div>
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
    <div class="form-actions">
      <button class="btn-ghost" id="cancelBtn">Volver</button>
      <button class="btn-primary" id="saveBtn" style="--cat-color: var(--c-comida)">Guardar</button>
    </div>
  `;
  formArea.appendChild(card);
  card.querySelector('#cancelBtn').addEventListener('click', openFoodForm);
  card.querySelector('#saveBtn').addEventListener('click', async () => {
    const num = id => { const v = card.querySelector(id).value; return v === '' ? null : Number(v); };
    const kcal = num('#qa_kcal');
    if(kcal == null || kcal < 0){ showToast('Escribe las calorías'); return; }
    const foodRow = { id: null, name: card.querySelector('#qa_name').value.trim() || 'Agregado rápido' };
    NUTRIENT_FIELDS.forEach(nf => { foodRow[nf.key] = null; });
    Object.assign(foodRow, { kcal, protein_g: num('#qa_protein'), carbs_g: num('#qa_carbs'), fat_g: num('#qa_fat') });
    const saveBtn = card.querySelector('#saveBtn');
    saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
    try{
      await logFood({
        userId: user.id, foodRow, quantity: 1,
        momento: card.querySelector('#f_momento').value,
        date: card.querySelector('#f_fecha').value || todayStr(),
        time: card.querySelector('#f_hora').value || nowStr()
      });
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
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);

  const nutrientInputs = NUTRIENT_FIELDS.map(f => `
    <div class="field">
      <label>${f.label} (${f.unit})</label>
      <input type="number" step="0.1" inputmode="decimal" data-nutri="${f.key}" placeholder="opcional">
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
    window.scrollTo({ top: 0 });
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
    summary = `${d.momento}: ${escapeHtml(foodLogLabel(d))}${d.kcal != null ? ` · ${Math.round(d.kcal)} kcal` : ''}`;
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
            <div class="macro-top"><span>${m.label}</span><span><b>${Math.round(totals[m.key])}</b><span class="goal"> / ${Math.round(m.goal)}g</span></span></div>
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
      if(e.type === 'sueno'){
        const { dur } = calcSleep(e.data);
        if(dur != null) sleepHoursByDate[date] = dur / 60;
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

/* ================= perfil / metas ================= */

function fillGoalInputs(){
  document.getElementById('goalKcal').value = Math.round(profile.goal_kcal);
  document.getElementById('goalProtein').value = Math.round(profile.goal_protein_g);
  document.getElementById('goalCarbs').value = Math.round(profile.goal_carbs_g);
  document.getElementById('goalFat').value = Math.round(profile.goal_fat_g);
}

document.getElementById('saveGoalsBtn').addEventListener('click', async () => {
  const goals = {
    goal_kcal: Number(document.getElementById('goalKcal').value),
    goal_protein_g: Number(document.getElementById('goalProtein').value),
    goal_carbs_g: Number(document.getElementById('goalCarbs').value),
    goal_fat_g: Number(document.getElementById('goalFat').value)
  };
  if(Object.values(goals).some(v => !Number.isFinite(v) || v <= 0)){
    showToast('Todas las metas deben ser mayores a 0');
    return;
  }
  try{
    await updateGoals(user.id, goals);
    profile = { ...profile, ...goals };
    await renderToday();
    showToast('Metas guardadas');
  }catch(err){ showToast('Error: ' + err.message); }
});

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
  let s = null;
  try{ s = await getSession(); }
  catch(err){ /* sin red o token inválido: mejor el login que la pantalla de carga eterna */ }
  await handleSession(s);
})();
