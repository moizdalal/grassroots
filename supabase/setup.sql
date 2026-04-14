-- Run this in the Supabase SQL Editor for project oejfviilvinzvipyozre
-- Adds avatar_path to profiles and creates the bids table for consultant bidding.

-- 1. Add avatar_path to profiles (idempotent)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_path text;

-- 2. Create bids table
CREATE TABLE IF NOT EXISTS public.bids (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  message     text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (listing_id, consultant_id)
);

CREATE INDEX IF NOT EXISTS idx_bids_listing  ON public.bids(listing_id);
CREATE INDEX IF NOT EXISTS idx_bids_consultant ON public.bids(consultant_id);

-- 3. Enable RLS
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Listing owners can see bids on their listings" ON public.bids;
DROP POLICY IF EXISTS "Consultants can see their own bids" ON public.bids;
DROP POLICY IF EXISTS "Consultants can insert bids on open listings" ON public.bids;
DROP POLICY IF EXISTS "Consultants can update their own bids" ON public.bids;
DROP POLICY IF EXISTS "Consultants can delete their own bids" ON public.bids;

-- Listing owners see all bids on their listings
CREATE POLICY "Listing owners can see bids on their listings"
  ON public.bids FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.id = bids.listing_id AND l.owner_id = auth.uid()
    )
  );

-- Consultants see their own bids
CREATE POLICY "Consultants can see their own bids"
  ON public.bids FOR SELECT
  TO authenticated
  USING (consultant_id = auth.uid());

-- Consultants insert bids on open listings
CREATE POLICY "Consultants can insert bids on open listings"
  ON public.bids FOR INSERT
  TO authenticated
  WITH CHECK (
    consultant_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'consultant'
    )
    AND EXISTS (
      SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.status = 'open'
    )
  );

-- Consultants update their own bids
CREATE POLICY "Consultants can update their own bids"
  ON public.bids FOR UPDATE
  TO authenticated
  USING (consultant_id = auth.uid())
  WITH CHECK (consultant_id = auth.uid());

-- Consultants delete their own bids
CREATE POLICY "Consultants can delete their own bids"
  ON public.bids FOR DELETE
  TO authenticated
  USING (consultant_id = auth.uid());

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
