-- ============================================================
-- ASCLEPIO — fase 2b: comidas por momento y ritmo de peso
-- Pega todo este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de schema.sql y fase2.sql.
-- Es idempotente: se puede correr dos veces. No borra datos ni
-- cambia registros que ya existen.
-- ============================================================


-- ------------------------------------------------------------
-- 1. "MERIENDA" COMO MOMENTO DE COMIDA
-- La tabla solo aceptaba Desayuno, Almuerzo, Cena y Snack. Se
-- reemplaza esa regla por una que también acepta Merienda.
-- "Snack" se sigue aceptando para que los registros viejos sean
-- válidos; la app los muestra como Merienda.
-- ------------------------------------------------------------
alter table public.food_logs drop constraint if exists food_logs_momento_check;
alter table public.food_logs add constraint food_logs_momento_check
  check (momento in ('Desayuno', 'Almuerzo', 'Cena', 'Merienda', 'Snack'));


-- ------------------------------------------------------------
-- 2. RITMO DE PESO EN EL PERFIL FÍSICO
-- Kilos por semana que quieres bajar (negativo) o subir
-- (positivo). 0 = mantener. La app ofrece −0,75, −0,25, 0,
-- +0,25 y +0,5. "objective" se sigue llenando (perder,
-- mantener o ganar) para no romper nada que lo lea.
-- La tabla ya tiene RLS y GRANT de fase2.sql: una columna
-- nueva no necesita permisos aparte.
-- ------------------------------------------------------------
alter table public.body_profiles add column if not exists pace_kg_week numeric;

alter table public.body_profiles drop constraint if exists body_profiles_pace_check;
alter table public.body_profiles add constraint body_profiles_pace_check
  check (pace_kg_week is null or pace_kg_week between -1 and 1);
