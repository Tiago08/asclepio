import { supabase } from './supabaseClient.js?v=13';
import {
  sendMagicLink, verifyEmailCode, signOut, getSession, onAuthChange,
  ensureProfile, getMyProfile, updateDisplayName, updateGoals
} from './auth.js?v=13';
import {
  NUTRIENT_FIELDS, MICRO_FIELDS, searchUsda, searchLocalFoods, searchFavorites, updateFood,
  cacheUsdaFood, addCustomFood, logFood, deleteFoodLog, rankFoods, pickForDisplay, translateToSpanish, foodLogLabel, pluralEs
} from './foods.js?v=13';
import { logActivity, deleteActivityLog, getEntriesForDate, getEntriesInRange, getRanking } from './activity.js?v=13';
import { buildReportText, downloadText } from './report.js?v=13';
import { BASICS, searchBasics } from './basics.js?v=13';
import {
  getGoalHistory, saveGoalsFrom, goalsForDate, getBodyProfile, saveBodyProfile, suggestGoals, PACES, paceOf, objectiveOf,
  getWeights, saveWeight, deleteWeight, getSupplements, addSupplement, retireSupplement,
  getSupplementLogs, getSupplementLogsInRange, setSupplementTaken, getWaterLogs, addWater, deleteWater,
  electrolyteTotals, getCombos, createCombo, deleteCombo
} from './health.js?v=13';

/* ================= utilidades de hora ================= */

