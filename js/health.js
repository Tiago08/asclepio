// Fase 2: metas por día, perfil físico, peso, suplementos, agua y combos.
// Solo acceso a datos y cálculos; las pantallas están en app.js.
import { supabase } from './supabaseClient.js?v=9';

function must({ data, error }) {
  if (error) throw error;
  return data;
}

/* ================= metas por día ================= */

export const GOAL_KEYS = ['goal_kcal', 'goal_protein_g', 'goal_carbs_g', 'goal_fat_g', 'goal_water_ml'];

export async function getGoalHistory(userId) {
  return must(await supabase.from('goal_history').select('*').eq('user_id', userId)
    .order('valid_from', { ascending: true })) || [];
}

/** Guarda las metas que valen desde `date` (si ya hay una fila ese día, la reemplaza). */
export async function saveGoalsFrom(userId, date, goals) {
  return must(await supabase.from('goal_history')
    .upsert({ user_id: userId, valid_from: date, ...goals }, { onConflict: 'user_id,valid_from' })
    .select().single());
}

/**
 * Metas de un día: la fila más reciente con valid_from <= día.
 * Como un registro de desplazamiento: cada cambio "empuja" metas nuevas
 * y los días viejos siguen leyendo las que estaban vigentes.
 */
export function goalsForDate(history, profile, date) {
  let pick = null;
  for (const row of history) {
    if (row.valid_from <= date) pick = row; else break;
  }
  const src = pick || profile || {};
  const out = {};
  GOAL_KEYS.forEach(k => { out[k] = src[k] != null ? Number(src[k]) : (profile ? Number(profile[k]) : null); });
  if (!out.goal_water_ml) out.goal_water_ml = 2500;
  return out;
}

/* ================= perfil físico ================= */

export async function getBodyProfile(userId) {
  return must(await supabase.from('body_profiles').select('*').eq('user_id', userId).maybeSingle());
}

