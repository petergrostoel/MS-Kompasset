-- MS Kompasset – databaseopsætning til Supabase.
-- Kør hele filen i Supabase: SQL Editor → New query → indsæt → Run.
--
-- Ditte og Peter har hver sit login, men deler ét "hjem" (household).
-- Næsten alle data hører til hjemmet, så begge kan se dem.
-- Notater og bekymringer hører til den enkelte bruger og kan kun ses af ejeren.

-- ============================================================
-- Hjem og medlemmer
-- ============================================================

create table if not exists public.households (
  id           uuid primary key default gen_random_uuid(),
  name         text not null default 'Hjemme',
  invite_code  text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  -- Fælles indstillinger: træningsplan, faste pauser, tidspunkter for påmindelser m.m.
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.members (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  household_id  uuid not null references public.households (id) on delete cascade,
  -- patient = den der har MS (Ditte), supporter = støtten (Peter)
  role          text not null check (role in ('patient', 'supporter')),
  display_name  text not null,
  -- Personlige indstillinger (fx Peters påmindelse om aftensmad)
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists members_household_idx on public.members (household_id);

-- Hjælpefunktioner til Row Level Security. "security definer" så de kan læse
-- members uden at ramme RLS (ellers opstår en uendelig løkke).
create or replace function public.my_household()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select household_id from public.members where user_id = (select auth.uid())
$$;

create or replace function public.my_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select role from public.members where user_id = (select auth.uid())
$$;

-- Hold updated_at opdateret automatisk.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Opret et nyt hjem og bliv medlem af det.
create or replace function public.create_household(p_role text, p_display_name text)
returns public.households
language plpgsql security definer
set search_path = ''
as $$
declare
  h public.households;
begin
  if (select auth.uid()) is null then
    raise exception 'Ikke logget ind';
  end if;
  if exists (select 1 from public.members where user_id = (select auth.uid())) then
    raise exception 'Du er allerede med i et hjem';
  end if;
  insert into public.households default values returning * into h;
  insert into public.members (user_id, household_id, role, display_name)
    values ((select auth.uid()), h.id, p_role, coalesce(nullif(trim(p_display_name), ''), 'Mig'));
  return h;
end;
$$;

-- Bliv medlem af et eksisterende hjem med invitationskoden.
create or replace function public.join_household(p_code text, p_role text, p_display_name text)
returns public.households
language plpgsql security definer
set search_path = ''
as $$
declare
  h public.households;
begin
  if (select auth.uid()) is null then
    raise exception 'Ikke logget ind';
  end if;
  if exists (select 1 from public.members where user_id = (select auth.uid())) then
    raise exception 'Du er allerede med i et hjem';
  end if;
  select * into h from public.households where invite_code = upper(trim(p_code));
  if h.id is null then
    raise exception 'Koden findes ikke';
  end if;
  if (select count(*) from public.members where household_id = h.id) >= 4 then
    raise exception 'Hjemmet er fuldt';
  end if;
  insert into public.members (user_id, household_id, role, display_name)
    values ((select auth.uid()), h.id, p_role, coalesce(nullif(trim(p_display_name), ''), 'Mig'));
  return h;
end;
$$;

-- ============================================================
-- Aktivitet og energi
-- ============================================================

create table if not exists public.activities (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null default public.my_household() references public.households (id) on delete cascade,
  type           text not null,
  started_at     timestamptz not null,
  ended_at       timestamptz,
  energy         smallint check (energy between 1 and 5),
  -- manual | forgot (glemt at stoppe) | hint (startet fra forslag om hjernepause) | fixed (fast pause)
  origin         text not null default 'manual',
  -- Hvornår serveren næste gang skal spørge "Er du stadig i gang?" / "Er hjernepausen slut?"
  next_check_at  timestamptz,
  -- Hvornår serveren næste gang skal foreslå en hjernepause
  next_hint_at   timestamptz,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists activities_household_started_idx on public.activities (household_id, started_at desc);
-- Højst én aktivitet i gang ad gangen pr. hjem.
create unique index if not exists activities_one_active_idx on public.activities (household_id) where ended_at is null;

-- Hver gang appen foreslår en hjernepause, så vi kan lære om forslaget ramte.
create table if not exists public.hint_events (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null default public.my_household() references public.households (id) on delete cascade,
  activity_id    uuid references public.activities (id) on delete set null,
  activity_type  text,
  asked_at       timestamptz not null default now(),
  minutes_in     integer,
  answer         text check (answer in ('yes', 'no')),
  energy_after   smallint check (energy_after between 1 and 5),
  updated_at     timestamptz not null default now()
);
create index if not exists hint_events_household_idx on public.hint_events (household_id, asked_at desc);

-- Dagens evaluering.
create table if not exists public.day_reviews (
  household_id      uuid not null default public.my_household() references public.households (id) on delete cascade,
  day               date not null,
  mood              text check (mood in ('balance', 'hard', 'energy')),
  low_activity_id   uuid references public.activities (id) on delete set null,
  high_activity_id  uuid references public.activities (id) on delete set null,
  updated_at        timestamptz not null default now(),
  primary key (household_id, day)
);

-- ============================================================
-- Sundhed og kost
-- ============================================================

create table if not exists public.food_entries (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null default public.my_household() references public.households (id) on delete cascade,
  day           date not null,
  item          text not null,
  category      text not null check (category in ('veg', 'fruit', 'leg', 'nut', 'grain')),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, day, item)
);

-- Råvarer brugerne selv har tilføjet til listen.
create table if not exists public.custom_foods (
  household_id  uuid not null default public.my_household() references public.households (id) on delete cascade,
  name          text not null,
  category      text not null check (category in ('veg', 'fruit', 'leg', 'nut', 'grain')),
  updated_at    timestamptz not null default now(),
  primary key (household_id, name)
);

create table if not exists public.protein_days (
  household_id  uuid not null default public.my_household() references public.households (id) on delete cascade,
  day           date not null,
  fish          smallint not null default 0 check (fish >= 0),
  meat          smallint not null default 0 check (meat >= 0),
  poultry       smallint not null default 0 check (poultry >= 0),
  updated_at    timestamptz not null default now(),
  primary key (household_id, day)
);

-- ============================================================
-- Træning
-- ============================================================

create table if not exists public.training_log (
  household_id  uuid not null default public.my_household() references public.households (id) on delete cascade,
  day           date not null,
  exercise      text not null,
  done          boolean not null,
  updated_at    timestamptz not null default now(),
  primary key (household_id, day, exercise)
);

-- ============================================================
-- Notater og bekymringer (private – kun ejeren kan se dem)
-- ============================================================

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day         date not null,
  body        text not null default '',
  nothing     boolean not null default false,  -- "Intet at skrive i dag"
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, day)
);

