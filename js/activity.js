import { supabase } from './supabaseClient.js?v=8';

export async function logActivity({ userId, type, date, time, data }) {
  const { data: row, error } = await supabase
    .from('activity_logs')
    .insert({ user_id: userId, type, log_date: date, log_time: time, data })
    .select()
    .single();
  if (error) throw error;
  return row;
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

export async function getRanking() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, streak_current, streak_best')
    .order('streak_current', { ascending: false });
  if (error) throw error;
  return data || [];
}