export async function saveBodyProfile(userId, fields) {
  return must(await supabase.from('body_profiles')
    .upsert({ user_id: userId, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select().single());
}

// Factor de actividad según días de entreno por semana
function activityFactor(days) {
  if (days <= 0) return 1.2;
  if (days <= 2) return 1.375;
  if (days <= 4) return 1.55;
  if (days <= 6) return 1.725;
  return 1.9;
}

/**
 * Metas sugeridas a partir del perfil físico y el peso.
 * 1. Gasto en reposo (Mifflin-St Jeor): 10·kg + 6,25·cm − 5·edad + 5 (hombre) o − 161 (mujer).
 * 2. × factor de actividad = gasto diario.
 * 3. Objetivo: perder −20 %, mantener igual, ganar +10 %.
 * 4. Proteína por kg (2,2 perder · 1,8 mantener · 2,0 ganar), grasa 25 % de las kcal,
 *    carbos = lo que sobra. Agua: 35 ml por kg.
 * Devuelve null si falta algún dato.
 */
export function suggestGoals(body, weightKg, year = new Date().getFullYear()) {
  if (!body || !weightKg || !body.height_cm || !body.birth_year || !body.sex) return null;
  const age = year - body.birth_year;
  const bmr = 10 * weightKg + 6.25 * Number(body.height_cm) - 5 * age + (body.sex === 'hombre' ? 5 : -161);
  const tdee = bmr * activityFactor(Number(body.training_days ?? 3));
  const adj = { perder: 0.8, mantener: 1, ganar: 1.1 }[body.objective] ?? 1;
  const kcal = Math.round((tdee * adj) / 10) * 10;
  const protPerKg = { perder: 2.2, mantener: 1.8, ganar: 2.0 }[body.objective] ?? 1.8;
  const protein = Math.round(weightKg * protPerKg);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const water = Math.round((weightKg * 35) / 250) * 250;
  return {
    bmr: Math.round(bmr), tdee: Math.round(tdee), age,
    goals: { goal_kcal: kcal, goal_protein_g: protein, goal_carbs_g: carbs, goal_fat_g: fat, goal_water_ml: water }
  };
}

/* ================= peso corporal ================= */

export async function getWeights(userId, limit = 90) {
  return must(await supabase.from('weight_logs').select('*').eq('user_id', userId)
    .order('log_date', { ascending: false }).limit(limit)) || [];
}

/** Un peso por día: si ya pesaste hoy, se reemplaza. */
export async function saveWeight(userId, date, kg) {
  return must(await supabase.from('weight_logs')
    .upsert({ user_id: userId, log_date: date, weight_kg: kg }, { onConflict: 'user_id,log_date' })
    .select().single());
}

export async function deleteWeight(id) {
  must(await supabase.from('weight_logs').delete().eq('id', id));
}

/* ================= suplementos ================= */

/** Tu pila activa; con includeRetired también los que quitaste (para el reporte). */
export async function getSupplements(userId, includeRetired = false) {
  let q = supabase.from('supplements').select('*').eq('user_id', userId);
  if (!includeRetired) q = q.eq('active', true);
  return must(await q.order('sort', { ascending: true })) || [];
}

export async function addSupplement(userId, name, dose, sort) {
  return must(await supabase.from('supplements')
    .insert({ user_id: userId, name, dose: dose || null, sort }).select().single());
}

/** Quitar de la pila sin borrar el historial de días que lo tomaste. */
export async function retireSupplement(id) {
  must(await supabase.from('supplements').update({ active: false }).eq('id', id));
}

/** ids de los suplementos marcados ese día */
export async function getSupplementLogs(userId, date) {
  const rows = must(await supabase.from('supplement_logs').select('supplement_id')
    .eq('user_id', userId).eq('log_date', date)) || [];
  return new Set(rows.map(r => r.supplement_id));
}

export async function getSupplementLogsInRange(userId, from, to) {
  return must(await supabase.from('supplement_logs').select('*')
    .eq('user_id', userId).gte('log_date', from).lte('log_date', to)) || [];
}

export async function setSupplementTaken(userId, supplementId, date, taken) {
  if (taken) {
    must(await supabase.from('supplement_logs')
      .upsert({ user_id: userId, supplement_id: supplementId, log_date: date }, { onConflict: 'supplement_id,log_date' }));
  } else {
    must(await supabase.from('supplement_logs').delete().eq('supplement_id', supplementId).eq('log_date', date));
  }
}

/* ================= agua y electrolitos ================= */

export async function getWaterLogs(userId, from, to = from) {
  return must(await supabase.from('water_logs').select('*').eq('user_id', userId)
    .gte('log_date', from).lte('log_date', to).order('log_time', { ascending: true })) || [];
}

export async function addWater(userId, { date, time, ml, label = null, sodium_mg = null, potassium_mg = null, magnesium_mg = null }) {
  return must(await supabase.from('water_logs')
    .insert({ user_id: userId, log_date: date, log_time: time, ml, label, sodium_mg, potassium_mg, magnesium_mg })
    .select().single());
}

export async function deleteWater(id) {
  must(await supabase.from('water_logs').delete().eq('id', id));
}

/**
 * Electrolitos del día: lo que viene de la comida + lo de las bebidas.
 * foodRows = filas de food_logs del día; waterRows = filas de water_logs.
 */
export function electrolyteTotals(foodRows, waterRows) {
  const t = { sodium_mg: 0, potassium_mg: 0, magnesium_mg: 0 };
  foodRows.forEach(r => {
    if (r.sodium_mg != null) t.sodium_mg += Number(r.sodium_mg);
    if (r.potassium_mg != null) t.potassium_mg += Number(r.potassium_mg);
    const mg = r.micros && r.micros.magnesium_mg;
    if (mg != null) t.magnesium_mg += Number(mg);
  });
  waterRows.forEach(r => {
    ['sodium_mg', 'potassium_mg', 'magnesium_mg'].forEach(k => { if (r[k] != null) t[k] += Number(r[k]); });
  });
  return t;
}

/* ================= combos ================= */

/** Combos del usuario con sus ítems y el alimento de cada ítem: [{ id, name, items: [{..., food}] }] */
export async function getCombos(userId) {
  const combos = must(await supabase.from('food_combos').select('*').eq('user_id', userId)
    .order('created_at', { ascending: true })) || [];
  if (!combos.length) return [];
  const items = must(await supabase.from('food_combo_items').select('*')
    .in('combo_id', combos.map(c => c.id)).order('sort', { ascending: true })) || [];
  const foodIds = [...new Set(items.map(i => i.food_id))];
  const foods = foodIds.length ? (must(await supabase.from('foods').select('*').in('id', foodIds)) || []) : [];
  const byId = new Map(foods.map(f => [f.id, f]));
  return combos.map(c => ({
    ...c,
    items: items.filter(i => i.combo_id === c.id).map(i => ({ ...i, food: byId.get(i.food_id) })).filter(i => i.food)
  }));
}

/** items: [{ food_id, quantity, label }] */
export async function createCombo(userId, name, items) {
  const combo = must(await supabase.from('food_combos').insert({ user_id: userId, name }).select().single());
  const rows = items.map((it, i) => ({ combo_id: combo.id, user_id: userId, food_id: it.food_id, quantity: it.quantity, label: it.label, sort: i }));
  const { error } = await supabase.from('food_combo_items').insert(rows);
  if (error) {
    // sin ítems el combo no sirve: se deshace
    await supabase.from('food_combos').delete().eq('id', combo.id);
    throw error;
  }
  return combo;
}

export async function deleteCombo(id) {
  must(await supabase.from('food_combos').delete().eq('id', id));
}
