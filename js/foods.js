import { supabase } from './supabaseClient.js?v=17';
import { USDA_API_KEY } from './config.js?v=17';
import { dictQueryToEnglish, normalizeText } from './foodDict.js?v=17';

// Campos nutricionales que manejamos en toda la app, en el orden
// en que se muestran. Un solo lugar para no desincronizar listas.
export const NUTRIENT_FIELDS = [
  { key: 'kcal', label: 'Energía', unit: 'kcal' },
  { key: 'carbs_g', label: 'Carbohidratos', unit: 'g' },
  { key: 'sugars_g', label: 'Azúcares', unit: 'g' },
  { key: 'protein_g', label: 'Proteína', unit: 'g' },
  { key: 'fat_g', label: 'Grasa total', unit: 'g' },
  { key: 'sat_fat_g', label: 'Grasa saturada', unit: 'g' },
  { key: 'fiber_g', label: 'Fibra', unit: 'g' },
  { key: 'sodium_mg', label: 'Sodio', unit: 'mg' },
  { key: 'potassium_mg', label: 'Potasio', unit: 'mg' },
  { key: 'calcium_mg', label: 'Calcio', unit: 'mg' },
  { key: 'iron_mg', label: 'Hierro', unit: 'mg' },
  { key: 'vit_a_mcg', label: 'Vitamina A', unit: 'mcg' },
  { key: 'vit_c_mg', label: 'Vitamina C', unit: 'mg' },
  { key: 'vit_d_mcg', label: 'Vitamina D', unit: 'mcg' },
  { key: 'vit_b12_mcg', label: 'Vitamina B12', unit: 'mcg' }
];

// Micronutrientes del campo flexible "micros" (JSONB). Para agregar uno nuevo
// basta con sumarlo aquí (y su número de USDA abajo): no hay que tocar la tabla.
export const MICRO_FIELDS = [
  { key: 'magnesium_mg', label: 'Magnesio', unit: 'mg' },
  { key: 'zinc_mg', label: 'Zinc', unit: 'mg' },
  { key: 'vit_b6_mg', label: 'Vitamina B6', unit: 'mg' },
  { key: 'folate_mcg', label: 'Folato', unit: 'mcg' },
  { key: 'omega3_mg', label: 'Omega-3 (EPA+DHA)', unit: 'mg' }
];

// número de nutriente de USDA -> campo de "micros" (EPA y DHA se suman aparte)
const USDA_MICRO_MAP = {
  '304': 'magnesium_mg', '1090': 'magnesium_mg',
  '309': 'zinc_mg', '1095': 'zinc_mg',
  '415': 'vit_b6_mg', '1175': 'vit_b6_mg',
  '435': 'folate_mcg', '1190': 'folate_mcg'
};
const USDA_FOLATE_TOTAL = ['417', '1177'];   // si no trae folato DFE, se usa el total
const USDA_EPA = ['629', '1278'], USDA_DHA = ['621', '1272'];   // en gramos

/** Multiplica cada micro por la cantidad; devuelve un objeto nuevo. */
export function scaleMicros(micros, q) {
  const out = {};
  for (const [k, v] of Object.entries(micros || {})) {
    if (v != null && Number.isFinite(Number(v))) out[k] = Math.round(Number(v) * Number(q) * 1000) / 1000;
  }
  return out;
}

// nutrientNumber (USDA, estable entre bases) -> nuestro campo
const USDA_NUTRIENT_MAP = {
  '208': 'kcal', '1008': 'kcal',
  // los alimentos "Foundation" traen la energía solo con factores Atwater
  '957': 'kcal', '958': 'kcal', '2047': 'kcal', '2048': 'kcal',
  '205': 'carbs_g', '1005': 'carbs_g',
  '269': 'sugars_g', '1063': 'sugars_g',
  '203': 'protein_g', '1003': 'protein_g',
  '204': 'fat_g', '1004': 'fat_g',
  '606': 'sat_fat_g', '1258': 'sat_fat_g',
  '291': 'fiber_g', '1079': 'fiber_g',
  '307': 'sodium_mg', '1093': 'sodium_mg',
  '306': 'potassium_mg', '1092': 'potassium_mg',
  '301': 'calcium_mg', '1087': 'calcium_mg',
  '303': 'iron_mg', '1089': 'iron_mg',
  '320': 'vit_a_mcg', '1106': 'vit_a_mcg',
  '401': 'vit_c_mg', '1162': 'vit_c_mg',
  '328': 'vit_d_mcg', '1114': 'vit_d_mcg',
  '418': 'vit_b12_mcg', '1178': 'vit_b12_mcg'
};

