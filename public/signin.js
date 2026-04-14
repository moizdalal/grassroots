import { getSupabaseClient } from "/supabase-loader.js";
import { renderOAuthButtons } from "/oauth.js";

const form = document.getElementById("signin-form");
const statusEl = document.getElementById("status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "signing in…";
  statusEl.className = "gr-status";

  const email = form.email.value.trim();
  const password = form.password.value;

  try {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    statusEl.textContent = "signed in — redirecting…";
    statusEl.className = "gr-status success";
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    const dest =
      next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    window.location.href = dest;
  } catch (error) {
    statusEl.textContent = error.message || "sign-in failed.";
    statusEl.className = "gr-status error";
  }
});

renderOAuthButtons("oauth-slot");
