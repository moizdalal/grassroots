-- Run this in the Supabase SQL Editor for project oejfviilvinzvipyozre
-- Adds: turnaround_days on listings, messaging, counter-offers, bid acceptance,
-- notifications, and proposal uploads.

-- ============================================================
-- 1. Turnaround days on listings
-- ============================================================
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS turnaround_days integer;

-- ============================================================
-- 2. Extend bids table with status, counter-offer, acceptance & proposal columns
-- ============================================================
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'
  CHECK (status IN ('pending','accepted','countered','rejected'));
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS counter_offer_cents integer
  CHECK (counter_offer_cents IS NULL OR counter_offer_cents > 0);
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS counter_offer_message text;
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS proposal_due_at timestamptz;
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS proposal_path text;

-- ============================================================
-- 3. Messages table (private per listing+consultant pair)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  sender_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body          text NOT NULL CHECK (char_length(body) > 0),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_thread
  ON public.messages(listing_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_participants
  ON public.messages(sender_id, recipient_id);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can see their own messages" ON public.messages;
CREATE POLICY "Users can see their own messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Users can send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid());

-- ============================================================
-- 4. Notifications table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  read        boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON public.notifications(user_id, read, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own notifications" ON public.notifications;
CREATE POLICY "Users see own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.notifications;
CREATE POLICY "Authenticated can insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================
-- 5. Allow listing owners to update bids (accept / counter)
-- ============================================================
DROP POLICY IF EXISTS "Listing owners can update bids" ON public.bids;
CREATE POLICY "Listing owners can update bids"
  ON public.bids FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.id = bids.listing_id AND l.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.id = bids.listing_id AND l.owner_id = auth.uid()
    )
  );

-- ============================================================
-- 6. Allow business owners to insert listings
-- ============================================================
DROP POLICY IF EXISTS "Business owners can insert listings" ON public.listings;
CREATE POLICY "Business owners can insert listings"
  ON public.listings FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'business_owner'
    )
  );

-- ============================================================
-- 7. Create proposals storage bucket (run once)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('proposals', 'proposals', false)
ON CONFLICT (id) DO NOTHING;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
