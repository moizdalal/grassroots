-- Minimal mirror of the live public schema (2026-10-20) that rls_lockdown.sql runs on:
-- the tables, policies and default ALL grants the audit found. Not a full schema dump.
-- Used by scripts/test-rls-lockdown.mjs.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
grant usage on schema auth, public, storage to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub','')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table storage.buckets (id text primary key, public bool, file_size_limit bigint, allowed_mime_types text[]);
insert into storage.buckets values ('portfolio', true, null, null);

create table profiles (id uuid primary key, role text, full_name text, employment_status text, linkedin_url text, resume_path text, created_at timestamptz default now(), avatar_path text, resume_public bool default false, read_receipts_enabled bool default true, stripe_account_id text, stripe_account_status text, stripe_customer_id text, phone_number text, onboarded_at timestamptz, referred_by_code text, terms_accepted_at timestamptz, deletion_requested_at timestamptz, export_requested_at timestamptz);
create table listings (id uuid primary key, owner_id uuid references profiles(id), status text, title text);
create table bids (id uuid primary key default gen_random_uuid(), listing_id uuid references listings(id), consultant_id uuid references profiles(id), amount_cents int not null check (amount_cents>0), message text, created_at timestamptz default now(), status text default 'pending', counter_offer_cents int, counter_offer_message text, accepted_at timestamptz, proposal_due_at timestamptz, proposal_path text, payment_intent_id text, payment_status text default 'unpaid', payment_amount_cents int, transfer_id text, paid_at timestamptz, released_at timestamptz, proposal_fee_cents int, service_fee_cents int, move_forward_status text, move_forward_decided_at timestamptz, counter_expires_at timestamptz, counter_responded_at timestamptz, counter_response_message text, counter_attempted bool not null default false, stripe_fee_cents int, platform_fee_cents int, consultant_payout_cents int, unique(listing_id, consultant_id),
 constraint bids_status_check check (status = any (array['pending','accepted','countered','rejected'])));
create table business_profiles (user_id uuid primary key references profiles(id), business_name text, business_address text);
create table consultant_profiles (user_id uuid primary key references profiles(id), school text);
create table consultant_reviews (id uuid primary key default gen_random_uuid(), listing_id uuid, bid_id uuid not null unique, owner_id uuid, consultant_id uuid, work_product_quality numeric default 5, communication numeric default 5, timeliness numeric default 5, professionalism numeric default 5, cost_value numeric default 5);
create view consultant_review_summary with (security_invoker=true) as select consultant_id, count(*) n from consultant_reviews group by 1;
create table messages (id uuid primary key default gen_random_uuid(), sender_id uuid, recipient_id uuid, body text, read_at timestamptz);
create table notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, read bool default false);
create table engagement_schedules (id uuid primary key default gen_random_uuid(), owner_id uuid, consultant_id uuid, listing_id uuid);
create table consultant_past_work (id uuid primary key default gen_random_uuid(), user_id uuid);
create table portfolio_items (id uuid primary key default gen_random_uuid(), user_id uuid, is_public bool default false);

do $$ declare t text; begin for t in select tablename from pg_tables where schemaname='public' loop
 execute format('alter table public.%I enable row level security', t);
 execute format('grant all on public.%I to anon, authenticated, service_role', t); end loop; end $$;
grant all on consultant_review_summary to anon, authenticated, service_role;

create function profile_has_open_listing(pid uuid) returns bool language sql stable security definer set search_path=public as $$ select exists(select 1 from listings where owner_id=pid and status='open') $$;
create function profile_has_bid_listing(pid uuid) returns bool language sql stable security definer set search_path=public as $$ select exists(select 1 from listings l join bids b on b.listing_id=l.id where l.owner_id=pid and b.consultant_id=auth.uid()) $$;
create function user_has_bid_on_listing(lid uuid) returns bool language sql stable security definer set search_path=public as $$ select exists(select 1 from bids where listing_id=lid and consultant_id=auth.uid()) $$;

