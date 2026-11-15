-- Ejecutar DESPUÉS de fase3.sql. Idempotente; no borra registros.
-- El catálogo foods sigue compartido, sin cambiar sus permisos.
begin;

-- La vista expone únicamente los campos del ranking. Se ejecuta con los
-- permisos de su propietario para poder leer perfiles de otros usuarios.
create or replace view public.ranking_profiles
with (security_barrier = true) as
select id, display_name, streak_current, streak_best from public.profiles;
revoke all on public.ranking_profiles from public, anon, authenticated;
grant select on public.ranking_profiles to authenticated;

drop policy if exists "profiles: select all authenticated" on public.profiles;
drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own" on public.profiles
for select to authenticated using (auth.uid() = id);

-- RLS limita las filas; los GRANT limitan las columnas modificables.
-- Las rachas siguen siendo escritas por los triggers SECURITY DEFINER.
revoke all on public.profiles from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name, goal_kcal, goal_protein_g, goal_carbs_g, goal_fat_g, goal_water_ml)
on public.profiles to authenticated;

-- Los puntos solo los escriben los triggers, nunca el cliente.
revoke all on public.daily_points from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.daily_points from authenticated;
grant select on public.daily_points to authenticated;

commit;
