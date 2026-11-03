// Estas claves son seguras de exponer en el frontend por diseño:
// la "publishable key" de Supabase solo abre lo que las políticas
// de Row Level Security permitan, y la key de USDA solo limita
// cuántas peticiones por hora puede hacer esta app.
export const SUPABASE_URL = 'https://tzoccyztblmpoprghjbj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_2P-T98fJE_inIijGGjVp-A_9Vy8S_A0';
export const USDA_API_KEY = 'gBkbjGkTbDLmKcWz9FBh9PMwCkwfN6FMJDHDMgQt';
export const APP_NAME = 'Asclepio';
