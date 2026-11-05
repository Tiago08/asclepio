-- ============================================================
-- ASCLEPIO — fase 2
-- Pega todo este archivo en Supabase → SQL Editor → Run.
-- Es idempotente: si falla a la mitad o lo corres dos veces, no
-- duplica nada ni borra datos. No cambia ninguna columna que ya
-- existe: solo agrega columnas y tablas nuevas.
-- ============================================================


-- ------------------------------------------------------------
-- 1. MICRONUTRIENTES FLEXIBLES + PORCIONES CASERAS
-- "micros" guarda los nutrientes nuevos como {"magnesium_mg": 30, ...}.
-- Para agregar otro más adelante no hace falta otra columna.
-- Las 15 columnas de siempre (kcal, macros, sodio...) se quedan igual.
-- "units" son las porciones caseras de un alimento propio:
-- [{"label": "unidad", "grams": 98}, ...]
-- ------------------------------------------------------------
alter table public.foods     add column if not exists micros jsonb not null default '{}'::jsonb;
alter table public.foods     add column if not exists units  jsonb not null default '[]'::jsonb;
alter table public.food_logs add column if not exists micros jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.foods add constraint foods_micros_is_object check (jsonb_typeof(micros) = 'object');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.foods add constraint foods_units_is_array check (jsonb_typeof(units) = 'array');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.food_logs add constraint food_logs_micros_is_object check (jsonb_typeof(micros) = 'object');
exception when duplicate_object then null; end $$;


-- ------------------------------------------------------------
-- 2. METAS POR DÍA
-- Cada vez que cambias tus metas se guarda una fila con la fecha
-- desde la que valen. Para un día cualquiera se usa la fila más
-- reciente con valid_from <= ese día, así el historial no cambia
-- cuando ajustas las metas hoy.
-- ------------------------------------------------------------
alter table public.profiles add column if not exists goal_water_ml numeric not null default 2500;

create table if not exists public.goal_history (
  user_id uuid not null references public.profiles(id) on delete cascade,
  valid_from date not null,
  goal_kcal numeric not null,
  goal_protein_g numeric not null,
  goal_carbs_g numeric not null,
  goal_fat_g numeric not null,
  goal_water_ml numeric not null default 2500,
  created_at timestamptz not null default now(),
  primary key (user_id, valid_from)
);

alter table public.goal_history enable row level security;
drop policy if exists "goal_history: own rows only" on public.goal_history;
create policy "goal_history: own rows only"
  on public.goal_history for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Las metas que tiene hoy cada uno valen "desde siempre" (2000-01-01),
-- para que los días ya registrados se midan contra ellas.
insert into public.goal_history (user_id, valid_from, goal_kcal, goal_protein_g, goal_carbs_g, goal_fat_g, goal_water_ml)
select id, date '2000-01-01', goal_kcal, goal_protein_g, goal_carbs_g, goal_fat_g, goal_water_ml
  from public.profiles
on conflict (user_id, valid_from) do nothing;


-- ------------------------------------------------------------
-- 3. PERFIL FÍSICO (privado)
-- No va en "profiles" porque esa tabla la ven los 3 (ranking).
-- Se guarda el año de nacimiento, no la edad, para que no se
-- quede vieja.
-- ------------------------------------------------------------
create table if not exists public.body_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  sex text check (sex in ('hombre', 'mujer')),
  birth_year int check (birth_year between 1900 and 2100),
  height_cm numeric check (height_cm between 100 and 250),
  objective text not null default 'mantener' check (objective in ('perder', 'mantener', 'ganar')),
  training_days int not null default 3 check (training_days between 0 and 7),
  updated_at timestamptz not null default now()
);

alter table public.body_profiles enable row level security;
drop policy if exists "body_profiles: own row only" on public.body_profiles;
create policy "body_profiles: own row only"
  on public.body_profiles for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 4. PESO CORPORAL (privado, uno por día)
-- ------------------------------------------------------------
create table if not exists public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null,
  weight_kg numeric not null check (weight_kg > 20 and weight_kg < 400),
  created_at timestamptz not null default now(),
  unique (user_id, log_date)
);

