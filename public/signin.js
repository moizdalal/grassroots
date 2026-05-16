import { getSupabaseClient } from "/supabase-loader.js";
import { showSuccess } from "/toast.js";
// OAuth is paused until providers are configured in supabase. To re-enable,
// uncomment the import + the renderOAuthButtons() call below.
// import { renderOAuthButtons } from "/oauth.js";

const form = document.getElementById("signin-form");
const statusEl = document.getElementById("status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "";
  statusEl.className = "gr-status";

  const email = form.email.value.trim();
  const password = form.password.value;

  try {
    const supabase = await getSupabaseClient();
    const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showSuccess("signed in — redirecting…");

    const params = new URLSearchParams(window.location.search);
    const nextParam = params.get("next");
    const safeNext =
      nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;

    let dest = safeNext;
    if (!dest) {
      // Route by role so business owners land on /dashboard.html directly
      // instead of flashing through the consultant marketplace.
      const userId = signInData?.user?.id;
      if (userId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .single();
        dest =
          profile?.role === "business_owner"
            ? "/dashboard.html"
            : profile?.role === "consultant"
              ? "/consultant-dashboard.html"
              : "/";
      } else {
        dest = "/";
      }
    }
    window.location.href = dest;
  } catch (error) {
    statusEl.textContent = error.message || "sign-in failed.";
    statusEl.className = "gr-status error";
  }
});

// renderOAuthButtons("oauth-slot"); // re-enable once oauth providers are configured in supabase

// Password reveal toggle (delegated). Any [data-pw-toggle="<input-id>"]
// button flips its target between password and text.
document.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-pw-toggle]");
  if (!btn) return;
  const input = document.getElementById(btn.dataset.pwToggle);
  if (!input) return;
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  btn.setAttribute("aria-pressed", String(reveal));
  btn.setAttribute("aria-label", reveal ? "hide password" : "show password");
  btn.classList.toggle("gr-pw-toggle--shown", reveal);
});
