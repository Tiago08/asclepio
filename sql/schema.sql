-- ============================================================
-- ASCLEPIO — esquema de base de datos (Supabase / Postgres)
-- Pega todo este archivo en Supabase → SQL Editor → Run.
-- Es seguro de volver a correr si algo falla a la mitad (usa
-- "if not exists" / "or replace" donde aplica), pero si ya
-- tienes datos cargados, revisa antes de repetirlo.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES
-- Un perfil por usuario autenticado. Solo guarda lo que el
-- grupo puede ver de los demás: nombre y racha. Nada de
-- comida, sueño ni notas vive aquí.
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  streak_current int not null default 0,
  streak_best int not null default 0,
  last_log_date date,
  goal_kcal numeric not null default 2000,
  goal_protein_g numeric not null default 150,
  goal_carbs_g numeric not null default 250,
  goal_fat_g numeric not null default 65,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Todo usuario autenticado puede ver el nombre y la racha de
-- cualquier perfil (eso es, a propósito, lo único público).
drop policy if exists "profiles: select all authenticated" on public.profiles;
create policy "profiles: select all authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- Pero solo puede crear/editar su propia fila.
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Al crear un usuario nuevo (primer login con magic link),
-- creamos su perfil automáticamente.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'usuario'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ------------------------------------------------------------
-- 2. FOODS
-- Catálogo compartido del grupo: alimentos de USDA (cacheados
-- localmente la primera vez que se buscan) + alimentos propios
-- (platos caseros, productos venezolanos, etc).
-- Los valores nutricionales son "por 1 porción de referencia"
-- (serving_label describe esa porción, ej. "100 g" o
-- "22 g, 4 cuadritos"), no por 100 g — así evitamos tener que
-- convertir unidades para platos caseros.
-- ------------------------------------------------------------
create table if not exists public.foods (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  source text not null default 'custom' check (source in ('custom', 'usda')),
  usda_fdc_id text,
  name text not null,
  brand text,
  category text,
  serving_label text not null default '100 g',
  serving_grams numeric,                 -- aproximado, si se conoce (ayuda a mostrar "≈ X g")
  kcal numeric,
  carbs_g numeric,
  sugars_g numeric,
  protein_g numeric,
  fat_g numeric,
  sat_fat_g numeric,
  fiber_g numeric,
  sodium_mg numeric,
  potassium_mg numeric,
  calcium_mg numeric,
  iron_mg numeric,
  vit_a_mcg numeric,
  vit_c_mg numeric,
  vit_d_mcg numeric,
  vit_b12_mcg numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create extension if not exists pg_trgm;
create index if not exists foods_name_trgm_idx on public.foods using gin (name gin_trgm_ops);

alter table public.foods enable row level security;

drop policy if exists "foods: select all authenticated" on public.foods;
create policy "foods: select all authenticated"
  on public.foods for select
  to authenticated
  using (true);

drop policy if exists "foods: insert authenticated" on public.foods;
create policy "foods: insert authenticated"
  on public.foods for insert
  to authenticated
  with check (true);

-- Catálogo colaborativo: cualquiera del grupo puede corregir/
-- completar un alimento (p.ej. rellenar un dato que faltaba),
-- no solo quien lo creó. Es un grupo de 3 personas de confianza.
drop policy if exists "foods: update authenticated" on public.foods;
create policy "foods: update authenticated"
  on public.foods for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "foods: delete authenticated" on public.foods;
create policy "foods: delete authenticated"
  on public.foods for delete
  to authenticated
  using (true);


-- ------------------------------------------------------------
-- 3. FOOD_LOGS
-- Un registro = "comí X cantidad de este alimento, a tal hora".
-- Guarda una foto (snapshot) de los nutrientes ya multiplicados
-- por la cantidad, para que el reporte no dependa de que el
-- alimento original no haya cambiado después.
-- ------------------------------------------------------------
create table if not exists public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  food_id uuid references public.foods(id) on delete set null,
  food_name_snapshot text not null,
  momento text not null default 'Snack' check (momento in ('Desayuno','Almuerzo','Cena','Snack')),
  quantity numeric not null default 1,      -- multiplicador de la porción de referencia
  log_date date not null,
  log_time time not null,
  kcal numeric, carbs_g numeric, sugars_g numeric, protein_g numeric, fat_g numeric,
  sat_fat_g numeric, fiber_g numeric, sodium_mg numeric, potassium_mg numeric,
  calcium_mg numeric, iron_mg numeric, vit_a_mcg numeric, vit_c_mg numeric,
  vit_d_mcg numeric, vit_b12_mcg numeric,
  created_at timestamptz not null default now()
);

alter table public.food_logs enable row level security;

drop policy if exists "food_logs: own rows only" on public.food_logs;
create policy "food_logs: own rows only"
  on public.food_logs for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 4. ACTIVITY_LOGS
-- Gym, baño, sueño, energía, nota. El contenido específico de
-- cada tipo vive en "data" (jsonb) para no tener que normalizar
-- un montón de columnas casi siempre vacías.
-- ------------------------------------------------------------
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('gym','bano','sueno','energia','nota')),
  log_date date not null,
  log_time time not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.activity_logs enable row level security;

drop policy if exists "activity_logs: own rows only" on public.activity_logs;
create policy "activity_logs: own rows only"
  on public.activity_logs for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 5. RACHA — se recalcula sola cada vez que insertas un
-- registro (de comida o de actividad), sin que el frontend
-- tenga que calcularla.
-- ------------------------------------------------------------
create or replace function public.touch_streak()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  prev_date date;
  cur_streak int;
  best_streak int;
begin
  select last_log_date, streak_current, streak_best
    into prev_date, cur_streak, best_streak
    from public.profiles
   where id = new.user_id
   for update;

  if prev_date is null then
    cur_streak := 1;
  elsif new.log_date = prev_date then
    -- ya contaba hoy, no cambia nada
    return new;
  elsif new.log_date = prev_date + 1 then
    cur_streak := cur_streak + 1;
  elsif new.log_date > prev_date + 1 then
    cur_streak := 1;
  else
    -- registro retroactivo de un día anterior: no toca la racha
    return new;
  end if;

  best_streak := greatest(best_streak, cur_streak);

  update public.profiles
     set streak_current = cur_streak,
         streak_best = best_streak,
         last_log_date = new.log_date
   where id = new.user_id;

  return new;
end;
$$;

drop trigger if exists on_food_log_touch_streak on public.food_logs;
create trigger on_food_log_touch_streak
  after insert on public.food_logs
  for each row execute function public.touch_streak();

drop trigger if exists on_activity_log_touch_streak on public.activity_logs;
create trigger on_activity_log_touch_streak
  after insert on public.activity_logs
  for each row execute function public.touch_streak();

-- ============================================================
-- Fin del esquema. Siguiente paso: correr seed_foods.sql
-- ============================================================
