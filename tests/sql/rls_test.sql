-- RLS-test mod lokal Postgres med auth-stub (tests/sql/auth_stub.sql).
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-00000000000d'),('00000000-0000-0000-0000-00000000000e'),('00000000-0000-0000-0000-0000000000ff');
set role authenticated;
-- Ditte opretter hjemmet
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select (create_household('patient','Ditte')).invite_code as code \gset
-- Peter joiner
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select join_household(lower(:'code'),'supporter','Peter') is not null as joined;
-- Fremmed laver eget hjem
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select create_household('patient','Fremmed') is not null;
insert into food_entries(household_id, day, item, category) values (my_household(), '2026-11-12','Tomat','veg');

-- Ditte: aktivitet, notat, træning
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
insert into activities(household_id,type,started_at) values (my_household(),'solo',now());
insert into notes(day, body) values ('2026-11-12','Hemmelig bekymring');
insert into training_log(household_id,day,exercise,done) values (my_household(),'2026-11-12','ro',true);
-- Kun én aktiv aktivitet
do $$ begin
  begin insert into activities(household_id,type,started_at) values (public.my_household(),'mode',now()); raise exception 'FEJL: to aktive tilladt';
  exception when unique_violation then null; end; end $$;

-- Peter
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select count(*) = 1 as peter_ser_aktivitet from activities;
select count(*) = 0 as peter_ser_ikke_noter from notes;
select count(*) = 0 as peter_ser_ikke_fremmed_mad from food_entries;
insert into food_entries(household_id, day, item, category) values (my_household(), '2026-11-12','Kikærter','leg');
do $$ begin
  begin insert into activities(household_id,type,started_at,ended_at) values (public.my_household(),'mode',now()-interval '1 hour',now()); raise exception 'FEJL: Peter kunne skrive aktivitet';
  exception when insufficient_privilege then null; end; end $$;
do $$ begin
  begin update households set invite_code='HACKED'; raise exception 'FEJL: kunne ændre kode';
  exception when insufficient_privilege then null; end; end $$;
update households set settings = '{"x":1}';
select count(*) = 2 as peter_ser_to_medlemmer from members;
-- Peter kan ikke flytte sig til fremmed hjem
do $$ begin
  begin update members set household_id = gen_random_uuid(); raise exception 'FEJL: kunne ændre hjem';
  exception when insufficient_privilege then null; end; end $$;

reset role;
select household_id as ditte_hh from members where user_id='00000000-0000-0000-0000-00000000000d' \gset
select set_config('test.hh', :'ditte_hh', false);
set role authenticated;
-- Fremmed ser intet fra Dittes hjem
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select count(*) = 0 as fremmed_ser_ingen_aktivitet from activities;
select count(*) = 1 as fremmed_ser_kun_egen_mad from food_entries;
do $$ begin
  begin insert into food_entries(household_id, day, item, category) values (current_setting('test.hh')::uuid,'2026-11-12','Æble','fruit');
  raise exception 'FEJL: fremmed kunne skrive'; exception when insufficient_privilege then null; end; end $$;
-- Ditte ser begge madregistreringer i eget hjem
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select count(*) = 1 as ditte_ser_peters_mad from food_entries;
select settings->>'x' = '1' as settings_delt from households;
reset role;
select 'ALLE RLS-TESTS OK';