create policy "Consultants can delete their own bids" on bids for delete to authenticated using (consultant_id = auth.uid());
create policy "ins" on bids for insert to authenticated with check (consultant_id = auth.uid() and exists(select 1 from profiles p where p.id=auth.uid() and p.role='consultant') and exists(select 1 from listings l where l.id=bids.listing_id and l.status='open'));
create policy "csel" on bids for select to authenticated using (consultant_id = auth.uid());
create policy "cupd" on bids for update to authenticated using (consultant_id = auth.uid()) with check (consultant_id = auth.uid());
create policy "osel" on bids for select to authenticated using (exists(select 1 from listings l where l.id=bids.listing_id and l.owner_id=auth.uid()));
create policy "oupd" on bids for update to authenticated using (exists(select 1 from listings l where l.id=bids.listing_id and l.owner_id=auth.uid())) with check (exists(select 1 from listings l where l.id=bids.listing_id and l.owner_id=auth.uid()));
create policy "business owners can view consultant profiles" on profiles for select to authenticated using (role='consultant');
create policy "bidl" on profiles for select to authenticated using (profile_has_bid_listing(id));
create policy "openl" on profiles for select to anon, authenticated using (profile_has_open_listing(id));
create policy "own upd" on profiles for update to authenticated using (auth.uid()=id) with check (auth.uid()=id);
create policy "own sel" on profiles for select to authenticated using (auth.uid()=id);
create policy "business owners can view consultant detail profiles" on consultant_profiles for select to authenticated using (true);
create policy "bp open" on business_profiles for select to anon, authenticated using (profile_has_open_listing(user_id));
create policy "owners insert reviews for own accepted work" on consultant_reviews for insert to authenticated with check (owner_id = auth.uid() and exists(select 1 from listings l where l.id=consultant_reviews.listing_id and l.owner_id=auth.uid()));
create policy "rsel" on consultant_reviews for select to authenticated using (owner_id=auth.uid() or consultant_id=auth.uid());
create policy "lopen" on listings for select to anon, authenticated using (status='open');
create policy "lown" on listings for select to authenticated using (owner_id=auth.uid());
create policy "lbid" on listings for select to authenticated using (user_has_bid_on_listing(id));
create policy "mupd" on messages for update using (auth.uid()=recipient_id) with check (auth.uid()=recipient_id);
create policy "anyone can view public portfolio items" on portfolio_items for select to authenticated using (is_public = true);
create policy "Users can send messages" on messages for insert to authenticated with check (sender_id = auth.uid());
create policy "msel" on messages for select to authenticated using (sender_id=auth.uid() or recipient_id=auth.uid());

-- seed
insert into profiles(id, role, full_name, phone_number, stripe_customer_id, stripe_account_id) values
 ('00000000-0000-0000-0000-00000000000a','business_owner','owner a','555-a','cus_A',null),
 ('00000000-0000-0000-0000-00000000000b','business_owner','owner b','555-b','cus_B',null),
 ('00000000-0000-0000-0000-00000000000c','consultant','consultant c','555-c',null,'acct_C'),
 ('00000000-0000-0000-0000-00000000000d','consultant','consultant d','555-d',null,'acct_D');
insert into listings values ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','open','L-A'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','open','L-B');
insert into business_profiles values ('00000000-0000-0000-0000-00000000000a','biz a','1 main st');
insert into consultant_profiles values ('00000000-0000-0000-0000-00000000000c','uf'), ('00000000-0000-0000-0000-00000000000d','fsu');
insert into portfolio_items(user_id, is_public) values ('00000000-0000-0000-0000-00000000000c', true), ('00000000-0000-0000-0000-00000000000d', true);
insert into bids(id, listing_id, consultant_id, amount_cents) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000c',50000);
insert into bids(id, listing_id, consultant_id, amount_cents, status, payment_status, accepted_at) values
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c',70000,'accepted','released', now());
insert into messages(id, sender_id, recipient_id, body) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000a','hi');