function pad(n){ return n.toString().padStart(2,'0'); }
function todayStr(){ const d = new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function nowStr(){ const d = new Date(); return pad(d.getHours())+':'+pad(d.getMinutes()); }
function daysAgoStr(n){ const d = new Date(); d.setDate(d.getDate()-n); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }

// Comidas del día, en el orden en que pasan. "Snack" es el nombre viejo de
// Merienda: los registros de antes se muestran como Merienda.
const MEALS = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena'];
function mealOf(momento){ return momento === 'Snack' ? 'Merienda' : (MEALS.includes(momento) ? momento : 'Merienda'); }

function guessMomento(){
  const h = new Date().getHours();
  if(h < 11) return 'Desayuno';
  if(h < 15) return 'Almuerzo';
  if(h < 18) return 'Merienda';
  return 'Cena';
}

/* "Cuándo" de un registro de comida: una línea ("Almuerzo · hoy 13:00") que
   se abre para cambiar comida, fecha u hora. Casi nunca cambia, así que no
   ocupa media hoja. Devuelve una función que lee lo elegido. */
function whenHtml(momento){
  return `
    <div class="when-line">
      <span id="whenText"></span>
      <button class="sf-change" id="whenChangeBtn" type="button">cambiar</button>
    </div>
    <div class="when-fields hidden" id="whenFields">
      <div class="chip-row when-meals">${MEALS.map(m => `<button type="button" class="chip${m === momento ? ' selected' : ''}" data-meal="${m}">${m}</button>`).join('')}</div>
      <div class="row-2">
        <div class="field"><label>Fecha</label><input type="date" id="f_fecha" value="${todayStr()}"></div>
        <div class="field"><label>Hora</label><input type="time" id="f_hora" value="${nowStr()}"></div>
      </div>
    </div>`;
}
function wireWhen(card, momento){
  let meal = momento;
  const fecha = card.querySelector('#f_fecha'), hora = card.querySelector('#f_hora');
  const text = card.querySelector('#whenText');
  const paint = () => {
    const d = fecha.value || todayStr();
    const day = d === todayStr() ? 'hoy' : new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { weekday:'short', day:'numeric', month:'short' });
    text.innerHTML = `<b>${meal}</b> · ${day} ${escapeHtml(hora.value || nowStr())}`;
  };
  card.querySelector('#whenChangeBtn').addEventListener('click', ev => {
    card.querySelector('#whenFields').classList.toggle('hidden');
    ev.currentTarget.textContent = card.querySelector('#whenFields').classList.contains('hidden') ? 'cambiar' : 'listo';
  });
  card.querySelectorAll('[data-meal]').forEach(b => b.addEventListener('click', () => {
    card.querySelectorAll('[data-meal]').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected');
    meal = b.dataset.meal;
    paint();
  }));
  fecha.addEventListener('input', paint);
  hora.addEventListener('input', paint);
  paint();
  return () => ({ momento: meal, date: fecha.value || todayStr(), time: hora.value || nowStr() });
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

// fase 2
let goalHistory = [];       // metas con la fecha desde la que valen
let bodyProfile = null;     // sexo, año de nacimiento, altura, objetivo, días de entreno
let weights = [];           // pesos, el más reciente primero
let supplements = [];       // tu pila activa
let takenToday = new Set(); // ids de suplementos marcados hoy
let waterToday = [];        // vasos y bebidas de hoy
let todayFoodRows = [];     // food_logs de hoy (para electrolitos)
let combos = [];            // combos con sus ítems
let comboDraft = null;      // combo que se está armando: { name, items: [{ food, quantity, label }] }

function goalsFor(date){ return goalsForDate(goalHistory, profile, date); }

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
const ringRow = document.getElementById('ringRow');
const insightArea = document.getElementById('insightArea');
const favoritesRow = document.getElementById('favoritesRow');
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

/* Teclado de iOS: la pantalla "de diseño" (innerHeight) no cambia, solo se
   achica la parte visible (visualViewport). Como un osciloscopio con la
   pantalla tapada a medias: medimos cuánto quedó tapado (--kb) y cuánto se ve
   (--vvh) y la hoja se acomoda a esa ventana. */
function syncViewport(){
  const vv = window.visualViewport;
  if(!vv) return;
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  document.documentElement.style.setProperty('--kb', kb + 'px');
  document.documentElement.style.setProperty('--vvh', Math.round(vv.height) + 'px');
  sheet.classList.toggle('kb-open', kb > 80);
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', syncViewport);
  window.visualViewport.addEventListener('scroll', syncViewport);
  syncViewport();
}

function openSheet(){
  sheet.classList.remove('tall');
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
  pendingMomento = null;
  sheet.classList.remove('tall');
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
  renderLogActions();
  try{
    await ensureProfile(user);
    profile = await getMyProfile(user.id);
  }catch(err){
    showError('Error cargando perfil: ' + (err.message || err));
    return;
  }
  document.getElementById('displayNameInput').value = profile.display_name;
  await loadPhase2Data();
  fillGoalInputs();
  fillBodyInputs();
  renderWeights();
  await Promise.all([renderFavorites(), renderToday(), renderStats(), renderRanking()]);
  renderHistoryPlaceholder();
}

/** Datos de la fase 2. Si la migración fase2.sql no se ha corrido, la app sigue funcionando sin ellos. */
async function loadPhase2Data(){
  const today = todayStr();
  const safe = (p, fallback) => p.catch(err => { console.warn('fase 2:', err.message || err); phase2Error = err; return fallback; });
  phase2Error = null;
  [goalHistory, bodyProfile, weights, supplements, takenToday, waterToday, combos] = await Promise.all([
    safe(getGoalHistory(user.id), []),
    safe(getBodyProfile(user.id), null),
    safe(getWeights(user.id), []),
    safe(getSupplements(user.id), []),
    safe(getSupplementLogs(user.id, today), new Set()),
    safe(getWaterLogs(user.id, today), []),
    safe(getCombos(user.id), [])
  ]);
  if(phase2Error) showError('Falta correr sql/fase2.sql en Supabase: ' + (phase2Error.message || phase2Error));
}
let phase2Error = null;

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
    // combos primero (abren su hoja para confirmar), luego tus alimentos de un toque
    const comboChips = combos.slice(0, 3).map((c, i) => `<button class="fav-chip fav-combo" data-fav-combo="${i}" type="button">🧺 ${escapeHtml(c.name)}</button>`).join('');
    if(favs.length === 0 && !comboChips){ favoritesRow.innerHTML = ''; return; }
    favoritesRow.innerHTML = comboChips + favs.map(f => `<button class="fav-chip" data-fav="${f.id}" type="button">${escapeHtml(f.name)}</button>`).join('');
    favoritesRow.querySelectorAll('[data-fav-combo]').forEach(btn => {
      btn.addEventListener('click', () => openComboLog(combos[Number(btn.dataset.favCombo)]));
    });
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
  if(f._units) return f;
  if(f.source !== 'usda'){
    // alimento propio: sus porciones caseras están en la columna "units"
    if(Array.isArray(f.units) && f.units.length){
      f._units = f.units.filter(u => u && u.label && Number(u.grams) > 0).map(u => ({ label: u.label, grams: Number(u.grams) }));
    }
    return f;
  }
  const b = BASICS_BY_FDC.get(f.usda_fdc_id);
  if(!b) return f;
  // una copia guardada de un básico sigue siendo básico (✓, porciones y orden);
  // si se guardó antes de la fase 2 no tiene micros: se toman del básico
  const micros = f.micros && Object.keys(f.micros).length ? f.micros : b.micros;
  return Object.assign(f, { _units: b._units, _kind: 'basic', _rank: b._rank, micros });
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

// comida a la que se está agregando (el "+" de Desayuno, Almuerzo...); null = según la hora
let pendingMomento = null;

function openFoodForm(momento){
  // también se usa directo como listener: entonces llega un evento, no un texto
  if(typeof momento === 'string') pendingMomento = momento;
  resetForm();
  sheet.classList.add('tall');
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);
  const inCombo = !!comboDraft;
  const title = inCombo ? 'Agregar al combo' : (pendingMomento || 'Comida');
  card.innerHTML = `
    <div class="search-sticky">
      <h3><span>${inCombo ? '🧺' : '🍽️'}</span> ${title}</h3>
      <div class="field">
        <input type="search" id="foodSearchInput" placeholder="Buscar: arroz, cambur, Savoy..." aria-label="Buscar alimento" autocomplete="off" enterkeyhint="search">
      </div>
    </div>
    <div id="foodSearchResults"></div>
    <div class="food-extra-actions">
      ${inCombo ? '' : '<button class="add-new-food-btn" id="quickAddBtn" type="button">⚡ Agregar rápido (kcal y macros a mano)</button>'}
      <button class="add-new-food-btn" id="addNewFoodBtn" type="button">+ Crear un alimento nuevo</button>
      ${inCombo ? '' : '<button class="add-new-food-btn" id="newComboBtn" type="button">🧺 Crear un combo (varios alimentos juntos)</button>'}
    </div>
    <div class="form-actions">
      <button class="btn-ghost" id="cancelFoodBtn">${inCombo ? 'Volver al combo' : 'Cancelar'}</button>
    </div>
  `;
  formArea.appendChild(card);
  card.querySelector('#cancelFoodBtn').addEventListener('click', inCombo ? openComboBuilder : closeForm);
  card.querySelector('#addNewFoodBtn').addEventListener('click', openNewFoodForm);
  if(!inCombo){
    card.querySelector('#quickAddBtn').addEventListener('click', openQuickAddForm);
    card.querySelector('#newComboBtn').addEventListener('click', () => { comboDraft = { name: '', items: [] }; openComboBuilder(); });
  }

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
  const showCombos = !comboDraft && combos.length > 0;
  if(!items.length && !showCombos){
    resultsWrap.innerHTML = `<div class="search-empty">Escribe para buscar. Lo que registres aparecerá aquí la próxima vez.</div>`;
    return;
  }
  let html = '';
  if(showCombos){
    html += `<div class="search-section-title">Tus combos</div>
      <div class="food-search-results">${combos.map((c, i) => `
        <div class="food-result" data-combo="${i}">
          <div class="fr-name">🧺 ${escapeHtml(c.name)}</div>
          <div class="fr-meta">${c.items.length} alimento${c.items.length === 1 ? '' : 's'} · ${Math.round(comboKcal(c))} kcal</div>
        </div>`).join('')}</div>`;
  }
  if(items.length){
    html += `<div class="search-section-title">Frecuentes</div>
      <div class="food-search-results">${foodListHtml(items)}</div>`;
  }
  resultsWrap.innerHTML = html;
  resultsWrap.querySelectorAll('[data-idx]').forEach(el => {
    el.addEventListener('click', () => openQuantityStep(items[Number(el.dataset.idx)]));
  });
  resultsWrap.querySelectorAll('[data-combo]').forEach(el => {
    el.addEventListener('click', () => openComboLog(combos[Number(el.dataset.combo)]));
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
  return `${n} ${n === 1 ? unit.label : pluralEs(unit.label)}`;
}


async function openQuantityStep(foodResult){
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);

  const f = withUnits(foodResult);
  const units = unitOptions(f);
  let unit = units[0];
  const momento = pendingMomento || guessMomento();
  const inCombo = !!comboDraft;
  const canEditUnits = f.source === 'custom' && f.id;
  card.innerHTML = `
    <h3><span>${inCombo ? '🧺' : '🍽️'}</span> ${inCombo ? 'Agregar al combo' : 'Comida'}</h3>
    <div class="selected-food-card">
      <button class="sf-change" id="changeFoodBtn" type="button">cambiar</button>
      <div class="sf-name">${escapeHtml(f.name)}${f._kind === 'basic' ? ' <span class="fr-check">✓</span>' : ''}</div>
      <div class="sf-sub">${foodMeta(f)}</div>
      ${canEditUnits ? `<button class="sf-units" id="editUnitsBtn" type="button">${f._units && f._units.length ? 'editar porciones caseras' : '+ porciones caseras (unidad, taza…)'}</button>` : ''}
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
    ${inCombo ? '' : whenHtml(momento)}
    <div class="form-actions sticky">
      <button class="btn-ghost" id="cancelBtn">${inCombo ? 'Volver al combo' : 'Cancelar'}</button>
      <button class="btn-primary" id="saveBtn" style="--cat-color: var(--c-comida)">${inCombo ? 'Agregar al combo' : 'Guardar'}</button>
    </div>
  `;
  formArea.appendChild(card);
  if(canEditUnits) card.querySelector('#editUnitsBtn').addEventListener('click', () => openUnitsEditor(f));
  const readWhen = inCombo ? null : wireWhen(card, momento);

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
  card.querySelector('#cancelBtn').addEventListener('click', inCombo ? openComboBuilder : closeForm);
  card.querySelector('#saveBtn').addEventListener('click', async () => {
    const amount = Number(qtyInput.value);
    if(!(amount > 0)){ showToast('Escribe una cantidad'); return; }
    const saveBtn = card.querySelector('#saveBtn');
    const idleLabel = saveBtn.textContent;
    saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
    try{
      let foodRow = f;
      if(f.source === 'usda' && !f.id){
        // un combo necesita el id del alimento: la copia de USDA se guarda ya
        foodRow = withUnits(await cacheUsdaFood(f, user.id, user.email));
      }
      if(inCombo){
        comboDraft.items.push({ food: foodRow, quantity: quantityFor(f, unit, amount), label: `${foodRow.name} · ${amountLabel(unit, amount)}` });
        openComboBuilder();
        return;
      }
      await logFood({
        userId: user.id, foodRow,
        quantity: quantityFor(f, unit, amount),
        label: `${foodRow.name} · ${amountLabel(unit, amount)}`,
        ...readWhen()
      });
      closeForm();
      showToast('Comida registrada');
      await refreshAfterLog();
    }catch(err){
      showToast('Error: ' + err.message);
      saveBtn.disabled = false; saveBtn.textContent = idleLabel;
    }
  });
}

/* ---- porciones caseras de un alimento propio ---- */

/** Filas editables de porciones caseras: [{label, grams}] */
function unitsRowsHtml(units){
  const rows = (units && units.length ? units : [{ label: '', grams: '' }]);
  return rows.map(u => `
    <div class="unit-edit-row">
      <input type="text" data-unit-label placeholder="unidad, taza…" value="${escapeHtml(u.label || '')}">
      <input type="number" data-unit-grams inputmode="decimal" min="0" step="any" placeholder="gramos" value="${u.grams || ''}">
    </div>`).join('');
}
function readUnits(container){
  return [...container.querySelectorAll('.unit-edit-row')].map(r => ({
    label: r.querySelector('[data-unit-label]').value.trim(),
    grams: Number(r.querySelector('[data-unit-grams]').value)
  })).filter(u => u.label && u.grams > 0);
}
function wireUnitsEditor(card){
  card.querySelector('#addUnitRowBtn').addEventListener('click', () => {
    card.querySelector('#unitRows').insertAdjacentHTML('beforeend', unitsRowsHtml([]));
  });
}

function openUnitsEditor(food){
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);
  card.innerHTML = `
    <h3><span>🥄</span> Porciones caseras</h3>
    <p class="form-hint">${escapeHtml(food.name)}. Para calcular, la app necesita saber cuánto pesa tu porción de referencia (${escapeHtml(food.serving_label)}).</p>
    <div class="field"><label>Peso de "${escapeHtml(food.serving_label)}" (g)</label>
      <input type="number" id="ue_serving_g" inputmode="decimal" min="0" step="any" value="${food.serving_grams || ''}" placeholder="Ej: 98"></div>
    <div class="field"><label>Porciones (nombre y gramos)</label><div id="unitRows">${unitsRowsHtml(food._units)}</div></div>
    <button class="add-new-food-btn" id="addUnitRowBtn" type="button">+ otra porción</button>
    <div class="form-actions">
      <button class="btn-ghost" id="cancelBtn">Volver</button>
      <button class="btn-primary" id="saveBtn">Guardar</button>
    </div>`;
  formArea.appendChild(card);
  wireUnitsEditor(card);
  card.querySelector('#cancelBtn').addEventListener('click', () => openQuantityStep(food));
  card.querySelector('#saveBtn').addEventListener('click', async (ev) => {
    const servingG = Number(card.querySelector('#ue_serving_g').value);
    const units = readUnits(card);
    if(units.length && !(servingG > 0)){ showToast('Falta el peso de la porción de referencia'); return; }
    ev.currentTarget.disabled = true;
    try{
      const updated = await updateFood(food.id, { serving_grams: servingG > 0 ? servingG : null, units });
      // se actualiza el mismo objeto para que "Frecuentes" no muestre las porciones viejas
      Object.assign(food, updated, { _units: undefined });
      showToast('Porciones guardadas');
      openQuantityStep(food);
    }catch(err){
      showToast('Error: ' + err.message);
      ev.currentTarget.disabled = false;
    }
  });
}

