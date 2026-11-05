// Versión fija y empaquetada en UN archivo: "@2" a secas obligaba a esm.sh a
// resolver la versión y luego bajar ~8 módulos en cascada (varios segundos en móvil).
// Si cambias la versión, cámbiala también en el modulepreload de index.html.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0/es2022/supabase-js.bundle.mjs';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js?v=17';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
