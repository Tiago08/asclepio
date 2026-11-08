import { supabase } from './supabaseClient.js?v=19';

export async function logActivity({ userId, type, date, time, data }) {
  const { data: row, error } = await supabase
    .from('activity_logs')
    .insert({ user_id: userId, type, log_date: date, log_time: time, data })
    .select()
    .single();
  if (error) throw error;
  return row;
}

/** Cambia un registro ya guardado (tocar Gym o Sueño cuando ya hay uno hoy). */
export async function updateActivityLog(id, { date, time, data }) {
  const { error } = await supabase.from('activity_logs')
    .update({ log_date: date, log_time: time, data }).eq('id', id);
  if (error) throw error;
}

/** "Deshacer": vuelve a guardar un registro borrado (mismo id). e = entrada de getEntries*. */
export async function restoreActivityLog(userId, e) {
  const { error } = await supabase.from('activity_logs')
    .insert({ id: e.id, user_id: userId, type: e.type, log_date: e.date, log_time: e.time, data: e.data });
  if (error) throw error;
}

export async function deleteActivityLog(id) {
  const { error } = await supabase.from('activity_logs').delete().eq('id', id);
  if (error) throw error;
}

export async function getEntriesForDate(userId, date) {
  const [{ data: activity, error: e1 }, { data: foods, error: e2 }] = await Promise.all([
    supabase.from('activity_logs').select('*').eq('user_id', userId).eq('log_date', date),
    supabase.from('food_logs').select('*').eq('user_id', userId).eq('log_date', date)
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return mergeEntries(activity || [], foods || []);
}

export async function getEntriesInRange(userId, fromDate, toDate) {
  const [{ data: activity, error: e1 }, { data: foods, error: e2 }] = await Promise.all([
    supabase.from('activity_logs').select('*').eq('user_id', userId).gte('log_date', fromDate).lte('log_date', toDate),
    supabase.from('food_logs').select('*').eq('user_id', userId).gte('log_date', fromDate).lte('log_date', toDate)
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return mergeEntries(activity || [], foods || []);
}

function hhmm(t) {
  return t ? String(t).slice(0, 5) : '';
}

function mergeEntries(activity, foods) {
  const a = activity.map(e => ({ kind: 'activity', id: e.id, type: e.type, date: e.log_date, time: hhmm(e.log_time), data: e.data }));
  const f = foods.map(e => ({ kind: 'food', id: e.id, type: 'comida', date: e.log_date, time: hhmm(e.log_time), data: e }));
  return [...a, ...f].sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
}

/**
 * Ranking: nombre y racha de cada perfil, más sus puntos de la semana
 * (desde weekStart) y totales. Si aún no se corrió sql/puntos.sql, la
 * tabla no existe: se devuelve el ranking solo con rachas (points = null).
 */
export async function getRanking(weekStart) {
  const [{ data, error }, pts] = await Promise.all([
    supabase.from('profiles').select('id, display_name, streak_current, streak_best'),
    // lo más reciente primero: si algún día pasa del tope de filas de Supabase
    // (1000), lo que se pierde es lo más viejo, nunca la semana actual
    supabase.from('daily_points').select('user_id, log_date, points').order('log_date', { ascending: false })
  ]);
  if (error) throw error;
  const hasPoints = !pts.error;
  if (pts.error) console.warn('Sin puntos (¿falta correr sql/puntos.sql?):', pts.error.message);
  const week = new Map(), total = new Map();
  (pts.data || []).forEach(r => {
    total.set(r.user_id, (total.get(r.user_id) || 0) + r.points);
    if (r.log_date >= weekStart) week.set(r.user_id, (week.get(r.user_id) || 0) + r.points);
  });
  return (data || []).map(p => ({
    ...p,
    points_week: hasPoints ? (week.get(p.id) || 0) : null,
    points_total: hasPoints ? (total.get(p.id) || 0) : null
  }));
}