/* ---- combos ---- */

function comboKcal(c){
  return c.items.reduce((s, it) => s + (it.food && it.food.kcal != null ? Number(it.food.kcal) * Number(it.quantity) : 0), 0);
}

function openComboBuilder(){
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);
  const d = comboDraft;
  card.innerHTML = `
    <h3><span>🧺</span> Combo nuevo</h3>
    <p class="form-hint">Varios alimentos que sueles comer juntos. Después lo registras con un toque.</p>
    <div class="field"><label>Nombre</label><input type="text" id="combo_name" placeholder="Ej: Desayuno de siempre" value="${escapeHtml(d.name)}"></div>
    <div class="field"><label>Alimentos</label>
      ${d.items.length ? `<div class="combo-items">${d.items.map((it, i) => `
        <div class="combo-item"><span>${escapeHtml(it.label)}</span>
          <span class="ci-right mono">${it.food.kcal != null ? Math.round(it.food.kcal * it.quantity) + ' kcal' : ''}
          <button class="entry-del" data-rm-item="${i}" type="button">quitar</button></span></div>`).join('')}</div>`
        : '<div class="search-empty">Todavía no hay alimentos.</div>'}
    </div>
    <button class="add-new-food-btn" id="addComboItemBtn" type="button">+ Agregar alimento</button>
    <div class="form-actions">
      <button class="btn-ghost" id="cancelBtn">Cancelar</button>
      <button class="btn-primary" id="saveBtn">Guardar combo</button>
    </div>`;
  formArea.appendChild(card);
  const nameInput = card.querySelector('#combo_name');
  nameInput.addEventListener('input', () => { d.name = nameInput.value; });
  card.querySelector('#addComboItemBtn').addEventListener('click', openFoodForm);
  card.querySelectorAll('[data-rm-item]').forEach(b => b.addEventListener('click', () => {
    d.items.splice(Number(b.dataset.rmItem), 1);
    openComboBuilder();
  }));
  card.querySelector('#cancelBtn').addEventListener('click', () => { comboDraft = null; openFoodForm(); });
  card.querySelector('#saveBtn').addEventListener('click', async (ev) => {
    const name = d.name.trim();
    if(!name){ showToast('Ponle un nombre al combo'); return; }
    if(!d.items.length){ showToast('Agrega al menos un alimento'); return; }
    ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Guardando...';
    try{
      await createCombo(user.id, name, d.items.map(it => ({ food_id: it.food.id, quantity: it.quantity, label: it.label })));
      combos = await getCombos(user.id);
      comboDraft = null;
      renderFavorites();
      showToast('Combo guardado');
      openFoodForm();
    }catch(err){
      showToast('Error: ' + err.message);
      ev.currentTarget.disabled = false; ev.currentTarget.textContent = 'Guardar combo';
    }
  });
}

function openComboLog(combo){
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);
  const momento = pendingMomento || guessMomento();
  card.innerHTML = `
    <h3><span>🧺</span> ${escapeHtml(combo.name)}</h3>
    <div class="combo-items">${combo.items.map(it => `
      <div class="combo-item"><span>${escapeHtml(it.label)}</span>
        <span class="ci-right mono">${it.food.kcal != null ? Math.round(it.food.kcal * it.quantity) + ' kcal' : ''}</span></div>`).join('')}</div>
    <div class="calc-box"><b>${Math.round(comboKcal(combo))} kcal</b> en total</div>
    ${whenHtml(momento)}
    <div class="form-actions sticky">
      <button class="btn-ghost" id="cancelBtn">Volver</button>
      <button class="btn-primary" id="saveBtn">Registrar combo</button>
    </div>
    <button class="btn-link" id="delComboBtn" type="button">Eliminar este combo</button>`;
  formArea.appendChild(card);
  card.querySelector('#cancelBtn').addEventListener('click', openFoodForm);
  const readWhen = wireWhen(card, momento);
  card.querySelector('#delComboBtn').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    if(btn.dataset.confirm !== '1'){ btn.dataset.confirm = '1'; btn.textContent = 'Toca otra vez para eliminar (tus registros no se borran)'; return; }
    try{
      await deleteCombo(combo.id);
      combos = combos.filter(c => c.id !== combo.id);
      renderFavorites();
      showToast('Combo eliminado');
      openFoodForm();
    }catch(err){ showToast('Error: ' + err.message); }
  });
  card.querySelector('#saveBtn').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true; btn.textContent = 'Guardando...';
    const common = { userId: user.id, ...readWhen() };
    let done = 0;
    try{
      // uno por uno: si falla a la mitad, se sabe cuántos quedaron
      for(const it of combo.items){
        await logFood({ ...common, foodRow: withUnits(it.food), quantity: Number(it.quantity), label: it.label });
        done++;
      }
      closeForm();
      showToast(`${combo.name} registrado`);
      await refreshAfterLog();
    }catch(err){
      showToast(`Error tras ${done} de ${combo.items.length}: ${err.message}`);
      btn.disabled = false; btn.textContent = 'Registrar combo';
      if(done) await refreshAfterLog();
    }
  });
}

