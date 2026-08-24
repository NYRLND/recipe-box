-- Table for Two — database schema
-- Safe to run more than once.

create table if not exists household_members (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

insert into household_members (name)
select v.name from (values ('Dan'), ('Melissa')) as v(name)
where not exists (select 1 from household_members where household_members.name = v.name);

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text,
  source_url text,
  image_url text,
  servings int,
  prep_time text,
  cook_time text,
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  tags text[],
  notes text,
  parent_recipe_id uuid references recipes(id),
  created_by uuid references household_members(id),
  created_at timestamptz default now(),
  times_cooked int default 0
);

create table if not exists favorites (
  member_id uuid references household_members(id),
  recipe_id uuid references recipes(id) on delete cascade,
  primary key (member_id, recipe_id)
);

create table if not exists grocery_items (
  id uuid primary key default gen_random_uuid(),
  item text not null,
  amount text,
  checked boolean default false,
  added_by uuid references household_members(id),
  recipe_id uuid references recipes(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists meal_plan (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references recipes(id) on delete cascade,
  planned_date date not null,
  created_at timestamptz default now()
);

alter table household_members enable row level security;
alter table recipes enable row level security;
alter table favorites enable row level security;
alter table grocery_items enable row level security;
alter table meal_plan enable row level security;

drop policy if exists "allow all" on household_members;
drop policy if exists "allow all" on recipes;
drop policy if exists "allow all" on favorites;
drop policy if exists "allow all" on grocery_items;
drop policy if exists "allow all" on meal_plan;

create policy "allow all" on household_members for all using (true) with check (true);
create policy "allow all" on recipes for all using (true) with check (true);
create policy "allow all" on favorites for all using (true) with check (true);
create policy "allow all" on grocery_items for all using (true) with check (true);
create policy "allow all" on meal_plan for all using (true) with check (true);

-- v4: tryout recipes (planned from Discover but not yet saved to the box)
alter table recipes add column if not exists in_box boolean not null default true;

-- v7: star ratings pulled from source sites
alter table recipes add column if not exists rating numeric;
alter table recipes add column if not exists rating_count int;

-- v8: grocery history for smart Quick Add (survives list clearing)
create table if not exists grocery_history (
  id uuid primary key default gen_random_uuid(),
  item text not null,
  added_at timestamptz default now()
);
alter table grocery_history enable row level security;
drop policy if exists "allow all" on grocery_history;
create policy "allow all" on grocery_history for all using (true) with check (true);

-- v9: freeform "quick note" plan entries (e.g. "leftovers", "sandwiches") that don't
-- reference a saved recipe. recipe_id was already nullable; this adds the text side.
alter table meal_plan add column if not exists note text;

-- v9b: aisle category, shared aisle-grouping convention with Hearth (added directly in
-- Supabase before this line existed here — documenting it so schema.sql stays truthful).
alter table grocery_items add column if not exists category text;

-- v10: household_members gained these two columns directly in Supabase, as part of
-- Hearth's own auth work, before this file was updated to mention them.
--   auth_user_id -> links a row to a Supabase auth user (nullable until claimed).
--   kid_pin      -> Hearth's PIN for kid sign-in; Recipe Box never reads or writes this.
alter table household_members add column if not exists auth_user_id uuid;
alter table household_members add column if not exists kid_pin text;

-- v11: multi-household support. Recipe Box now serves more than one family
-- (Baker-Ryan, Martin, Maloy); each household's recipes/plan/grocery list/favorites
-- are isolated from the others by RLS, keyed off household_id. Everything here
-- backfills existing rows to the original household, so this is a no-op for
-- data that predates it.
create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into households (name)
select v.name from (values ('Baker-Ryan'), ('Martin'), ('Maloy')) as v(name)
where not exists (select 1 from households where households.name = v.name);

alter table household_members add column if not exists household_id uuid references households(id);
update household_members set household_id = (select id from households where name = 'Baker-Ryan') where household_id is null;

alter table recipes add column if not exists household_id uuid references households(id);
update recipes set household_id = (select id from households where name = 'Baker-Ryan') where household_id is null;
alter table recipes alter column household_id set not null;
alter table recipes alter column household_id set default my_household_id();

alter table meal_plan add column if not exists household_id uuid references households(id);
update meal_plan set household_id = (select id from households where name = 'Baker-Ryan') where household_id is null;
alter table meal_plan alter column household_id set not null;
alter table meal_plan alter column household_id set default my_household_id();

alter table favorites add column if not exists household_id uuid references households(id);
update favorites set household_id = (select id from households where name = 'Baker-Ryan') where household_id is null;
alter table favorites alter column household_id set not null;
alter table favorites alter column household_id set default my_household_id();

alter table grocery_items add column if not exists household_id uuid references households(id);
update grocery_items set household_id = (select id from households where name = 'Baker-Ryan') where household_id is null;
alter table grocery_items alter column household_id set not null;
alter table grocery_items alter column household_id set default my_household_id();

alter table grocery_history add column if not exists household_id uuid references households(id);
update grocery_history set household_id = (select id from households where name = 'Baker-Ryan') where household_id is null;
alter table grocery_history alter column household_id set not null;
alter table grocery_history alter column household_id set default my_household_id();

-- current_member_id() predates this file (added directly in Supabase as part of
-- Hearth's auth work); documenting it here since Recipe Box's own functions build on it.
create or replace function current_member_id()
returns uuid
language sql stable security definer
set search_path = public
as $$ select id from household_members where auth_user_id = auth.uid() $$;
revoke execute on function current_member_id() from anon;

create or replace function my_household_id()
returns uuid
language sql stable security definer
set search_path = public
as $$ select household_id from household_members where auth_user_id = auth.uid() $$;
revoke execute on function my_household_id() from public;
revoke execute on function my_household_id() from anon;
grant execute on function my_household_id() to authenticated;

-- RLS: replaces the old "allow all" policies (which had quietly gone stale --
-- still listing anon in their roles from before anon grants were narrowed)
-- with real household-scoped policies, authenticated only.
drop policy if exists "allow all" on recipes;
create policy "household recipes" on recipes
  for all to authenticated
  using (household_id = (select my_household_id()))
  with check (household_id = (select my_household_id()));

drop policy if exists "allow all" on meal_plan;
create policy "household meal_plan" on meal_plan
  for all to authenticated
  using (household_id = (select my_household_id()))
  with check (household_id = (select my_household_id()));

drop policy if exists "allow all" on favorites;
create policy "household favorites" on favorites
  for all to authenticated
  using (household_id = (select my_household_id()))
  with check (household_id = (select my_household_id()));

drop policy if exists "allow all" on grocery_items;
create policy "household grocery_items" on grocery_items
  for all to authenticated
  using (household_id = (select my_household_id()))
  with check (household_id = (select my_household_id()));

drop policy if exists "allow all" on grocery_history;
create policy "household grocery_history" on grocery_history
  for all to authenticated
  using (household_id = (select my_household_id()))
  with check (household_id = (select my_household_id()));

alter table households enable row level security;
create policy "own household readable" on households
  for select to authenticated
  using (id = (select my_household_id()));
grant select on households to authenticated;

-- v12: cross-household recipe sharing. A snapshot (not a live link) of the
-- recipe at share time, so the recipient's copy is independent of later edits
-- to the original, and no cross-household read access into `recipes` is needed.
create table if not exists recipe_shares (
  id uuid primary key default gen_random_uuid(),
  recipe_snapshot jsonb not null,
  shared_by uuid not null references household_members(id),
  shared_with uuid not null references household_members(id),
  created_at timestamptz not null default now(),
  viewed_at timestamptz,
  responded_action text check (responded_action in ('box', 'plan'))
);
alter table recipe_shares enable row level security;

create policy "recipient reads own shares" on recipe_shares
  for select to authenticated
  using (shared_with = (select current_member_id()));
create policy "sender reads sent shares" on recipe_shares
  for select to authenticated
  using (shared_by = (select current_member_id()));
create policy "recipient updates own shares" on recipe_shares
  for update to authenticated
  using (shared_with = (select current_member_id()))
  with check (shared_with = (select current_member_id()));
create policy "members create shares" on recipe_shares
  for insert to authenticated
  with check (shared_by = (select current_member_id()));

grant select, insert, update on recipe_shares to authenticated;

-- Narrow cross-household directory for the "Share with..." picker: name +
-- household only -- never kid_pin/auth_user_id, which household_members also carries.
create or replace function list_shareable_members()
returns table(id uuid, name text, household_name text)
language sql stable security definer
set search_path = public
as $$
  select hm.id, hm.name, h.name as household_name
  from household_members hm
  join households h on h.id = hm.household_id
  where hm.auth_user_id is not null
    and hm.id <> (select current_member_id())
$$;
revoke execute on function list_shareable_members() from public;
revoke execute on function list_shareable_members() from anon;
grant execute on function list_shareable_members() to authenticated;

-- v13: household_members' old "members readable" policy (anon+authenticated,
-- using(true)) was fine while every member was in one household, but would
-- expose kid_pin/auth_user_id to other households' Recipe Box accounts once
-- Martin/Maloy exist. Narrowed to same-household; cross-household sharing
-- already goes through list_shareable_members() (name + household only).
drop policy if exists "members readable" on household_members;
create policy "own household members readable" on household_members
  for select to authenticated
  using (household_id = (select my_household_id()));

alter table household_members alter column household_id set not null;
