-- ============================================================
-- ASCLEPIO — puntos diarios para el ranking
-- Pega todo este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de schema.sql, fase2.sql y fase2b.sql.
-- Es idempotente: se puede correr dos veces. No borra ni cambia
-- ningún registro: solo crea una tabla nueva, una función y
-- triggers, y calcula los puntos de los días que ya existen.
-- ============================================================


-- ------------------------------------------------------------
-- 1. TABLA DE PUNTOS
-- Una fila por persona y día con SOLO el total de puntos. Los
-- 3 la pueden leer (es el ranking), pero no dice qué comiste ni
-- cuánto dormiste: solo un número, como la racha.
-- Nadie la escribe desde la app: la llenan los triggers.
-- ------------------------------------------------------------
create table if not exists public.daily_points (
  user_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null,
  points int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, log_date)
);

alter table public.daily_points enable row level security;

drop policy if exists "daily_points: select all authenticated" on public.daily_points;
create policy "daily_points: select all authenticated"
  on public.daily_points for select
  to authenticated
  using (true);

-- Solo lectura para la app (sin insert/update/delete).
grant select on public.daily_points to authenticated;


-- ------------------------------------------------------------
-- 2. CÁLCULO DE LOS PUNTOS DE UN DÍA
-- Cada cosa cuenta una vez por día (registrar 10 vasos de agua
-- no da 10 puntos):
--   Comida ............ 2  (+1 si registraste 3 o más comidas:
--                           desayuno, almuerzo, merienda, cena)
--   Sueño ............. 2
--   Gym ............... 2  (entreno o día de descanso)
--   Energía ........... 1
--   Baño .............. 1  (también "no fui hoy")
--   Agua .............. 1
--   Suplementos ....... 1
--   Máximo por día ... 11
-- Las notas no suman (son opcionales a propósito).
-- Si cambias estos valores, cambia también POINTS_INFO en
-- js/app.js (el texto que explica los puntos).
-- ------------------------------------------------------------
create or replace function public.calc_day_points(p_user uuid, p_date date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select
      (case when exists (select 1 from food_logs where user_id = p_user and log_date = p_date) then 2 else 0 end)
    + (case when (select count(distinct case when momento = 'Snack' then 'Merienda' else momento end)
                    from food_logs where user_id = p_user and log_date = p_date) >= 3 then 1 else 0 end)
    + (case when exists (select 1 from activity_logs where user_id = p_user and log_date = p_date and type = 'sueno') then 2 else 0 end)
    + (case when exists (select 1 from activity_logs where user_id = p_user and log_date = p_date and type = 'gym') then 2 else 0 end)
    + (case when exists (select 1 from activity_logs where user_id = p_user and log_date = p_date and type = 'energia') then 1 else 0 end)
    + (case when exists (select 1 from activity_logs where user_id = p_user and log_date = p_date and type = 'bano') then 1 else 0 end)
    + (case when exists (select 1 from water_logs where user_id = p_user and log_date = p_date) then 1 else 0 end)
    + (case when exists (select 1 from supplement_logs where user_id = p_user and log_date = p_date) then 1 else 0 end);
$$;

-- Guarda (o borra, si quedó en 0) la fila del día.
create or replace function public.refresh_day_points(p_user uuid, p_date date)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  pts int;
begin
  if p_user is null or p_date is null then return; end if;
  -- si el perfil se está borrando (borrado en cascada), no hay nada que guardar
  if not exists (select 1 from public.profiles where id = p_user) then return; end if;
  pts := public.calc_day_points(p_user, p_date);
  if pts = 0 then
    delete from public.daily_points where user_id = p_user and log_date = p_date;
  else
    insert into public.daily_points (user_id, log_date, points, updated_at)
    values (p_user, p_date, pts, now())
    on conflict (user_id, log_date) do update
      set points = excluded.points, updated_at = now();
  end if;
end;
$$;

-- Nadie llama a estas funciones desde la app: solo los triggers.
revoke execute on function public.calc_day_points(uuid, date) from public, anon, authenticated;
revoke execute on function public.refresh_day_points(uuid, date) from public, anon, authenticated;


-- ------------------------------------------------------------
-- 3. TRIGGERS
-- Como un contador conectado a cada sensor: cuando entra, sale
-- o cambia un registro, se recalcula el día afectado (y el día
-- viejo, si se cambió la fecha).
-- ------------------------------------------------------------
create or replace function public.touch_day_points()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_day_points(new.user_id, new.log_date);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE'
      and (old.log_date is distinct from new.log_date or old.user_id is distinct from new.user_id)) then
    perform public.refresh_day_points(old.user_id, old.log_date);
  end if;
  return null;   -- trigger "after": el valor de retorno no se usa
end;
$$;

drop trigger if exists on_food_log_points on public.food_logs;
create trigger on_food_log_points
  after insert or update or delete on public.food_logs
  for each row execute function public.touch_day_points();

drop trigger if exists on_activity_log_points on public.activity_logs;
create trigger on_activity_log_points
  after insert or update or delete on public.activity_logs
  for each row execute function public.touch_day_points();

drop trigger if exists on_water_log_points on public.water_logs;
create trigger on_water_log_points
  after insert or update or delete on public.water_logs
  for each row execute function public.touch_day_points();

drop trigger if exists on_supplement_log_points on public.supplement_logs;
create trigger on_supplement_log_points
  after insert or update or delete on public.supplement_logs
  for each row execute function public.touch_day_points();


-- ------------------------------------------------------------
-- 4. PUNTOS DE LOS DÍAS QUE YA EXISTEN
-- Recorre cada (persona, día) con algún registro y calcula sus
-- puntos. Correrlo otra vez da el mismo resultado.
-- ------------------------------------------------------------
select public.refresh_day_points(d.user_id, d.log_date)
from (
  select user_id, log_date from public.food_logs
  union select user_id, log_date from public.activity_logs
  union select user_id, log_date from public.water_logs
  union select user_id, log_date from public.supplement_logs
) d;

-- ============================================================
-- Fin. La racha no cambia: sigue contando solo comida y
-- actividades, como antes.
-- ============================================================