/* ---- agregar rápido: kcal y macros a mano, sin crear un alimento ---- */

function openQuickAddForm(){
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', CAT_COLOR.comida);
  const momento = pendingMomento || guessMomento();
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
    ${whenHtml(momento)}
    <div class="form-actions sticky">
      <button class="btn-ghost" id="cancelBtn">Volver</button>
      <button class="btn-primary" id="saveBtn" style="--cat-color: var(--c-comida)">Guardar</button>
    </div>
  `;
  formArea.appendChild(card);
  card.querySelector('#cancelBtn').addEventListener('click', openFoodForm);
  const readWhen = wireWhen(card, momento);
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
        userId: user.id, foodRow, quantity: 1, ...readWhen()
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
  const microInputs = MICRO_FIELDS.map(f => `
    <div class="field">
      <label>${f.label} (${f.unit})</label>
      <input type="number" step="0.1" inputmode="decimal" data-micro="${f.key}" placeholder="opcional">
    </div>`).join('');

  card.innerHTML = `
    <h3><span>🍽️</span> Alimento nuevo</h3>
    <div class="field"><label>Nombre</label><input type="text" id="nf_name" placeholder="Ej: Arepa de maíz"></div>
    <div class="row-2">
      <div class="field"><label>Categoría</label><input type="text" id="nf_cat" placeholder="Ej: Panadería"></div>
      <div class="field"><label>Porción de referencia</label><input type="text" id="nf_serving" placeholder="Ej: 100 g, 1 unidad" value="100 g"></div>
    </div>
    <div class="field"><label>Peso de esa porción (g)</label><input type="number" id="nf_serving_g" inputmode="decimal" min="0" step="any" placeholder="opcional, ej: 98"></div>
    <p style="font-size:12px; color:var(--text-dim); margin: 2px 0 10px;">Los valores de abajo son por esa porción de referencia. Deja en blanco lo que no sepas — lo puedes completar después.</p>
    ${nutrientInputs}
    <details class="more-fields">
      <summary>Más nutrientes (magnesio, zinc, B6, folato, omega-3)</summary>
      ${microInputs}
    </details>
    <details class="more-fields">
      <summary>Porciones caseras (unidad, taza, rebanada…)</summary>
      <p class="form-hint" style="margin-top:6px">Necesitan el peso de la porción de referencia de arriba.</p>
      <div id="unitRows">${unitsRowsHtml([])}</div>
      <button class="add-new-food-btn" id="addUnitRowBtn" type="button">+ otra porción</button>
    </details>
    <div class="form-actions">
      <button class="btn-ghost" id="cancelBtn">Cancelar</button>
      <button class="btn-primary" id="saveBtn" style="--cat-color: var(--c-comida)">Guardar y continuar</button>
    </div>
  `;
  formArea.appendChild(card);
  wireUnitsEditor(card);

  card.querySelector('#cancelBtn').addEventListener('click', openFoodForm);
  card.querySelector('#saveBtn').addEventListener('click', async () => {
    const name = card.querySelector('#nf_name').value.trim();
    if(!name){ showToast('Falta el nombre'); return; }
    // si la porción se llama "100 g" (o "30 g"), su peso ya se sabe
    const labelG = (card.querySelector('#nf_serving').value.trim().match(/^(\d+(?:[.,]\d+)?)\s*g$/i) || [])[1];
    const servingG = Number(card.querySelector('#nf_serving_g').value) || (labelG ? Number(labelG.replace(',', '.')) : 0);
    const units = readUnits(card);
    if(units.length && !(servingG > 0)){ showToast('Las porciones caseras necesitan el peso de la porción'); return; }
    const fields = {
      name,
      category: card.querySelector('#nf_cat').value.trim() || null,
      serving_label: card.querySelector('#nf_serving').value.trim() || '100 g',
      serving_grams: servingG > 0 ? servingG : null,
      units,
      micros: {}
    };
    NUTRIENT_FIELDS.forEach(f => {
      const v = card.querySelector(`[data-nutri="${f.key}"]`).value;
      fields[f.key] = v === '' ? null : Number(v);
    });
    MICRO_FIELDS.forEach(f => {
      const v = card.querySelector(`[data-micro="${f.key}"]`).value;
      if(v !== '') fields.micros[f.key] = Number(v);
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
    summary = `${mealOf(d.momento)}: ${escapeHtml(foodLogLabel(d))}${d.kcal != null ? ` · ${Math.round(d.kcal)} kcal` : ''}`;
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

let todayEntries = [];   // registros de hoy (comida y actividades), para los mosaicos

async function renderToday(){
  const wrap = document.getElementById('todayTimeline');
  wrap.innerHTML = `<div class="search-empty"><span class="spinner"></span> cargando...</div>`;
  try{
    const list = await getEntriesForDate(user.id, todayStr());
    todayEntries = list;
    const others = list.filter(e => e.kind !== 'food');
    wrap.innerHTML = others.length
      ? `<div class="timeline">${others.map(entryRow).join('')}</div>`
      : `<div class="search-empty">Baño, energía y notas aparecerán aquí.</div>`;
    const foods = list.filter(e => e.kind === 'food');
    todayFoodRows = foods.map(e => e.data);
    renderRings(foods);
    renderMeals(foods);
  }catch(err){
    wrap.innerHTML = `<div class="empty-state">Error cargando: ${escapeHtml(err.message)}</div>`;
    todayEntries = [];
    todayFoodRows = [];
    renderRings([]);
    renderMeals([]);
  }
  renderDaily();
}

/* ---- comidas del día agrupadas: Desayuno, Almuerzo, Merienda, Cena ---- */

const mealList = document.getElementById('mealList');
const MEAL_ICON = { Desayuno: '☕', Almuerzo: '🍛', Merienda: '🍎', Cena: '🌙' };

function renderMeals(foods){
  mealList.innerHTML = MEALS.map(m => {
    const items = foods.filter(e => mealOf(e.data.momento) === m);
    const kcal = items.reduce((s, e) => s + (e.data.kcal != null ? Number(e.data.kcal) : 0), 0);
    return `
      <div class="meal${items.length ? '' : ' is-empty'}">
        <div class="meal-h">
          <span class="meal-name"><span aria-hidden="true">${MEAL_ICON[m]}</span> ${m}</span>
          ${items.length ? `<span class="meal-kcal mono">${Math.round(kcal)} kcal</span>` : ''}
          <button class="meal-add" data-add-meal="${m}" type="button" aria-label="Agregar a ${m}">+</button>
        </div>
        ${items.length ? `<div class="meal-items">${items.map(e => `
          <div class="meal-item">
            <span class="mi-name">${escapeHtml(foodLogLabel(e.data))}</span>
            <span class="mi-kcal mono">${e.data.kcal != null ? Math.round(e.data.kcal) : '–'}</span>
            <button class="mi-del" data-del-food="${e.id}" type="button" aria-label="Eliminar ${escapeHtml(foodLogLabel(e.data))}">×</button>
          </div>`).join('')}</div>` : ''}
      </div>`;
  }).join('');
  mealList.querySelectorAll('[data-add-meal]').forEach(b => b.addEventListener('click', () => openFoodForm(b.dataset.addMeal)));
}

/* ================= hoy: mosaicos de estado del día ================= */
/* Cuatro cosas que se hacen una vez al día o se cuentan con un toque. Cada
   mosaico muestra el RESULTADO (cómo vas), no un botón genérico: como un LED
   de estado en un tablero. Tocarlo abre el detalle en la hoja inferior. */

const dayTiles = document.getElementById('dayTiles');
// 1250 ml -> "1,25"
function fmtLiters(ml){ return String(Math.round(ml / 10) / 100).replace('.', ','); }
function waterTotal(){ return waterToday.reduce((s, w) => s + Number(w.ml), 0); }
function lastOfType(type){
  const list = todayEntries.filter(e => e.kind === 'activity' && e.type === type);
  return list.length ? list[list.length - 1] : null;
}

function tileHtml({ id, color, icon, label, value, sub, done, extra = '' }){
  return `
    <div class="tile${done ? ' is-done' : ''}" style="--cat-color:${color}">
      <button class="tile-main" id="${id}" type="button">
        <span class="tile-h"><span class="tile-ic" aria-hidden="true">${icon}</span>${label}</span>
        <span class="tile-v">${value}</span>
        <span class="tile-sub">${sub}</span>
      </button>
      ${extra}
    </div>`;
}

function renderDaily(){
  if(!profile){ dayTiles.innerHTML = ''; return; }

  // agua
  const goal = goalsFor(todayStr()).goal_water_ml;
  const ml = waterTotal();
  const water = tileHtml({
    id: 'tileWater', color: 'var(--c-agua)', icon: '💧', label: 'Agua', done: ml >= goal,
    value: `${fmtLiters(ml)} <small>/ ${fmtLiters(goal)} L</small>`,
    sub: `<span class="tile-bar"><span style="width:${pctWidth(ml, goal)}"></span></span>`,
    extra: `<button class="tile-plus" id="waterPlusBtn" type="button" aria-label="Sumar 250 ml de agua">+</button>`
  });

  // suplementos
  const total = supplements.length;
  const taken = supplements.filter(s => takenToday.has(s.id)).length;
  const supp = tileHtml({
    id: 'tileSupps', color: 'var(--c-supl)', icon: '💊', label: 'Suplementos', done: total > 0 && taken === total,
    value: total === 0 ? '<span class="tile-empty">Agregar</span>' : (taken === total ? '✓ Listo' : `${taken} <small>de ${total}</small>`),
    sub: total === 0 ? 'tu pila diaria' : `<span class="tile-dots">${supplements.map(s => `<i class="${takenToday.has(s.id) ? 'on' : ''}"></i>`).join('')}</span>`
  });

  // gym
  const g = lastOfType('gym');
  let gymV = '<span class="tile-empty">Registrar</span>', gymSub = '¿entrenaste hoy?';
  if(g && g.data.fue === false){ gymV = '<span class="tile-text">Descanso</span>'; gymSub = 'día de recuperación'; }
  else if(g){
    const d = g.data;
    gymV = `<span class="tile-text">${escapeHtml(Array.isArray(d.tipos) && d.tipos.length ? d.tipos.join(' + ') : 'Entreno')}</span>`;
    gymSub = [d.rpe ? `RPE ${d.rpe}` : '', d.duracion ? `${d.duracion} min` : ''].filter(Boolean).join(' · ') || 'registrado';
  }
  const gym = tileHtml({ id: 'tileGym', color: 'var(--c-gym)', icon: '🏋️', label: 'Gym', value: gymV, sub: gymSub, done: !!g });

  // sueño
  const s = lastOfType('sueno');
  let sleepV = '<span class="tile-empty">Registrar</span>', sleepSub = '¿cómo dormiste?';
  if(s){
    const { dur } = calcSleep(s.data);
    sleepV = dur != null ? fmtDur(dur).replace(' min', '') : `${s.data.horaDormir || '?'} → ${s.data.horaDespertar || '?'}`;
    sleepSub = s.data.calidad ? `calidad ${s.data.calidad}/5` : 'registrado';
  }
  const sleep = tileHtml({ id: 'tileSleep', color: 'var(--c-sueno)', icon: '🌙', label: 'Sueño', value: sleepV, sub: sleepSub, done: !!s });

  dayTiles.innerHTML = water + supp + gym + sleep;

  dayTiles.querySelector('#tileWater').addEventListener('click', openWaterForm);
  dayTiles.querySelector('#waterPlusBtn').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    await quickWater(250);
    btn.disabled = false;
  });
  dayTiles.querySelector('#tileSupps').addEventListener('click', openSupplementsForm);
  dayTiles.querySelector('#tileGym').addEventListener('click', () => openActivityForm('gym'));
  dayTiles.querySelector('#tileSleep').addEventListener('click', () => openActivityForm('sueno'));
}

/* ---- registrar: comida (lo más frecuente) y el resto en pastillas ---- */

function renderLogActions(){
  document.getElementById('otherLogBtn').onclick = openOtherLogPicker;
}

/** Un solo botón para lo poco frecuente: Baño, Energía o Nota. */
function openOtherLogPicker(){
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.innerHTML = `
    <h3>¿Qué quieres registrar?</h3>
    <div class="check-list">${['bano', 'energia', 'nota'].map(k => `
      <button class="check-row" data-log="${k}" type="button" style="--cat-color:${TYPES[k].color}">
        <span class="pick-ic" aria-hidden="true">${TYPES[k].icon}</span><span>${TYPES[k].label}</span></button>`).join('')}</div>
    <div class="form-actions"><button class="btn-ghost" id="cancelBtn" type="button">Cancelar</button></div>`;
  formArea.appendChild(card);
  card.querySelectorAll('[data-log]').forEach(b => b.addEventListener('click', () => openActivityForm(b.dataset.log)));
  card.querySelector('#cancelBtn').addEventListener('click', closeForm);
}

/* ---- agua ---- */

async function quickWater(ml){
  try{
    const row = await addWater(user.id, { date: todayStr(), time: nowStr(), ml });
    waterToday.push(row);
    showToast(`+${ml} ml · ${fmtLiters(waterTotal())} L hoy`);
    renderDaily();
    return true;
  }catch(err){ showToast('Error: ' + err.message); return false; }
}

function openWaterForm(){
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', 'var(--c-agua)');
  const goal = goalsFor(todayStr()).goal_water_ml;
  const ml = waterTotal();
  const list = waterToday.slice().sort((a, b) => String(a.log_time).localeCompare(String(b.log_time)));
  const last = list.length ? list[list.length - 1] : null;
  const el = electrolyteTotals(todayFoodRows, waterToday);
  const hasEl = el.sodium_mg + el.potassium_mg + el.magnesium_mg > 0;
  card.innerHTML = `
    <h3><span>💧</span> Agua</h3>
    <div class="sheet-stat"><b>${fmtLiters(ml)}</b> / ${fmtLiters(goal)} L
      <span class="tile-bar"><span style="width:${pctWidth(ml, goal)}"></span></span></div>
    <div class="chip-row sheet-quick">
      <button class="chip" data-add="250" type="button">+250 ml</button>
      <button class="chip" data-add="500" type="button">+500 ml</button>
      <button class="chip" data-add="750" type="button">+750 ml</button>
      ${last ? `<button class="chip chip-remove" id="waterUndoBtn" type="button">− Quitar el último (${Math.round(last.ml)} ml)</button>` : ''}
    </div>
    ${hasEl ? `<div class="calc-box">Electrolitos de hoy (comida + bebidas)<br>Sodio <b>${Math.round(el.sodium_mg)}</b> · Potasio <b>${Math.round(el.potassium_mg)}</b> · Magnesio <b>${Math.round(el.magnesium_mg)}</b> mg</div>` : ''}
    ${list.length ? `<div class="search-section-title">Hoy</div><div class="combo-items">${list.map(w => `
      <div class="combo-item"><span><span class="mono entry-time">${String(w.log_time).slice(0, 5)}</span> ${Math.round(w.ml)} ml${w.label ? ' · ' + escapeHtml(w.label) : ''}</span>
        <button class="entry-del" data-del-water="${w.id}" type="button">eliminar</button></div>`).join('')}</div>` : ''}
    <details class="more-fields" id="waterCustom">
      <summary>Otra cantidad, suero o bebida con electrolitos</summary>
      <div class="field" style="margin-top:8px"><label>Cantidad (ml)</label>
        <input type="number" id="w_ml" inputmode="numeric" min="1" step="any" placeholder="330"></div>
      <div class="field"><label>Qué bebiste (opcional)</label><input type="text" id="w_label" placeholder="Ej: Suero oral"></div>
      <p class="form-hint" style="margin-top:0">Si trae electrolitos, copia lo que dice la etiqueta para esa cantidad.</p>
      <div class="row-3">
        <div class="field"><label>Sodio (mg)</label><input type="number" id="w_na" inputmode="decimal" min="0" step="any" placeholder="opcional"></div>
        <div class="field"><label>Potasio (mg)</label><input type="number" id="w_k" inputmode="decimal" min="0" step="any" placeholder="opcional"></div>
        <div class="field"><label>Magnesio (mg)</label><input type="number" id="w_mg" inputmode="decimal" min="0" step="any" placeholder="opcional"></div>
      </div>
      <button class="btn-primary" id="saveBtn" type="button" style="width:100%">Agregar</button>
    </details>
    <div class="form-actions"><button class="btn-ghost" id="cancelBtn">Cerrar</button></div>`;
  formArea.appendChild(card);
  card.querySelector('#cancelBtn').addEventListener('click', closeForm);
  // la hoja se queda abierta: se puede sumar varias veces seguidas
  card.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    if(await quickWater(Number(b.dataset.add))) openWaterForm(); else b.disabled = false;
  }));
  if(last){
    card.querySelector('#waterUndoBtn').addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      try{
        await deleteWater(last.id);
        waterToday = waterToday.filter(w => w.id !== last.id);
        showToast(`−${Math.round(last.ml)} ml`);
        renderDaily();
        openWaterForm();
      }catch(err){ showToast('Error: ' + err.message); ev.currentTarget.disabled = false; }
    });
  }
  card.querySelectorAll('[data-del-water]').forEach(b => b.addEventListener('click', async () => {
    try{
      await deleteWater(b.dataset.delWater);
      waterToday = waterToday.filter(w => w.id !== b.dataset.delWater);
      renderDaily();
      openWaterForm();
    }catch(err){ showToast('Error: ' + err.message); }
  }));
  card.querySelector('#saveBtn').addEventListener('click', async (ev) => {
    const num = id => { const v = card.querySelector(id).value; return v === '' ? null : Number(v); };
    const amount = num('#w_ml');
    if(!(amount > 0)){ showToast('Escribe los mililitros'); return; }
    ev.currentTarget.disabled = true;
    try{
      const row = await addWater(user.id, {
        date: todayStr(), time: nowStr(), ml: amount,
        label: card.querySelector('#w_label').value.trim() || null,
        sodium_mg: num('#w_na'), potassium_mg: num('#w_k'), magnesium_mg: num('#w_mg')
      });
      waterToday.push(row);
      renderDaily();
      showToast(`+${Math.round(amount)} ml`);
      openWaterForm();
    }catch(err){ showToast('Error: ' + err.message); ev.currentTarget.disabled = false; }
  });
}

/* ---- suplementos: checklist de hoy + editar la pila ---- */

function openSupplementsForm(){
  resetForm();
  const card = document.createElement('div');
  card.className = 'form-card';
  card.style.setProperty('--cat-color', 'var(--c-supl)');
  const empty = supplements.length === 0;
  card.innerHTML = `
    <h3><span>💊</span> Suplementos de hoy</h3>
    ${empty ? '<p class="form-hint">Agrega lo que tomas a diario (creatina, magnesio, vitamina D…). Después lo marcas aquí con un toque.</p>' : `
    <div class="check-list">${supplements.map(s => `
      <button class="check-row${takenToday.has(s.id) ? ' on' : ''}" data-supp="${s.id}" type="button" aria-pressed="${takenToday.has(s.id)}">
        <span class="check-box" aria-hidden="true">${takenToday.has(s.id) ? '✓' : ''}</span>
        <span class="check-name">${escapeHtml(s.name)}</span>
        ${s.dose ? `<span class="check-dose">${escapeHtml(s.dose)}</span>` : ''}
      </button>`).join('')}</div>`}
    <details class="more-fields" id="suppEdit"${empty ? ' open' : ''}>
      <summary>${empty ? 'Tu pila' : 'Editar tu pila'}</summary>
      ${empty ? '' : `<div class="combo-items" style="margin-top:8px">${supplements.map(s => `
        <div class="combo-item"><span>${escapeHtml(s.name)}${s.dose ? ` <span class="ci-dose">${escapeHtml(s.dose)}</span>` : ''}</span>
          <button class="entry-del" data-retire="${s.id}" type="button">quitar</button></div>`).join('')}</div>`}
      <div class="row-2" style="margin-top:12px">
        <div class="field"><label>Suplemento</label><input type="text" id="s_name" placeholder="Ej: Creatina"></div>
        <div class="field"><label>Dosis (opcional)</label><input type="text" id="s_dose" placeholder="Ej: 5 g"></div>
      </div>
      <button class="btn-primary" id="saveBtn" type="button" style="width:100%">Agregar a la pila</button>
    </details>
    <div class="form-actions"><button class="btn-ghost" id="cancelBtn">Cerrar</button></div>`;
  formArea.appendChild(card);
  card.querySelector('#cancelBtn').addEventListener('click', closeForm);

  card.querySelectorAll('[data-supp]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.supp;
    const taken = !takenToday.has(id);
    // se marca al instante (sin redibujar la hoja); si falla, se deshace
    const paint = on => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      b.querySelector('.check-box').textContent = on ? '✓' : '';
    };
    taken ? takenToday.add(id) : takenToday.delete(id);
    paint(taken);
    renderDaily();
    try{ await setSupplementTaken(user.id, id, todayStr(), taken); }
    catch(err){
      taken ? takenToday.delete(id) : takenToday.add(id);
      paint(!taken);
      renderDaily();
      showToast('Error: ' + err.message);
    }
  }));
  card.querySelectorAll('[data-retire]').forEach(b => b.addEventListener('click', async () => {
    try{
      await retireSupplement(b.dataset.retire);
      supplements = supplements.filter(s => s.id !== b.dataset.retire);
      renderDaily();
      openSupplementsForm();
      formArea.querySelector('#suppEdit')?.setAttribute('open', '');   // sigue editando
    }catch(err){ showToast('Error: ' + err.message); }
  }));
  card.querySelector('#saveBtn').addEventListener('click', async (ev) => {
    const name = card.querySelector('#s_name').value.trim();
    if(!name){ showToast('Escribe el nombre'); return; }
    ev.currentTarget.disabled = true;
    try{
      const sort = supplements.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
      supplements.push(await addSupplement(user.id, name, card.querySelector('#s_dose').value.trim(), sort));
      renderDaily();
      openSupplementsForm();
      formArea.querySelector('#suppEdit')?.setAttribute('open', '');
      showToast(`${name} agregado`);
    }catch(err){ showToast('Error: ' + err.message); ev.currentTarget.disabled = false; }
  });
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
      // kcal del día contra la meta que valía ESE día (no la de hoy)
      const foods = entries.filter(e => e.kind === 'food');
      const kcal = foods.reduce((s, e) => s + (e.data.kcal != null ? Number(e.data.kcal) : 0), 0);
      const kcalTxt = foods.length ? `${Math.round(kcal)}/${Math.round(goalsFor(date).goal_kcal)} kcal · ` : '';
      return `
        <details class="day-block">
          <summary class="day-summary"><span class="d-date">${label}</span><span class="d-count mono">${kcalTxt}${entries.length} reg.</span></summary>
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
  const g = goalsFor(todayStr());
  const left = Math.max(0, Math.round(g.goal_kcal - totals.kcal));
  const macros = [
    { key:'carbs_g', label:'Carbos', color:'var(--c-comida)', goal: g.goal_carbs_g },
    { key:'protein_g', label:'Proteína', color:'var(--c-gym)', goal: g.goal_protein_g },
    { key:'fat_g', label:'Grasa', color:'var(--c-sueno)', goal: g.goal_fat_g }
  ];

  ringRow.innerHTML = `
    <div class="today-card">
      <div class="kh-top">
        <span class="kh-label">Calorías</span>
        <span class="kh-num"><b>${Math.round(totals.kcal)}</b> / ${Math.round(g.goal_kcal)} · ${left} restantes</span>
      </div>
      <div class="kh-bar"><div class="kh-bar-fill" style="width:${pctWidth(totals.kcal, g.goal_kcal)}"></div></div>
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

// Si la app quedó abierta y pasó la medianoche, el agua y los suplementos son de otro día
let dailyFor = todayStr();
async function reloadDailyIfNewDay(){
  const today = todayStr();
  if(dailyFor === today) return false;
  dailyFor = today;
  try{
    [waterToday, takenToday] = await Promise.all([getWaterLogs(user.id, today), getSupplementLogs(user.id, today)]);
  }catch(err){ waterToday = []; takenToday = new Set(); }
  return true;
}
document.addEventListener('visibilitychange', async () => {
  if(document.visibilityState === 'visible' && user && await reloadDailyIfNewDay()) await renderToday();
});

async function refreshAfterLog(){
  try{ profile = await getMyProfile(user.id); }catch(err){}
  await reloadDailyIfNewDay();
  await Promise.all([renderToday(), renderStats(), renderFavorites()]);
}

/* ================= perfil / metas ================= */

function fillGoalInputs(g = goalsFor(todayStr())){
  document.getElementById('goalKcal').value = Math.round(g.goal_kcal);
  document.getElementById('goalProtein').value = Math.round(g.goal_protein_g);
  document.getElementById('goalCarbs').value = Math.round(g.goal_carbs_g);
  document.getElementById('goalFat').value = Math.round(g.goal_fat_g);
  document.getElementById('goalWater').value = Math.round(g.goal_water_ml);
}

/** Guarda las metas en el perfil y en el historial (valen desde hoy). */
async function saveGoals(goals){
  await updateGoals(user.id, goals);
  profile = { ...profile, ...goals };
  try{
    await saveGoalsFrom(user.id, todayStr(), goals);
    goalHistory = await getGoalHistory(user.id);
  }catch(err){
    // sin la tabla de la fase 2 las metas igual quedan en el perfil
    console.warn('historial de metas:', err.message || err);
  }
  await renderToday();
}

document.getElementById('saveGoalsBtn').addEventListener('click', async () => {
  const goals = {
    goal_kcal: Number(document.getElementById('goalKcal').value),
    goal_protein_g: Number(document.getElementById('goalProtein').value),
    goal_carbs_g: Number(document.getElementById('goalCarbs').value),
    goal_fat_g: Number(document.getElementById('goalFat').value),
    goal_water_ml: Number(document.getElementById('goalWater').value)
  };
  if(Object.values(goals).some(v => !Number.isFinite(v) || v <= 0)){
    showToast('Todas las metas deben ser mayores a 0');
    return;
  }
  try{
    await saveGoals(goals);
    renderSuggestion();
    showToast('Metas guardadas desde hoy');
  }catch(err){ showToast('Error: ' + err.message); }
});

/* ================= objetivo: datos → qué quieres → meta ================= */
/* Como un divisor de tensión: entras con tus datos (la entrada), eliges el
   ritmo (la resistencia) y la meta sale sola. Todo se recalcula al tocar. */

function latestWeight(){ return weights.length ? Number(weights[0].weight_kg) : null; }

const objState = { sex: null, pace: 0, training: 3 };

function fillBodyInputs(){
  const b = bodyProfile || {};
  objState.sex = b.sex || null;
  objState.pace = paceOf(b);
  objState.training = Number(b.training_days ?? 3);
  document.getElementById('bodyAge').value = b.birth_year ? new Date().getFullYear() - b.birth_year : '';
  document.getElementById('bodyHeight').value = b.height_cm || '';
  const kg = latestWeight();
  document.getElementById('bodyWeight').value = kg ? String(kg).replace('.', ',') : '';
  renderObjectiveChoices();
  renderSuggestion();
}

function readWeightInput(){
  const kg = Number(String(document.getElementById('bodyWeight').value).replace(',', '.'));
  return kg > 20 && kg < 400 ? kg : null;
}

function readBodyInputs(){
  const age = Number(document.getElementById('bodyAge').value);
  return {
    sex: objState.sex,
    birth_year: age > 0 ? new Date().getFullYear() - age : null,
    height_cm: Number(document.getElementById('bodyHeight').value) || null,
    objective: objectiveOf(objState.pace),
    pace_kg_week: objState.pace,
    training_days: objState.training
  };
}

function renderObjectiveChoices(){
  document.querySelectorAll('#sexChips [data-sex]').forEach(b => b.classList.toggle('selected', b.dataset.sex === objState.sex));
  document.getElementById('paceList').innerHTML = PACES.map(p => `
    <button type="button" class="pace-opt${p.kg === objState.pace ? ' selected' : ''}" data-pace="${p.kg}">
      <span class="po-dot" aria-hidden="true"></span>
      <span class="po-text"><span class="po-label">${p.label}</span><span class="po-sub">${p.sub}</span></span>
    </button>`).join('');
  document.getElementById('trainChips').innerHTML = [0,1,2,3,4,5,6,7].map(n =>
    `<button type="button" class="chip${n === objState.training ? ' selected' : ''}" data-train="${n}">${n}</button>`).join('');
}

document.getElementById('sexChips').addEventListener('click', e => {
  const b = e.target.closest('[data-sex]'); if(!b) return;
  objState.sex = b.dataset.sex; renderObjectiveChoices(); renderSuggestion();
});
document.getElementById('paceList').addEventListener('click', e => {
  const b = e.target.closest('[data-pace]'); if(!b) return;
  objState.pace = Number(b.dataset.pace); renderObjectiveChoices(); renderSuggestion();
});
document.getElementById('trainChips').addEventListener('click', e => {
  const b = e.target.closest('[data-train]'); if(!b) return;
  objState.training = Number(b.dataset.train); renderObjectiveChoices(); renderSuggestion();
});
['bodyAge','bodyHeight','bodyWeight'].forEach(id => document.getElementById(id).addEventListener('input', renderSuggestion));

let lastSuggestion = null;
function renderSuggestion(){
  const box = document.getElementById('goalResult');
  const btn = document.getElementById('saveObjectiveBtn');
  const kg = readWeightInput();
  const s = suggestGoals(readBodyInputs(), kg);
  lastSuggestion = s;
  btn.disabled = !s;
  if(!s){
    const missing = [!objState.sex && 'sexo', !document.getElementById('bodyAge').value && 'edad',
      !document.getElementById('bodyHeight').value && 'altura', !kg && 'peso'].filter(Boolean);
    box.innerHTML = `<div class="gr-empty">Completa ${missing.join(', ')} en el paso 1 para calcular tu meta.</div>`;
    return;
  }
  const g = s.goals;
  const now = goalsFor(todayStr());
  const delta = Math.round(g.goal_kcal - s.tdee);
  const pace = s.realPace;
  const paceTxt = pace === 0 ? 'para mantener tu peso'
    : `para ${pace < 0 ? 'bajar' : 'subir'} ≈ ${String(Math.abs(pace)).replace('.', ',')} kg por semana`;
  box.innerHTML = `
    <div class="gr-kcal"><b class="mono">${g.goal_kcal}</b> kcal al día</div>
    <div class="gr-why">${paceTxt} · gastas ≈ ${s.tdee} kcal${delta ? ` (${delta > 0 ? '+' : '−'}${Math.abs(delta)})` : ''}</div>
    ${s.clamped ? `<div class="gr-warn">Ese ritmo bajaría de tu mínimo seguro; se dejó en ${g.goal_kcal} kcal.</div>` : ''}
    <div class="gr-macros">
      <span><b class="mono">${g.goal_protein_g}</b> g proteína</span>
      <span><b class="mono">${g.goal_carbs_g}</b> g carbos</span>
      <span><b class="mono">${g.goal_fat_g}</b> g grasa</span>
      <span><b class="mono">${fmtLiters(g.goal_water_ml)}</b> L agua</span>
    </div>
    ${Math.round(now.goal_kcal) !== g.goal_kcal ? `<div class="gr-now">Ahora tienes ${Math.round(now.goal_kcal)} kcal.</div>` : '<div class="gr-now">Ya son tus metas actuales.</div>'}`;
}

document.getElementById('saveObjectiveBtn').addEventListener('click', async (ev) => {
  if(!lastSuggestion) return;
  const fields = readBodyInputs();
  if(fields.height_cm < 100 || fields.height_cm > 250){ showToast('La altura va en cm (100–250)'); return; }
  const btn = ev.currentTarget;
  btn.disabled = true; btn.textContent = 'Guardando...';
  try{
    // el peso del paso 1 cuenta como el de hoy si cambió
    const kg = readWeightInput();
    if(kg && kg !== latestWeight()){
      const row = await saveWeight(user.id, todayStr(), kg);
      weights = [row, ...weights.filter(w => w.log_date !== row.log_date)];
      renderWeights();
    }
    try{ bodyProfile = await saveBodyProfile(user.id, fields); }
    catch(err){ if(err.saved){ bodyProfile = err.saved; showError(err.message); } else throw err; }
    await saveGoals(lastSuggestion.goals);
    fillGoalInputs(lastSuggestion.goals);
    renderSuggestion();
    showToast('Objetivo guardado: metas nuevas desde hoy');
  }catch(err){ showToast('Error: ' + err.message); }
  finally{ btn.disabled = !lastSuggestion; btn.textContent = 'Guardar objetivo'; }
});

/* ================= peso corporal ================= */

function renderWeights(){
  const wrap = document.getElementById('weightList');
  if(!weights.length){ wrap.innerHTML = `<div class="search-empty">Todavía no hay pesos registrados.</div>`; return; }
  const asc = weights.slice(0, 60).reverse();   // del más viejo al más nuevo
  let chart = '';
  if(asc.length >= 2){
    // gráfica mínima en SVG: x = posición en la lista, y = peso
    const vals = asc.map(w => Number(w.weight_kg));
    const min = Math.min(...vals), max = Math.max(...vals), span = Math.max(max - min, 0.5);
    const W = 300, H = 70, pad = 6;
    const pts = vals.map((v, i) => `${(pad + (i * (W - 2 * pad)) / (vals.length - 1)).toFixed(1)},${(H - pad - ((v - min) / span) * (H - 2 * pad)).toFixed(1)}`).join(' ');
    const diff = vals[vals.length - 1] - vals[0];
    chart = `<svg class="weight-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Gráfica de peso">
        <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="weight-diff">${diff > 0 ? '+' : ''}${diff.toFixed(1).replace('.', ',')} kg desde el ${new Date(asc[0].log_date + 'T12:00:00').toLocaleDateString('es-VE', { day:'numeric', month:'short' })}</div>`;
  }
  wrap.innerHTML = chart + `<div class="combo-items">${weights.slice(0, 7).map(w => `
    <div class="combo-item"><span><span class="mono entry-time">${new Date(w.log_date + 'T12:00:00').toLocaleDateString('es-VE', { weekday:'short', day:'numeric', month:'short' })}</span> ${String(Number(w.weight_kg)).replace('.', ',')} kg</span>
      <button class="entry-del" data-del-weight="${w.id}" type="button">eliminar</button></div>`).join('')}</div>`;
  wrap.querySelectorAll('[data-del-weight]').forEach(b => b.addEventListener('click', async () => {
    try{
      await deleteWeight(b.dataset.delWeight);
      weights = weights.filter(w => w.id !== b.dataset.delWeight);
      renderWeights();
      renderSuggestion();
    }catch(err){ showToast('Error: ' + err.message); }
  }));
}

document.getElementById('saveWeightBtn').addEventListener('click', async () => {
  const kg = Number(String(document.getElementById('weightInput').value).replace(',', '.'));
  if(!(kg > 20 && kg < 400)){ showToast('Escribe tu peso en kg'); return; }
  try{
    const row = await saveWeight(user.id, todayStr(), kg);
    weights = [row, ...weights.filter(w => w.log_date !== row.log_date)];
    document.getElementById('weightInput').value = '';
    document.getElementById('bodyWeight').value = String(kg).replace('.', ',');
    renderWeights();
    renderSuggestion();
    showToast('Peso guardado');
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
    const [entries, water, suppLogs, allSupps] = await Promise.all([
      getEntriesInRange(user.id, from, to),
      getWaterLogs(user.id, from, to).catch(() => []),
      getSupplementLogsInRange(user.id, from, to).catch(() => []),
      getSupplements(user.id, true).catch(() => [])
    ]);
    const suppNames = new Map(allSupps.map(s => [s.id, s.name + (s.dose ? ' ' + s.dose : '')]));
    const text = buildReportText({
      displayName: profile.display_name, fromDate: from, toDate: to, entries, goalsFor,
      water, suppLogs, suppNames, weights: weights.filter(w => w.log_date >= from && w.log_date <= to)
    });
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
