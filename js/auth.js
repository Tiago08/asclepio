import { supabase } from './supabaseClient.js?v=12';

/**
 * Pide un magic link al correo dado. Supabase crea la cuenta
 * la primera vez automáticamente (shouldCreateUser: true es el
 * default), así que sirve tanto para registro como para login.
 */
export async function sendMagicLink(email) {
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo }
  });
  if (error) throw error;
}

/**
 * Verifica el código de 6 dígitos que llega en el mismo correo.
 * Sirve para entrar dentro de la PWA instalada, donde el link
 * mágico no funciona (abre Safari, que tiene su propio almacenamiento).
 */
export async function verifyEmailCode(email, token) {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function updateGoals(userId, goals) {
  const { error } = await supabase
    .from('profiles')
    .update(goals)
    .eq('id', userId);
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Se dispara en cada cambio de sesión (login, logout, refresh de
 * token). callback recibe la sesión actual (o null si no hay).
 */
export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}

/**
 * Asegura que exista una fila en profiles para el usuario actual.
 * El trigger de la base de datos ya lo hace en el 99% de los casos;
 * esto es solo una red de seguridad.
 */
export async function ensureProfile(user) {
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!existing) {
    const displayName = (user.email || 'usuario').split('@')[0];
    await supabase.from('profiles').insert({ id: user.id, display_name: displayName });
  }
}

export async function getMyProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateDisplayName(userId, name) {
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: name })
    .eq('id', userId);
  if (error) throw error;
}
