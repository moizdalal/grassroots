// my-profile-cache.js — once-per-page loaders for the signed-in user's
// own profile row and private profile RPC.
//
// Settings runs several independent scripts (profile form, read
// receipts, payout tab, side nav) that each used to query `profiles`
// and `get_my_private_profile` on their own. They now share one
// in-flight promise per resource, so each is fetched once per page load.
//
// The store lives on window so non-importing scripts (side-nav.js) can
// peek at an in-flight row without triggering the wider fetch on pages
// that never asked for it.

import { getSupabaseClient } from "/supabase-loader.js";

// Superset of every column the settings page reads off `profiles`.
const PROFILE_COLUMNS =
  "id, role, full_name, avatar_path, linkedin_url, resume_public, read_receipts_enabled, stripe_account_status, onboarded_at, created_at, consultant_profiles ( * ), business_profiles ( business_name, business_address, website_url, business_details, social_links, instagram_url, facebook_url, company_linkedin_url )";
// Fallback for databases that predate business_profiles.business_address.
const PROFILE_COLUMNS_NO_ADDRESS = PROFILE_COLUMNS.replace(" business_address,", "");

const store = (window.__grMyProfileCache = window.__grMyProfileCache || {});

function isMissingBusinessAddress(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("business_address") &&
    (msg.includes("schema cache") || msg.includes("does not exist") || msg.includes("could not find"))
  );
}

export function getSessionOnce() {
  if (!store.session) {
    store.session = (async () => {
      const client = await getSupabaseClient();
      const { data: { session } } = await client.auth.getSession();
      return { client, session };
    })();
  }
  return store.session;
}

// Resolves to { client, session, row, error, businessAddressSupported }.
// row is null when signed out or on error.
export function getMyProfile() {
  if (!store.profile) {
    store.profile = (async () => {
      const { client, session } = await getSessionOnce();
      if (!session?.user) {
        return { client, session, row: null, error: null, businessAddressSupported: true };
      }
      let businessAddressSupported = true;
      let { data: row, error } = await client
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("id", session.user.id)
        .single();
      if (error && isMissingBusinessAddress(error)) {
        businessAddressSupported = false;
        ({ data: row, error } = await client
          .from("profiles")
          .select(PROFILE_COLUMNS_NO_ADDRESS)
          .eq("id", session.user.id)
          .single());
      }
      return { client, session, row: row || null, error: error || null, businessAddressSupported };
    })();
  }
  return store.profile;
}

// Resolves to the get_my_private_profile row (phone, resume path,
// stripe ids) or null. Column grants keep these off the table select.
export function getMyPrivateProfile() {
  if (!store.privateProfile) {
    store.privateProfile = (async () => {
      const { client, session } = await getSessionOnce();
      if (!session?.user) return null;
      const { data } = await client.rpc("get_my_private_profile").maybeSingle();
      return data || null;
    })();
  }
  return store.privateProfile;
}
