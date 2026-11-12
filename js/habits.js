// Fase 3: hábitos. Solo acceso a datos; la pantalla está en app.js.
// No dan puntos ni cuentan para la racha.
import { supabase } from './supabaseClient.js?v=23';

function must({ data, error }) {
  if (error) throw error;
  return data;
}

// Momentos del día, en el orden en que pasan
export const HABIT_MOMENTS = [
  { key: 'manana', label: 'Mañana', icon: '🌅' },
  { key: 'tarde', label: 'Tarde', icon: '☀️' },
  { key: 'noche', label: 'Noche', icon: '🌙' },
  { key: 'cualquiera', label: 'Cualquier momento', icon: '◌' }
];

export async function getHabits(userId) {
  return must(await supabase.from('habits').select('*').eq('user_id', userId).eq('active', true)
    .order('sort', { ascending: true })) || [];
}

export async function addHabit(userId, { name, times_per_week, momento, sort }) {
  return must(await supabase.from('habits')
    .insert({ user_id: userId, name, times_per_week, momento, sort, active: true }).select().single());
}

export async function updateHabit(id, fields) {
  return must(await supabase.from('habits').update(fields).eq('id', id).select().single());
}

/** Archivar: deja de salir, pero las marcas de días pasados se quedan. */
export async function archiveHabit(id) {
  must(await supabase.from('habits').update({ active: false }).eq('id', id));
}

/** Marcas entre dos fechas: [{ habit_id, log_date }] */
export async function getHabitLogs(userId, from, to) {
  return must(await supabase.from('habit_logs').select('habit_id, log_date')
    .eq('user_id', userId).gte('log_date', from).lte('log_date', to)) || [];
}

export async function setHabitDone(userId, habitId, date, done) {
  if (done) {
    must(await supabase.from('habit_logs')
      .upsert({ user_id: userId, habit_id: habitId, log_date: date }, { onConflict: 'habit_id,log_date' }));
  } else {
    must(await supabase.from('habit_logs').delete().eq('habit_id', habitId).eq('log_date', date));
  }
}
