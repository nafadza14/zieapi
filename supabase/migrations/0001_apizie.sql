-- Apizie storage on Supabase Postgres.
-- Run once in the Supabase SQL editor (or `supabase db push`).
--
-- Apizie keeps its data (users, sessions, API keys, usage counters, logs, invoices,
-- OAuth clients for MCP, ...) in one key/value table with Redis-like semantics, so the
-- same app code runs on Supabase, Upstash or in memory. Only the server talks to it,
-- with the SECRET key. Row Level Security is on and there are no policies, so the
-- publishable key used in the browser can never read or write this table.

create table if not exists public.apizie_kv (
  k   text primary key,
  t   char(1) not null check (t in ('s', 'h', 'l', 'z')), -- string, hash, list, set
  v   jsonb not null,
  exp timestamptz
);
create index if not exists apizie_kv_exp_idx on public.apizie_kv (exp) where exp is not null;
alter table public.apizie_kv enable row level security;
revoke all on public.apizie_kv from anon, authenticated;

-- One command. Returns jsonb. Expired keys behave as missing.
create or replace function public.apizie_kv_one(c jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  op   text := upper(c->>0);
  key  text := c->>1;
  r    jsonb;
  n    numeric;
  ex   int;
  cap  int;
  fld  text;
  a    int;
  b    int;
  row_ public.apizie_kv;
begin
  if op = 'GET' then
    select * into row_ from apizie_kv where k = key;
    if not found or (row_.exp is not null and row_.exp <= now()) or row_.t <> 's' then return 'null'::jsonb; end if;
    return row_.v;

  elsif op = 'MGET' then
    select coalesce(jsonb_agg(coalesce(
        (select z.v from apizie_kv z where z.k = kk.x and z.t = 's' and (z.exp is null or z.exp > now())),
        'null'::jsonb) order by kk.i), '[]'::jsonb)
      into r
      from jsonb_array_elements_text(c->1) with ordinality as kk(x, i);
    return r;

  elsif op = 'SET' then
    ex := nullif(c->>3, '')::int;
    insert into apizie_kv(k, t, v, exp) values (key, 's', to_jsonb(c->>2), case when ex is null then null else now() + make_interval(secs => ex) end)
      on conflict (k) do update set t = 's', v = excluded.v, exp = excluded.exp;
    return '"OK"'::jsonb;

  elsif op = 'DEL' then
    delete from apizie_kv where k = key;
    return '1'::jsonb;

  elsif op = 'EXPIRE' then
    update apizie_kv set exp = now() + make_interval(secs => (c->>2)::int) where k = key and (exp is null or exp > now());
    return '1'::jsonb;

  elsif op = 'INCRBY' then
    n := coalesce((c->>2)::numeric, 1);
    ex := nullif(c->>3, '')::int;
    insert into apizie_kv as z (k, t, v, exp)
      values (key, 's', to_jsonb(n::text), case when ex is null then null else now() + make_interval(secs => ex) end)
      on conflict (k) do update set
        t = 's',
        v = case when z.exp is not null and z.exp <= now() or z.t <> 's' then to_jsonb(n::text)
                 else to_jsonb((coalesce(nullif(z.v #>> '{}', '')::numeric, 0) + n)::text) end,
        exp = case when z.exp is not null and z.exp <= now() then excluded.exp else coalesce(z.exp, excluded.exp) end
      returning z.v into r;
    return to_jsonb((r #>> '{}')::numeric);

  elsif op = 'HINCRBY' then
    fld := c->>2;
    n := coalesce((c->>3)::numeric, 1);
    insert into apizie_kv as z (k, t, v) values (key, 'h', jsonb_build_object(fld, n))
      on conflict (k) do update set
        t = 'h',
        v = case when z.t <> 'h' or (z.exp is not null and z.exp <= now()) then jsonb_build_object(fld, n)
                 else jsonb_set(z.v, array[fld], to_jsonb(coalesce((z.v->>fld)::numeric, 0) + n)) end,
        exp = case when z.exp is not null and z.exp <= now() then null else z.exp end
      returning z.v -> fld into r;
    return r;

  elsif op = 'HMINCR' then
    ex := nullif(c->>3, '')::int;
    insert into apizie_kv as z (k, t, v, exp)
      values (key, 'h', coalesce(c->2, '{}'::jsonb), case when ex is null then null else now() + make_interval(secs => ex) end)
      on conflict (k) do update set
        t = 'h',
        v = case when z.t <> 'h' or (z.exp is not null and z.exp <= now()) then excluded.v
                 else z.v || (select coalesce(jsonb_object_agg(e.key, to_jsonb(coalesce((z.v->>e.key)::numeric, 0) + (e.value #>> '{}')::numeric)), '{}'::jsonb)
                              from jsonb_each(excluded.v) e) end,
        exp = case when z.exp is not null and z.exp <= now() then excluded.exp else coalesce(z.exp, excluded.exp) end;
    return '1'::jsonb;

  elsif op = 'HGETALL' then
    select * into row_ from apizie_kv where k = key;
    if not found or (row_.exp is not null and row_.exp <= now()) or row_.t <> 'h' then return '{}'::jsonb; end if;
    return row_.v;

  elsif op = 'LPUSH' then
    cap := coalesce((c->>3)::int, 1000);
    insert into apizie_kv as z (k, t, v) values (key, 'l', jsonb_build_array(c->>2))
      on conflict (k) do update set
        t = 'l',
        v = (select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from jsonb_array_elements(
               jsonb_build_array(c->>2) || case when z.t = 'l' and (z.exp is null or z.exp > now()) then z.v else '[]'::jsonb end
             ) with ordinality as x(e, i) where i <= cap),
        exp = case when z.exp is not null and z.exp <= now() then null else z.exp end;
    return '1'::jsonb;

  elsif op = 'LRANGE' then
    a := coalesce((c->>2)::int, 0);
    b := coalesce((c->>3)::int, -1);
    select * into row_ from apizie_kv where k = key;
    if not found or (row_.exp is not null and row_.exp <= now()) or row_.t <> 'l' then return '[]'::jsonb; end if;
    return (select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from jsonb_array_elements(row_.v) with ordinality as x(e, i)
            where i - 1 >= a and (b < 0 and i - 1 <= jsonb_array_length(row_.v) + b or b >= 0 and i - 1 <= b));

  elsif op = 'SADD' then
    insert into apizie_kv as z (k, t, v) values (key, 'z', jsonb_build_array(c->>2))
      on conflict (k) do update set
        t = 'z',
        v = case when z.t <> 'z' or (z.exp is not null and z.exp <= now()) then jsonb_build_array(c->>2)
                 when z.v ? (c->>2) then z.v else z.v || jsonb_build_array(c->>2) end,
        exp = case when z.exp is not null and z.exp <= now() then null else z.exp end;
    return '1'::jsonb;

  elsif op = 'SREM' then
    update apizie_kv set v = v - (c->>2) where k = key and t = 'z';
    return '1'::jsonb;

  elsif op = 'SMEMBERS' then
    select * into row_ from apizie_kv where k = key;
    if not found or (row_.exp is not null and row_.exp <= now()) or row_.t <> 'z' then return '[]'::jsonb; end if;
    return row_.v;

  elsif op = 'PING' then
    return '"PONG"'::jsonb;
  end if;

  raise exception 'apiapizie_kv: unknown command %', op;
end;
$$;

-- Several commands in one round trip (like a Redis pipeline). Returns a jsonb array.
create or replace function public.apizie_kv(cmds jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  out_ jsonb := '[]'::jsonb;
  c jsonb;
begin
  -- occasional clean-up of expired rows
  if random() < 0.002 then
    delete from apizie_kv where exp is not null and exp <= now();
  end if;
  for c in select * from jsonb_array_elements(cmds) loop
    out_ := out_ || jsonb_build_array(apizie_kv_one(c));
  end loop;
  return out_;
end;
$$;

-- Only the server (secret / service_role key) may call these.
revoke all on function public.apizie_kv(jsonb) from public, anon, authenticated;
revoke all on function public.apizie_kv_one(jsonb) from public, anon, authenticated;
grant execute on function public.apizie_kv(jsonb) to service_role;
grant execute on function public.apizie_kv_one(jsonb) to service_role;
