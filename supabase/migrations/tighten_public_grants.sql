-- Tightens role grants on app-managed tables in the public schema, in
-- preparation for supabase removing default grants on Oct 30, 2026 (for
-- existing projects). The verbs we keep on each role match what the
-- frontend (anon/authenticated) and the server (service_role) actually
-- need; anything extra is revoked.
--
-- Service_role bypasses RLS by design — server-side writes flow through
-- it via the admin supabase client.
-- Authenticated callers go through supabase-js with the user's JWT and
-- are further gated by RLS policies on each table.
-- Anon callers are signed-out viewers; none of these tables expose data
-- to anon today.

-- ── portfolio_items ─────────────────────────────────────────────
revoke all on public.portfolio_items from anon;
revoke all on public.portfolio_items from authenticated;
grant select, insert, update, delete on public.portfolio_items to authenticated;
grant all on public.portfolio_items to service_role;

-- ── message_reads ───────────────────────────────────────────────
revoke all on public.message_reads from anon;
revoke all on public.message_reads from authenticated;
grant select, insert, update on public.message_reads to authenticated;
grant all on public.message_reads to service_role;

-- ── listing_views ───────────────────────────────────────────────
revoke all on public.listing_views from anon;
revoke all on public.listing_views from authenticated;
grant select, insert on public.listing_views to authenticated;
grant all on public.listing_views to service_role;

-- ── bid_phase_payments ──────────────────────────────────────────
-- Frontend reads only. All writes happen server-side via service_role
-- (PI creation, status flips, transfers).
revoke all on public.bid_phase_payments from anon;
revoke all on public.bid_phase_payments from authenticated;
grant select on public.bid_phase_payments to authenticated;
grant all on public.bid_phase_payments to service_role;

-- ── retainer_subscriptions ──────────────────────────────────────
-- Same shape as bid_phase_payments.
revoke all on public.retainer_subscriptions from anon;
revoke all on public.retainer_subscriptions from authenticated;
grant select on public.retainer_subscriptions to authenticated;
grant all on public.retainer_subscriptions to service_role;
