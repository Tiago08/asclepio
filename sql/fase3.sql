-- ============================================================
-- ASCLEPIO — fase 3: hábitos
-- Pega todo este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de schema.sql, fase2.sql, fase2b.sql y puntos.sql.
-- Es idempotente: se puede correr dos veces. No cambia ni borra
-- nada de lo que ya existe: solo crea dos tablas nuevas.
-- Los hábitos NO dan puntos ni cuentan para la racha (decisión de
-- Santiago): por eso no hay trigger hacia daily_points.
-- ============================================================


-- ------------------------------------------------------------
-- 1. HÁBITOS
-- Cada uno crea los suyos: nombre, cuántas veces por semana y en
-- qué momento del día. "active = false" es archivarlo: deja de
-- salir, pero las marcas viejas se quedan.
-- ------------------------------------------------------------
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  times_per_week int not null default 7 check (times_per_week between 1 and 7),
  momento text not null default 'cualquiera'
    check (momento in ('manana', 'tarde', 'noche', 'cualquiera')),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists habits_user_idx on public.habits (user_id);

alter table public.habits enable row level security;
drop policy if exists "habits: own rows only" on public.habits;
create policy "habits: own rows only"
  on public.habits for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.habits to authenticated;


-- ------------------------------------------------------------
-- 2. MARCAS: una fila por hábito cumplido y día
-- Igual que supplement_logs: la llave (hábito, día) evita marcar
-- dos veces el mismo día.
-- ------------------------------------------------------------
create table if not exists public.habit_logs (
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null,
  created_at timestamptz not null default now(),
  primary key (habit_id, log_date)
);
create index if not exists habit_logs_user_date_idx on public.habit_logs (user_id, log_date);

alter table public.habit_logs enable row level security;
drop policy if exists "habit_logs: own rows only" on public.habit_logs;
create policy "habit_logs: own rows only"
  on public.habit_logs for all
  to authenticated
  using (auth.uid() = user_id)
  -- además, el hábito tiene que ser tuyo
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.habits h where h.id = habit_id and h.user_id = auth.uid())
  );

grant select, insert, update, delete on public.habit_logs to authenticated;
