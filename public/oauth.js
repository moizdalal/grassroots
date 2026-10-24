// OAuth is currently paused — no provider is wired up in Supabase, and
// the call sites in signin.js / register-flow.js are commented out. This
// module stays intact so it can be re-enabled by uncommenting those call
// sites once providers are configured. The /api/oauth-complete endpoint
// in app.js is its server-side counterpart.
import { getSupabaseClient } from "/supabase-loader.js";

export async function signInWithProvider(provider) {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth-callback.html`,
    },
  });
  if (error) throw error;
}

export function renderOAuthButtons(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="gr-oauth">
      <div class="gr-oauth__divider"><span>Or continue with</span></div>
      <div class="gr-oauth__buttons">
        <button type="button" class="gr-oauth__btn" data-provider="google">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          <span>Google</span>
        </button>
        <button type="button" class="gr-oauth__btn" data-provider="azure">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M11.4 2L2 11.5l3.5 4.1L11.4 2z" fill="#f25022"/><path d="M12 2l-5.5 13.6L22 11.5 12 2z" fill="#7fba00"/><path d="M5.5 15.6L2 11.5l4.5 10.5 5-3L5.5 15.6z" fill="#00a4ef"/><path d="M11.5 19l-5 3L22 11.5l-5.5 4L11.5 19z" fill="#ffb900"/></svg>
          <span>Microsoft</span>
        </button>
        <button type="button" class="gr-oauth__btn" data-provider="apple">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C3.79 16.17 4.36 9.53 8.7 9.28c1.23.07 2.08.72 2.8.75.92-.18 1.8-.9 2.83-.81 1.2.1 2.11.6 2.71 1.52-2.49 1.49-1.9 4.77.54 5.69-.45 1.2-.98 2.38-1.87 3.55l.34.3zM12.05 9.2c-.15-2.29 1.72-4.2 3.95-4.4.3 2.57-2.33 4.5-3.95 4.4z"/></svg>
          <span>Apple</span>
        </button>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-provider]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await signInWithProvider(btn.dataset.provider);
      } catch (err) {
        const status = document.getElementById("status");
        if (status) {
          status.textContent = err.message || "OAuth sign-in failed.";
          status.className = "gr-status error";
        }
      }
    });
  });
}
