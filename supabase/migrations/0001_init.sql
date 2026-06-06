-- Divini Procure — initial schema (MVP)
-- Safe to run once on a fresh project. RLS is enabled; starter policies are
-- scoped by company membership and SHOULD be reviewed/hardened before launch.

create extension if not exists "pgcrypto";

-- ---------- core identity ----------
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('buyer','vendor')),
  name text not null,
  contact_name text, contact_title text, phone text, email text,
  street text, city text, region text,
  logo_url text, billing_email text,
  rating numeric default 0,
  created_at timestamptz default now()
);

create table if not exists company_members (
  company_id uuid references companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text default 'owner',
  seat int default 1,
  created_at timestamptz default now(),
  primary key (company_id, user_id)
);

create table if not exists vendor_profiles (
  company_id uuid primary key references companies(id) on delete cascade,
  trust int default 50,
  verify_status text default 'pending' check (verify_status in ('pending','ai-verified','approved','flagged')),
  rating numeric default 0,
  services text[] default '{}'
);

create table if not exists vendor_credentials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  type text not null, doc_url text, registry text, result text,
  confidence numeric, ok boolean default true,
  status text default 'pending',
  scanned_at timestamptz,
  created_at timestamptz default now()
);

-- ---------- projects & bidding ----------
create table if not exists buildings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade, -- buyer/developer
  name text not null, sub text, location text, developer text,
  budget numeric, progress int default 0,
  created_at timestamptz default now()
);

create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  building_id uuid references buildings(id) on delete cascade,
  category text not null,
  status text default 'open' check (status in ('draft','open','shortlisting','awarded','closed')),
  budget_min numeric, budget_max numeric,
  deadline date, requirements text[] default '{}',
  created_at timestamptz default now()
);

create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  vendor_company_id uuid references companies(id) on delete cascade,
  price numeric, days int, note text,
  status text default 'submitted' check (status in ('draft','submitted','shortlisted','rebid','awarded','revision')),
  is_draft boolean default false,
  docs_ok boolean default false,
  awarded boolean default false,
  paid boolean default false,
  accepted jsonb,
  created_at timestamptz default now()
);

create table if not exists bid_line_items (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid references bids(id) on delete cascade,
  name text, qty numeric default 1, unit_price numeric
);

create table if not exists bid_revisions (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid references bids(id) on delete cascade,
  proposed jsonb not null,
  status text default 'pending' check (status in ('pending','accepted','declined')),
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ---------- messaging, files, reviews ----------
create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  vendor_company_id uuid references companies(id) on delete cascade,
  buyer_company_id uuid references companies(id) on delete cascade,
  category text,
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references threads(id) on delete cascade,
  sender_company_id uuid references companies(id) on delete cascade,
  body text,
  created_at timestamptz default now()
);

create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  owner_company_id uuid references companies(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  bid_id uuid references bids(id) on delete set null,
  thread_id uuid references threads(id) on delete set null,
  name text, storage_path text,
  created_at timestamptz default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  rater_company_id uuid references companies(id) on delete cascade,
  ratee_company_id uuid references companies(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  stars int check (stars between 1 and 5),
  body text,
  created_at timestamptz default now()
);

-- ---------- notifications, billing, payouts ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text, detail text, kind text,
  read boolean default false,
  created_at timestamptz default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  plan text, price numeric, status text default 'active',
  intro boolean default false, referral boolean default false,
  current_period_end timestamptz,
  created_at timestamptz default now()
);

create table if not exists payouts (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid references bids(id) on delete cascade,
  amount numeric, method text check (method in ('ach','wire')),
  status text default 'pending',
  created_at timestamptz default now()
);

-- ---------- helper: companies the current user belongs to ----------
create or replace function public.user_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select company_id from company_members where user_id = auth.uid()
$$;

-- ---------- RLS ----------
alter table companies enable row level security;
alter table company_members enable row level security;
alter table vendor_profiles enable row level security;
alter table vendor_credentials enable row level security;
alter table buildings enable row level security;
alter table packages enable row level security;
alter table bids enable row level security;
alter table bid_line_items enable row level security;
alter table bid_revisions enable row level security;
alter table threads enable row level security;
alter table messages enable row level security;
alter table files enable row level security;
alter table reviews enable row level security;
alter table notifications enable row level security;
alter table subscriptions enable row level security;
alter table payouts enable row level security;