function emptyNutrients() {
  const o = {};
  NUTRIENT_FIELDS.forEach(f => { o[f.key] = null; });
  return o;
}

/* ---- traducción con MyMemory (gratis, sin API key) ---- */
/* Cacheamos en localStorage para no volver a traducir lo mismo. */

// v2: la v1 pudo guardar traducciones malas de nombres en MAYÚSCULAS; se descarta
const TRANSLATE_CACHE_KEY = 'asclepio_translate_cache_v2';
try { localStorage.removeItem('asclepio_translate_cache_v1'); } catch (e) { /* no crítico */ }
const translateCache = new Map();
try {
  const raw = localStorage.getItem(TRANSLATE_CACHE_KEY);
  if (raw) JSON.parse(raw).forEach(([k, v]) => translateCache.set(k, v));
} catch (e) { /* localStorage no disponible, seguimos sin cache persistente */ }

function saveTranslateCache() {
  try {
    const entries = [...translateCache.entries()].slice(-800); // evita crecer sin límite
    localStorage.setItem(TRANSLATE_CACHE_KEY, JSON.stringify(entries));
  } catch (e) { /* no crítico */ }
}

function toSentenceCase(str) {
  if (!str) return str;
  const lower = str.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Si MyMemory dice que se acabó la cuota diaria, dejamos de llamarlo
// hasta recargar la app (cada llamada extra solo gasta tiempo).
let translateQuotaExhausted = false;
// Peticiones en curso: si 7 resultados se llaman "RICE", se traduce una sola vez.
const translateInFlight = new Map();

/** Una llamada a MyMemory. Devuelve el texto traducido o null. */
async function myMemory(text, pair, email) {
  if (translateQuotaExhausted) return null;
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`
      + (email ? `&de=${encodeURIComponent(email)}` : '');
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const status = Number(json?.responseStatus);
    const translated = json?.responseData?.translatedText;
    const upper = typeof translated === 'string' ? translated.toUpperCase() : '';
    // MyMemory avisa de la cuota con HTTP 200 y el aviso como "traducción".
    if (status === 429 || upper.includes('MYMEMORY WARNING') || upper.includes('USED ALL AVAILABLE')) {
      translateQuotaExhausted = true;
      return null;
    }
    if (status === 200 && translated && !upper.includes('QUERY LENGTH LIMIT')) return translated.trim();
  } catch (e) { /* sin red: seguimos sin traducir */ }
  return null;
}

/** Traducción EN -> ES ya guardada, sin llamar a la red (o null). */
export function cachedSpanish(text) {
  if (!text) return null;
  return translateCache.get(text.trim().toLowerCase()) ?? null;
}

/** Traduce un nombre EN -> ES. Si no se puede, lo devuelve sin MAYÚSCULAS. */
export async function translateToSpanish(text, email) {
  if (!text) return text;
  const key = text.trim().toLowerCase();
  if (translateCache.has(key)) return translateCache.get(key);
  const fallback = toSentenceCase(text.trim());
  if (translateInFlight.has(key)) return translateInFlight.get(key);

  // Mandamos el texto en minúsculas: en MAYÚSCULAS ("RICE") MyMemory
  // devuelve a veces traducciones absurdas ("Crudo").
  const job = myMemory(fallback, 'en|es', email).then(t => {
    if (!t) return fallback;
    const clean = toSentenceCase(t);
    translateCache.set(key, clean);
    saveTranslateCache();
    return clean;
  });
  translateInFlight.set(key, job);
  try { return await job; } finally { translateInFlight.delete(key); }
}

/** Lo que el usuario escribió (español) -> búsqueda en inglés para USDA. */
async function queryToEnglish(query, email) {
  const fromDict = dictQueryToEnglish(query);
  if (fromDict) return fromDict;
  const key = 'es>en:' + normalizeText(query);
  if (translateCache.has(key)) return translateCache.get(key);
  const t = await myMemory(query.trim().toLowerCase(), 'es|en', email);
  if (!t) return query;
  const en = t.toLowerCase();
  translateCache.set(key, en);
  saveTranslateCache();
  return en;
}

/* ---- limpieza de nombres de USDA ---- */

// Prefijos de categoría que estorban: "Restaurant, Latino, arroz con leche"
const NAME_PREFIXES = /^(restaurant|restaurants|fast foods?)\s*,\s*((latino|chinese|mexican|italian|japanese|family style|thai|greek)\s*,\s*)?/i;

function removePhrase(text, phrase) {
  if (!phrase || phrase.length < 2) return text;
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = text.replace(new RegExp(`(^|[\\s,])${esc}(?=$|[\\s,])`, 'ig'), ' ');
  return out.replace(/\s*,\s*,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s{2,}/g, ' ');
}

/** Quita prefijos de categoría, paréntesis y (en productos de marca) la marca del nombre. */
function cleanUsdaName(food) {
  let name = String(food.description || '').trim();
  name = name.replace(NAME_PREFIXES, '');
  name = name.replace(/\s*\([^)]*\)/g, '').trim(); // "(rice pudding)", "(Includes foods for...)"
  if (food.dataType === 'Branded') {
    for (const brand of [food.brandName, food.brandOwner]) {
      const without = removePhrase(name, brand);
      if (without.length >= 3) name = without;
    }
    // Las marcas repiten trozos: "ARROZ CASERO, ARROZ" -> "ARROZ CASERO"
    const kept = [];
    for (const seg of name.split(',').map(x => x.trim()).filter(Boolean)) {
      if (!normalizeText(kept.join(' ')).includes(normalizeText(seg))) kept.push(seg);
    }
    if (kept.length) name = kept.join(', ');
  }
  return name || String(food.description || '');
}

function usdaFoodToRow(food) {
  const row = emptyNutrients();
  const micros = {};
  let folateTotal = null, omega = null;
  (food.foodNutrients || []).forEach(n => {
    const num = String(n.nutrientNumber ?? n.number ?? '');
    const value = typeof n.value === 'number' ? n.value : (n.amount ?? null);
    const field = USDA_NUTRIENT_MAP[num];
    if (field && row[field] == null) row[field] = value;
    if (value == null) return;
    const micro = USDA_MICRO_MAP[num];
    if (micro && micros[micro] == null) micros[micro] = value;
    if (USDA_FOLATE_TOTAL.includes(num)) folateTotal = value;
    if (USDA_EPA.includes(num) || USDA_DHA.includes(num)) omega = (omega || 0) + value * 1000; // g -> mg
  });
  if (micros.folate_mcg == null && folateTotal != null) micros.folate_mcg = folateTotal;
  if (omega != null) micros.omega3_mg = Math.round(omega);
  const nameEn = cleanUsdaName(food);
  const cached = cachedSpanish(nameEn);
  const brand = food.brandName || food.brandOwner || null; // la marca, no la corporación
  return {
    source: 'usda',
    usda_fdc_id: String(food.fdcId),
    name: cached || toSentenceCase(nameEn),
    brand: brand ? toSentenceCase(brand) : null,
    category: food.foodCategory || null,
    serving_label: '100 g',
    serving_grams: 100,
    ...row,
    micros,
    // campos internos (empiezan por "_"): no se guardan en la base de datos
    _en: nameEn,
    _kind: food.dataType === 'Branded' ? 'branded' : 'generic',
    _needsTr: !cached
  };
}

async function usdaRequest(query, dataType, pageSize, allWords = false) {
  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('api_key', USDA_API_KEY);
  url.searchParams.set('query', query);
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('dataType', dataType);
  // por defecto USDA acepta CUALQUIER palabra: "leche deslactosada" traía
  // "galleta de leche" y "tres leches". Con esto tienen que estar todas.
  if (allWords) url.searchParams.set('requireAllWords', 'true');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('USDA search failed: ' + res.status);
  const json = await res.json();
  return json.foods || [];
}

/**
 * Busca en USDA y devuelve filas SIN esperar a traducir los nombres
 * (los que no están en caché vienen con _needsTr = true; app.js los
 * traduce después y los cambia en pantalla). Devuelve { rows, enQuery }.
 */
export async function searchUsda(query, userEmail) {
  if (!query || query.trim().length < 2) return { rows: [], enQuery: '' };
  // Tres peticiones en paralelo, todas exigiendo todas las palabras en las de marca:
  //  - genéricos (Foundation/SR Legacy) con la búsqueda en inglés: USDA está en inglés.
  //  - de marca con lo que escribió el usuario: así salen productos latinos ("Savoy").
  //  - de marca con la búsqueda en inglés: "lactose free milk" (Lactaid, Natrel...).
  const brandedEsP = usdaRequest(query.trim(), 'Branded', 15, true).catch(() => []);
  const enQuery = await queryToEnglish(query, userEmail);
  const genericP = usdaRequest(enQuery, 'Foundation,SR Legacy', 50).catch(() => []);
  const sameQuery = normalizeText(enQuery) === normalizeText(query);
  const brandedEnP = sameQuery ? Promise.resolve([]) : usdaRequest(enQuery, 'Branded', 15, true).catch(() => []);
  const [generic, brandedEs, brandedEn] = await Promise.all([genericP, brandedEsP, brandedEnP]);

  // USDA repite fichas idénticas (mismo nombre, marca y kcal): se deja una.
  const seen = new Set();
  const rows = [];
  for (const f of [...generic, ...brandedEn, ...brandedEs]) {
    const row = usdaFoodToRow(f);
    const key = [normalizeText(row._en), normalizeText(row.brand), Math.round(row.kcal ?? -1)].join('|');
    if (seen.has(f.fdcId) || seen.has(key)) continue;
    seen.add(f.fdcId);
    seen.add(key);
    rows.push(row);
  }
  return { rows, enQuery };
}

/* ---- orden por relevancia (como MyFitnessPal) ---- */

// Categorías que casi nunca son lo que se busca: "Babyfood, banana", "Snacks, rice cakes"
const NOISY_PREFIX = /^(babyfood|snacks?|fast foods?|restaurant|beverages|cereals ready to eat|infant formula|school lunch)\b/;
const ODD_FORM = /\b(puffed|powder|dried|dehydrated|flour|bran|substitute|imitation|restaurant|meatless|spread|feet)\b/;

/** 0 = empieza por lo buscado, 1 = todas las palabras, 2 = alguna, 3 = ninguna */
function matchLevel(name, query) {
  const n = normalizeText(name);
  const q = normalizeText(query);
  if (!n || !q) return 3;
  if (n === q || n === q + 's' || n.startsWith(q + ' ') || n.startsWith(q + 's ')) return 0;
  const words = q.split(' ');
  const has = w => new RegExp(`(^| )${w}(s|es)?( |$)`).test(n);
  if (words.every(has)) return 1;
  if (words.some(w => n.includes(w))) return 2;
  return 3;
}

/**
 * Ordena alimentos locales y de USDA juntos. Menor puntaje = más arriba:
 *  1. lo que mejor coincide con la búsqueda (empieza por la palabra > la contiene)
 *  2. lo que el usuario ya ha registrado antes
 *  3. genéricos antes que productos de marca
 *  4. sin ruido (snacks, comida para bebé, restaurante...)
 *  5. nombres más cortos (más "puros") primero
 */
export function rankFoods(items, query, enQuery, usedIds = new Set()) {
  const scored = items.map(f => {
    let level = 3;
    for (const nm of [f.name, f._en]) {
      if (!nm) continue;
      level = Math.min(level, matchLevel(nm, query));
      if (enQuery) level = Math.min(level, matchLevel(nm, enQuery));
    }
    const isBranded = f._kind ? f._kind === 'branded' : !!f.brand;
    const base = normalizeText(f._en || f.name);
    let score = level * 100;
    // tus alimentos (guardados en la tabla) suben; y más si ya los registraste
    if (f.id && level <= 1) score -= usedIds.has(f.id) ? 90 : 40;
    // básicos (como los "Best Match" de MyFitnessPal): suben sobre lo genérico
    if (f._kind === 'basic' && level <= 1) score -= 30;
    if (isBranded) score += 30;
    if (NOISY_PREFIX.test(base)) score += 25;
    if (ODD_FORM.test(base)) score += 10;
    if (f.kcal == null) score += 15; // sin kcal casi no sirve para registrar
    // desempate: los básicos van en el orden de su lista (el más común primero);
    // el resto, nombres más cortos (más "puros") primero
    score += f._kind === 'basic' && f._rank != null ? f._rank / 100 : Math.min(base.length, 80) / 10;
    return { f, score };
  });
  return scored.sort((a, b) => a.score - b.score).map(x => x.f);
}

/**
 * Elige qué mostrar de la lista ya ordenada. USDA trae decenas de variantes
 * genéricas ("arroz blanco grano largo crudo", "... cocido", "... con sal"...)
 * que llenarían toda la pantalla; se limitan para dejar sitio a tus alimentos
 * guardados y a los de marca, sin cambiar el orden.
 */
export function pickForDisplay(ranked, max = 20, caps = { generic: 12, branded: 6 }) {
  const picked = new Set();
  const used = { generic: 0, branded: 0 };
  for (const f of ranked) {
    if (picked.size >= max) break;
    const group = f.id ? null : f._kind; // los tuyos (con id) no tienen tope
    if (group && caps[group] != null) {
      if (used[group] >= caps[group]) continue;
      used[group]++;
    }
    picked.add(f);
  }
  for (const f of ranked) { // si sobra sitio, se rellena con los genéricos saltados
    if (picked.size >= max) break;
    picked.add(f);
  }
  return ranked.filter(f => picked.has(f));
}

export async function searchLocalFoods(query) {
  if (!query || query.trim().length < 2) return [];
  // busca en el nombre o en la marca ("Savoy" encuentra tus alimentos de esa marca);
  // fuera comas, paréntesis y asteriscos, que en el filtro "or" de Supabase son sintaxis
  const q = query.trim().replace(/[,()*]/g, ' ').replace(/\s+/g, ' ');
  // el nombre tiene que tener TODAS las palabras, en cualquier orden:
  // "leche deslactosada" encuentra "Leche Savoy deslactosada"
  const words = q.split(' ').filter(w => w.length > 1 && !['de', 'del', 'con', 'la', 'el', 'y'].includes(w.toLowerCase()));
  const nameCond = words.length > 1
    ? `and(${words.map(w => `name.ilike.*${w}*`).join(',')})`
    : `name.ilike.*${q}*`;
  const { data, error } = await supabase
    .from('foods')
    .select('*')
    .or(`${nameCond},brand.ilike.*${q}*`)
    .order('name', { ascending: true })
    .limit(15);
  if (error) throw error;
  return data || [];
}

export async function searchFavorites(userId, limit = 6) {
  // "más frecuentes" = alimentos más logueados por este usuario en food_logs
  const { data, error } = await supabase
    .from('food_logs')
    .select('food_id, food_name_snapshot')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  const counts = new Map();
  (data || []).forEach(r => {
    if (!r.food_id) return;
    const prev = counts.get(r.food_id) || { count: 0, name: r.food_name_snapshot, food_id: r.food_id };
    prev.count += 1;
    counts.set(r.food_id, prev);
  });
  const topIds = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit).map(x => x.food_id);
  if (topIds.length === 0) return [];

  const { data: foods, error: err2 } = await supabase.from('foods').select('*').in('id', topIds);
  if (err2) throw err2;
  // mantener el orden de frecuencia
  const byId = new Map(foods.map(f => [f.id, f]));
  return topIds.map(id => byId.get(id)).filter(Boolean);
}

/** Inserta (si hace falta) una copia local de un resultado de USDA y devuelve la fila de foods. */
export async function cacheUsdaFood(usdaRow, userId, userEmail) {
  const { data: existing } = await supabase
    .from('foods')
    .select('*')
    .eq('source', 'usda')
    .eq('usda_fdc_id', usdaRow.usda_fdc_id)
    .maybeSingle();
  if (existing) return existing;

  // Los campos que empiezan por "_" son internos de la búsqueda: no son columnas.
  const fields = {};
  for (const [k, v] of Object.entries(usdaRow)) if (!k.startsWith('_')) fields[k] = v;
  // La categoría no se traduce en la búsqueda (no se muestra); se traduce al guardar.
  if (fields.category && usdaRow._kind !== 'basic') fields.category = await translateToSpanish(fields.category, userEmail);
  // Si el nombre aún no se había traducido en pantalla, se intenta una vez más.
  if (usdaRow._needsTr && usdaRow._en) fields.name = await translateToSpanish(usdaRow._en, userEmail);

  const { data, error } = await supabase
    .from('foods')
    .insert({ ...fields, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addCustomFood(fields, userId) {
  const { data, error } = await supabase
    .from('foods')
    .insert({ ...fields, source: 'custom', created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateFood(id, fields) {
  const { data, error } = await supabase
    .from('foods')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** "unidad mediana" -> "unidades medianas", "taza" -> "tazas". Para en "de"
    ("taza de arroz" -> "tazas de arroz") y no toca lo que tenga números. */
export function pluralEs(label){
  const words = String(label).split(' ');
  for(let i = 0; i < words.length; i++){
    const w = words[i];
    if(['de', 'del', 'con', 'sin', 'en'].includes(w.toLowerCase()) || /[\d()]/.test(w)) break;
    if(/[sx]$/i.test(w)) continue;
    if(/z$/i.test(w)) words[i] = w.slice(0, -1) + 'ces';
    else if(/[aeiouáéó]$/i.test(w)) words[i] = w + 's';
    else words[i] = w + 'es';
  }
  return words.join(' ');
}

/** Texto de un registro de comida: "Arroz blanco cocido · 1 taza" o, en los viejos, "Arepa x2". */
export function foodLogLabel(d) {
  let name = d.food_name_snapshot || '';
  // registros guardados antes del plural: "Arepa · 2 unidad" -> "Arepa · 2 unidades"
  name = name.replace(/ · (\d+(?:\.\d+)?) ([^·]+)$/, (all, n, unit) =>
    Number(n) === 1 || unit === 'g' || /^porci/.test(unit) ? all : ` · ${n} ${pluralEs(unit)}`);
  const q = Number(d.quantity);
  if (name.includes(' · ') || !q || q === 1) return name;
  return `${name} x${Math.round(q * 100) / 100}`;
}

export async function logFood({ userId, foodRow, quantity, momento, date, time, label }) {
  const payload = {
    user_id: userId,
    food_id: foodRow.id,
    food_name_snapshot: label || foodRow.name,
    momento,
    quantity,
    log_date: date,
    log_time: time
  };
  NUTRIENT_FIELDS.forEach(f => {
    const base = foodRow[f.key];
    payload[f.key] = (base === null || base === undefined) ? null : Number(base) * Number(quantity);
  });
  payload.micros = scaleMicros(foodRow.micros, quantity);
  let { data, error } = await supabase.from('food_logs').insert(payload).select().single();
  // Sin sql/fase2b.sql la tabla no acepta "Merienda" (error 23514 = regla check):
  // se guarda como "Snack", que la app muestra igual como Merienda.
  if (error && error.code === '23514' && momento === 'Merienda') {
    console.warn('Falta correr sql/fase2b.sql: Merienda se guarda como Snack');
    ({ data, error } = await supabase.from('food_logs').insert({ ...payload, momento: 'Snack' }).select().single());
  }
  if (error) throw error;
  return data;
}

/** Cambia un registro de comida a otro momento (ej. de Desayuno a Cena). */
export async function moveFoodLog(id, momento) {
  let { error } = await supabase.from('food_logs').update({ momento }).eq('id', id);
  // sin sql/fase2b.sql la tabla no acepta "Merienda": se guarda como "Snack" (igual que en logFood)
  if (error && error.code === '23514' && momento === 'Merienda') {
    ({ error } = await supabase.from('food_logs').update({ momento: 'Snack' }).eq('id', id));
  }
  if (error) throw error;
}

export async function deleteFoodLog(id) {
  const { error } = await supabase.from('food_logs').delete().eq('id', id);
  if (error) throw error;
}
