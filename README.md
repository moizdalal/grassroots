# Consultative Platform MVP

Minimal Node.js + Supabase app: registration (server), sign-in + marketplace browse (browser with anon key).

## Features

- **Register** (`/register.html`): email/password via Supabase Auth (service role on server), profiles, optional resume upload
- **Sign in** (`/signin.html`): Supabase `signInWithPassword` in the browser; session persisted locally
- **Marketplace** (`/`): lists open rows in `marketplace_listings` with poster name / business; consultants can place bids; listing owners see bids with consultant profile + amount (RLS-safe)
- **Profile** (`/profile.html`): signed-in users edit name, linkedin, employment; upload profile photo; business owners edit business fields; consultants can replace resume (browser + RLS)

## 1) Supabase setup

1. SQL Editor: run `supabase/schema.sql`
2. SQL Editor: run **`supabase/listings_and_marketplace.sql`** (creates `public.marketplace_listings` and, if you previously had `public.listings`, renames it so the app finds the table).
3. SQL Editor: run **`supabase/marketplace_bids.sql`** (bids + policies so owners see consultant profiles for bidders).
4. SQL Editor: run `supabase/profile_avatar.sql` (adds `avatar_path`, public `avatars` bucket, resume delete policy — required for `/profile.html` avatars on bids)
5. SQL Editor: run `supabase/migrations/add_listing_pause_status.sql` (adds paused listing state, owner close/pause reasons, and bidder read access for paused or closed listings)
6. SQL Editor: run `supabase/migrations/add_profile_phone_number.sql` (adds the profile phone number field used during registration and shown read-only on `/profile.html`)
7. SQL Editor: run `supabase/migrations/add_listing_attachments.sql` (adds listing attachment metadata plus the `listing_attachments` storage bucket used by `/create-listing.html`)

If you already ran an older `marketplace_listings.sql` only, you can skip step 2 when `marketplace_listings` already exists — still run step 3 for bidding.
8. Project **Settings → API**:
   - Project URL → `SUPABASE_URL`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (server only, never expose to the browser)
   - `anon` or **publishable** key → `SUPABASE_ANON_KEY`

### Optional: demo listing

Insert a row into `marketplace_listings` with a real `owner_id` from `profiles` (must be a `business_owner`). Example:

```sql
insert into public.marketplace_listings (owner_id, title, category, problem_summary, details)
values (
  'YOUR_BUSINESS_OWNER_PROFILE_UUID',
  'Revamp our enterprise funnel',
  'Marketing',
  'We are losing qualified leads after the first demo.',
  'More context for consultants…'
);
```

## 2) App setup

```bash
cd mvp-consult-platform
cp .env.example .env
```

Fill `.env`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (or add `SUPABASE_PUBLISHABLE_KEY` instead; the server accepts either)

Start:

```bash
npm run dev
```

Open `http://localhost:3000` (marketplace). Register at `/register.html`.

## API

- `GET /api/public-config` — returns `supabaseUrl` + `supabaseAnonKey` for browser clients
- `POST /api/register` — multipart registration (same as before)

## Next steps

- Post listing UI for business owners
- Chat (Supabase Realtime)
