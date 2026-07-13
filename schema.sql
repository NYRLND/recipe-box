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
