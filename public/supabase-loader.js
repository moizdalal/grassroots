import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

let clientPromise;

export async function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const response = await fetch("/api/public-config");
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Could not load Supabase configuration.");
      }
      return createClient(body.supabaseUrl, body.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    })();
  }
  return clientPromise;
}
