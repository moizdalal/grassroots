-- Optional structured social URLs for business profiles (run in Supabase SQL editor)
ALTER TABLE public.business_profiles ADD COLUMN IF NOT EXISTS facebook_url text;
ALTER TABLE public.business_profiles ADD COLUMN IF NOT EXISTS instagram_url text;
ALTER TABLE public.business_profiles ADD COLUMN IF NOT EXISTS company_linkedin_url text;

NOTIFY pgrst, 'reload schema';