-- companies: members can read/write their own company; any authed user can read (marketplace discovery)
create policy companies_read on companies for select to authenticated using (true);
create policy companies_write on companies for all to authenticated
  using (id in (select user_company_ids())) with check (id in (select user_company_ids()));

create policy members_self on company_members for select to authenticated
  using (user_id = auth.uid() or company_id in (select user_company_ids()));
create policy members_manage on company_members for all to authenticated
  using (company_id in (select user_company_ids())) with check (company_id in (select user_company_ids()));

create policy vprofiles_read on vendor_profiles for select to authenticated using (true);
create policy vprofiles_write on vendor_profiles for all to authenticated
  using (company_id in (select user_company_ids())) with check (company_id in (select user_company_ids()));

create policy vcreds_rw on vendor_credentials for all to authenticated
  using (company_id in (select user_company_ids())) with check (company_id in (select user_company_ids()));

-- buildings/packages: public read (open marketplace), owner write
create policy buildings_read on buildings for select to authenticated using (true);
create policy buildings_write on buildings for all to authenticated
  using (company_id in (select user_company_ids())) with check (company_id in (select user_company_ids()));

create policy packages_read on packages for select to authenticated using (true);
create policy packages_write on packages for all to authenticated using (
  building_id in (select id from buildings where company_id in (select user_company_ids()))
) with check (
  building_id in (select id from buildings where company_id in (select user_company_ids()))
);

-- bids: visible to bidding vendor and to the buyer that owns the package
create policy bids_read on bids for select to authenticated using (
  vendor_company_id in (select user_company_ids())
  or package_id in (select p.id from packages p join buildings b on b.id = p.building_id
                    where b.company_id in (select user_company_ids()))
);
create policy bids_vendor_write on bids for all to authenticated
  using (vendor_company_id in (select user_company_ids()))
  with check (vendor_company_id in (select user_company_ids()));

create policy lineitems_rw on bid_line_items for all to authenticated using (
  bid_id in (select id from bids where vendor_company_id in (select user_company_ids()))
) with check (
  bid_id in (select id from bids where vendor_company_id in (select user_company_ids()))
);

create policy revisions_rw on bid_revisions for all to authenticated using (
  bid_id in (select id from bids where vendor_company_id in (select user_company_ids())
             or package_id in (select p.id from packages p join buildings b on b.id=p.building_id
                               where b.company_id in (select user_company_ids())))
) with check (true);

-- threads/messages: either party may access
create policy threads_rw on threads for all to authenticated using (
  vendor_company_id in (select user_company_ids()) or buyer_company_id in (select user_company_ids())
) with check (
  vendor_company_id in (select user_company_ids()) or buyer_company_id in (select user_company_ids())
);
create policy messages_rw on messages for all to authenticated using (
  thread_id in (select id from threads where vendor_company_id in (select user_company_ids())
                or buyer_company_id in (select user_company_ids()))
) with check (
  sender_company_id in (select user_company_ids())
);

create policy files_rw on files for all to authenticated
  using (owner_company_id in (select user_company_ids())) with check (owner_company_id in (select user_company_ids()));

create policy reviews_read on reviews for select to authenticated using (true);
create policy reviews_write on reviews for insert to authenticated with check (rater_company_id in (select user_company_ids()));

create policy notifs_self on notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy subs_rw on subscriptions for all to authenticated
  using (company_id in (select user_company_ids())) with check (company_id in (select user_company_ids()));

create policy payouts_read on payouts for select to authenticated using (
  bid_id in (select id from bids where vendor_company_id in (select user_company_ids())
             or package_id in (select p.id from packages p join buildings b on b.id=p.building_id
                               where b.company_id in (select user_company_ids())))
);

-- ---------- storage buckets ----------
insert into storage.buckets (id, name, public) values
  ('logos','logos', true),
  ('project-files','project-files', false),
  ('vendor-docs','vendor-docs', false)
on conflict (id) do nothing;

-- logos: public read, authed write
create policy "logos read"  on storage.objects for select using (bucket_id = 'logos');
create policy "logos write" on storage.objects for insert to authenticated with check (bucket_id = 'logos');
-- private buckets: authenticated read/write (scope by company path in production)
create policy "private read"  on storage.objects for select to authenticated using (bucket_id in ('project-files','vendor-docs'));
create policy "private write" on storage.objects for insert to authenticated with check (bucket_id in ('project-files','vendor-docs'));