alter table public.weight_logs enable row level security;
drop policy if exists "weight_logs: own rows only" on public.weight_logs;
create policy "weight_logs: own rows only"
  on public.weight_logs for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 5. SUPLEMENTOS
-- supplements = tu pila (creatina, magnesio...).
-- supplement_logs = una fila por suplemento tomado y día.
-- ------------------------------------------------------------
create table if not exists public.supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  dose text,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.supplements enable row level security;
drop policy if exists "supplements: own rows only" on public.supplements;
create policy "supplements: own rows only"
  on public.supplements for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.supplement_logs (
  supplement_id uuid not null references public.supplements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null,
  created_at timestamptz not null default now(),
  primary key (supplement_id, log_date)
);
create index if not exists supplement_logs_user_date_idx on public.supplement_logs (user_id, log_date);

alter table public.supplement_logs enable row level security;
drop policy if exists "supplement_logs: own rows only" on public.supplement_logs;
create policy "supplement_logs: own rows only"
  on public.supplement_logs for all
  to authenticated
  using (auth.uid() = user_id)
  -- además, el suplemento tiene que ser tuyo
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.supplements s where s.id = supplement_id and s.user_id = auth.uid())
  );


-- ------------------------------------------------------------
-- 6. HIDRATACIÓN Y ELECTROLITOS
-- Cada vaso o bebida: mililitros y, si es suero o bebida
-- deportiva, cuánto sodio, potasio y magnesio trae.
-- ------------------------------------------------------------
create table if not exists public.water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null,
  log_time time not null,
  ml numeric not null check (ml > 0 and ml <= 5000),
  label text,
  sodium_mg numeric check (sodium_mg >= 0),
  potassium_mg numeric check (potassium_mg >= 0),
  magnesium_mg numeric check (magnesium_mg >= 0),
  created_at timestamptz not null default now()
);
create index if not exists water_logs_user_date_idx on public.water_logs (user_id, log_date);

alter table public.water_logs enable row level security;
drop policy if exists "water_logs: own rows only" on public.water_logs;
create policy "water_logs: own rows only"
  on public.water_logs for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 7. COMBOS DE ALIMENTOS
-- Un combo ("Desayuno de siempre") es una lista de alimentos con
-- su cantidad. Registrarlo crea un food_log por alimento.
-- ------------------------------------------------------------
create table if not exists public.food_combos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

alter table public.food_combos enable row level security;
drop policy if exists "food_combos: own rows only" on public.food_combos;
create policy "food_combos: own rows only"
  on public.food_combos for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.food_combo_items (
  id uuid primary key default gen_random_uuid(),
  combo_id uuid not null references public.food_combos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  food_id uuid not null references public.foods(id) on delete cascade,
  quantity numeric not null check (quantity > 0),   -- multiplicador de la porción de referencia
  label text not null,                              -- "Arepa · 1 unidad"
  sort int not null default 0
);
create index if not exists food_combo_items_combo_idx on public.food_combo_items (combo_id);

alter table public.food_combo_items enable row level security;
drop policy if exists "food_combo_items: own rows only" on public.food_combo_items;
create policy "food_combo_items: own rows only"
  on public.food_combo_items for all
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.food_combos c where c.id = combo_id and c.user_id = auth.uid())
  );


-- ------------------------------------------------------------
-- 8. PERMISOS
-- RLS decide QUÉ filas; GRANT decide si el rol puede tocar la
-- tabla. Sin GRANT sale "permission denied for table".
-- ------------------------------------------------------------
grant select, insert, update, delete on
  public.goal_history, public.body_profiles, public.weight_logs,
  public.supplements, public.supplement_logs, public.water_logs,
  public.food_combos, public.food_combo_items
to authenticated;

-- La racha no cambia: agua, suplementos y peso no tienen trigger
-- de racha a propósito (solo comida y actividades cuentan).

-- ============================================================
-- Fin de la fase 2.
-- ============================================================
