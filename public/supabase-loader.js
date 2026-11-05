// Self-hosted bundle (see src/supabase-browser.js / npm run build:supabase).
import { createClient } from "/vendor/supabase-js.js";

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
