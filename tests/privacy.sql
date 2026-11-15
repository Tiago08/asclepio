-- Solo en la base de prueba, después de las migraciones.
insert into auth.users(id,email) values
('00000000-0000-0000-0000-000000000001','uno@example.com'),
('00000000-0000-0000-0000-000000000002','dos@example.com');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.profiles) <> 1 then raise exception 'Metas ajenas visibles'; end if;
  if (select count(*) from public.ranking_profiles) <> 2 then raise exception 'Ranking incompleto'; end if;
  update public.profiles set goal_kcal = 2200 where id = auth.uid();
  begin
    update public.profiles set streak_current = 999 where id = auth.uid();
    raise exception 'Se permite falsificar rachas';
  exception when insufficient_privilege then null; end;
  begin
    update public.ranking_profiles set streak_current = 999 where id = auth.uid();
    raise exception 'Se permite falsificar rachas por la vista';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.daily_points(user_id,log_date,points) values(auth.uid(),current_date,999);
    raise exception 'Se permite falsificar puntos';
  exception when insufficient_privilege then null; end;
  begin
    perform goal_kcal from public.ranking_profiles;
    raise exception 'La vista filtra metas';
  exception when undefined_column then null; end;
end $$;
insert into public.foods(name,serving_label,source,created_by)
values('Alimento compartido','100 g','custom',auth.uid());
insert into public.activity_logs(user_id,type,log_date,log_time,data)
values(auth.uid(),'sueno',current_date,'07:00','{"horaDormir":"23:00","horaDespertar":"07:00"}');
do $$ begin
  if (select streak_current from public.profiles where id=auth.uid()) <> 1 then raise exception 'Trigger de racha falló'; end if;
  if (select points from public.daily_points where user_id=auth.uid() and log_date=current_date) <> 2 then raise exception 'Trigger de puntos falló'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin
  if (select count(*) from public.foods where name='Alimento compartido') <> 1 then raise exception 'Alimento no compartido'; end if;
  if (select count(*) from public.activity_logs) <> 0 then raise exception 'Sueño ajeno visible'; end if;
  if (select count(*) from public.profiles where goal_kcal=2200) <> 0 then raise exception 'Meta ajena visible'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform * from public.ranking_profiles;
    raise exception 'Ranking anónimo visible';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'OK: metas y registros privados; catálogo y ranking compartidos; rachas y puntos protegidos' as resultado;