-- ============================================================
-- Notifikationer
-- ============================================================

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Påmindelser pr. bruger og dag (dagsevaluering, træning, bekymringer, faste pauser, aftensmad).
-- Serveren opretter rækken på tidspunktet og sender. Appen udskyder (next_at) eller lukker (status).
create table if not exists public.reminders (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null,               -- day_review | training | worry | food | fixed:12:30
  day         date not null,
  status      text not null default 'open' check (status in ('open', 'done')),
  next_at     timestamptz,                 -- næste gang serveren skal sende; null = venter på svar
  sent_count  integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind, day)
);
create index if not exists reminders_due_idx on public.reminders (next_at) where status = 'open';

-- ============================================================
-- updated_at-triggere
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['households','members','activities','hint_events','day_reviews','food_entries',
    'custom_foods','protein_days','training_log','notes','push_subscriptions','reminders']
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format('create trigger %I_set_updated_at before update on public.%I
      for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.households         enable row level security;
alter table public.members            enable row level security;
alter table public.activities         enable row level security;
alter table public.hint_events        enable row level security;
alter table public.day_reviews        enable row level security;
alter table public.food_entries       enable row level security;
alter table public.custom_foods       enable row level security;
alter table public.protein_days       enable row level security;
alter table public.training_log       enable row level security;
alter table public.notes              enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminders          enable row level security;

-- Hjem: medlemmer kan læse og ændre indstillinger. Oprettelse sker via create_household().
drop policy if exists "Hjem: læs" on public.households;
create policy "Hjem: læs" on public.households
  for select to authenticated using (id = (select public.my_household()));
drop policy if exists "Hjem: ret" on public.households;
create policy "Hjem: ret" on public.households
  for update to authenticated
  using (id = (select public.my_household()))
  with check (id = (select public.my_household()));

-- Medlemmer: se alle i hjemmet, ret kun sig selv. Oprettelse sker via funktionerne.
drop policy if exists "Medlemmer: læs" on public.members;
create policy "Medlemmer: læs" on public.members
  for select to authenticated using (household_id = (select public.my_household()));
drop policy if exists "Medlemmer: ret sig selv" on public.members;
create policy "Medlemmer: ret sig selv" on public.members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and household_id = (select public.my_household()));

-- Fælles data: alle i hjemmet kan læse og skrive.
do $$
declare t text;
begin
  foreach t in array array['food_entries','custom_foods','protein_days']
  loop
    execute format('drop policy if exists "Hjem: alt" on public.%I', t);
    execute format('create policy "Hjem: alt" on public.%I for all to authenticated
      using (household_id = (select public.my_household()))
      with check (household_id = (select public.my_household()))', t);
  end loop;
end $$;

-- Dittes egne registreringer: alle i hjemmet kan læse, kun den med MS kan skrive.
do $$
declare t text;
begin
  foreach t in array array['activities','hint_events','day_reviews','training_log']
  loop
    execute format('drop policy if exists "Hjem: læs" on public.%I', t);
    execute format('create policy "Hjem: læs" on public.%I for select to authenticated
      using (household_id = (select public.my_household()))', t);
    execute format('drop policy if exists "Patient: skriv" on public.%I', t);
    execute format('create policy "Patient: skriv" on public.%I for all to authenticated
      using (household_id = (select public.my_household()) and (select public.my_role()) = ''patient'')
      with check (household_id = (select public.my_household()) and (select public.my_role()) = ''patient'')', t);
  end loop;
end $$;

-- Private data: kun ejeren.
do $$
declare t text;
begin
  foreach t in array array['notes','push_subscriptions','reminders']
  loop
    execute format('drop policy if exists "Egne: alt" on public.%I', t);
    execute format('create policy "Egne: alt" on public.%I for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ============================================================
-- Rettigheder
-- ============================================================

grant select, update on table public.households to authenticated;
grant select, update on table public.members to authenticated;
grant select, insert, update, delete on table
  public.activities, public.hint_events, public.day_reviews, public.food_entries, public.custom_foods,
  public.protein_days, public.training_log, public.notes, public.push_subscriptions, public.reminders
  to authenticated;
revoke all on table
  public.households, public.members, public.activities, public.hint_events, public.day_reviews,
  public.food_entries, public.custom_foods, public.protein_days, public.training_log, public.notes,
  public.push_subscriptions, public.reminders
  from anon;

-- Invitationskoden og hjem-id må ikke ændres af brugerne.
revoke update on table public.households from authenticated;
grant update (name, settings) on table public.households to authenticated;
revoke update on table public.members from authenticated;
grant update (display_name, settings) on table public.members to authenticated;

revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.join_household(text, text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text, text) to authenticated;
grant execute on function public.my_household() to authenticated;
grant execute on function public.my_role() to authenticated;
