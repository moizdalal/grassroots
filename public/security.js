// security.js — settings → security tab handlers.
//
// Three flows:
//   1. Change password    — re-auth via signInWithPassword(current),
//                           then updateUser({ password: new })
//   2. Sign out others    — signOut({ scope: "others" }); keeps this
//                           session live
//   3. Request deletion   — POSTs to /api/account/delete-request;
//                           server-side teardown (Stripe Connect detach,
//                           FK cascade sweep, admin.deleteUser) lands
//                           later. UI is the final shape — only the
//                           submission target swaps when the real
//                           endpoint is built.

import { getSupabaseClient } from "/supabase-loader.js";

const $ = (id) => document.getElementById(id);

function setStatus(el, msg, kind) {
  if (!el) return;
  el.textContent = msg || "";
  el.className = "gr-status" + (kind ? ` ${kind}` : "");
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle("is-loading", loading);
}

/* ---- Password change ------------------------------------------------ */

async function handlePasswordSubmit(event) {
  event.preventDefault();
  const status = $("sec-password-status");
  const saveBtn = $("sec-password-save");
  const currentEl = $("sec-current-password");
  const nextEl = $("sec-new-password");
  const confirmEl = $("sec-confirm-password");

  const currentPw = currentEl?.value || "";
  const nextPw = nextEl?.value || "";
  const confirmPw = confirmEl?.value || "";

  if (nextPw.length < 8) {
    setStatus(status, "New password must be at least 8 characters.", "error");
    return;
  }
  if (nextPw !== confirmPw) {
    setStatus(status, "Passwords don't match. Retype the new one.", "error");
    return;
  }
  if (nextPw === currentPw) {
    setStatus(status, "New password matches the current one. Pick something different.", "error");
    return;
  }

  setButtonLoading(saveBtn, true);
  setStatus(status, "Updating password…");

  try {
    const supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email;
    if (!email) {
      setStatus(status, "You're signed out. Refresh and sign back in.", "error");
      return;
    }

    // Verify current password before changing — Supabase doesn't gate
    // updateUser on a re-auth, so we have to do it ourselves.
    const reauth = await supabase.auth.signInWithPassword({ email, password: currentPw });
    if (reauth.error) {
      setStatus(status, "Current password is incorrect.", "error");
      return;
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: nextPw });
    if (updateErr) {
      setStatus(status, updateErr.message || "Could not update password. Try again.", "error");
      return;
    }

    // Wipe inputs + confirmation.
    if (currentEl) currentEl.value = "";
    if (nextEl) nextEl.value = "";
    if (confirmEl) confirmEl.value = "";
    setStatus(status, "Password updated.", "success");
  } catch (err) {
    setStatus(status, err?.message || "Something went wrong. Try again.", "error");
  } finally {
    setButtonLoading(saveBtn, false);
  }
}

/* ---- Sign out other devices ----------------------------------------- */

async function handleSignOutOthers() {
  const status = $("sec-signout-status");
  const btn = $("sec-signout-others");

  if (!window.confirm("Sign out of every other session? This browser stays signed in.")) {
    return;
  }

  setButtonLoading(btn, true);
  setStatus(status, "Signing out other sessions…");

  try {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) {
      setStatus(status, error.message || "Could not sign out other sessions.", "error");
      return;
    }
    setStatus(status, "Other sessions signed out.", "success");
  } catch (err) {
    setStatus(status, err?.message || "Something went wrong. Try again.", "error");
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ---- Request account deletion --------------------------------------- */

const DELETE_PHRASE = "delete my account";

async function handleDeleteRequest(event) {
  event.preventDefault();
  const status = $("sec-delete-status");
  const btn = $("sec-delete-btn");
  const phraseEl = $("sec-delete-confirm");
  const phrase = (phraseEl?.value || "").trim().toLowerCase();

  if (phrase !== DELETE_PHRASE) {
    setStatus(status, `Type "${DELETE_PHRASE}" exactly to confirm.`, "error");
    return;
  }

  if (!window.confirm("Submit a deletion request? We'll email you to confirm before anything is removed.")) {
    return;
  }

  setButtonLoading(btn, true);
  setStatus(status, "Submitting request…");

  try {
    const supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch("/api/account/delete-request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ confirm: DELETE_PHRASE }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `Server returned ${res.status}`);
    }
    if (phraseEl) phraseEl.value = "";
    setStatus(status, "Request received. We'll email you to confirm before deleting anything.", "success");
  } catch (err) {
    setStatus(status, err?.message || "Could not submit request. Try again later.", "error");
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ---- Request data export -------------------------------------------- */

const EXPORT_PHRASE = "export my data";

async function handleExportRequest(event) {
  event.preventDefault();
  const status = $("sec-export-status");
  const btn = $("sec-export-btn");
  const phraseEl = $("sec-export-confirm");
  const phrase = (phraseEl?.value || "").trim().toLowerCase();

  if (phrase !== EXPORT_PHRASE) {
    setStatus(status, `Type "${EXPORT_PHRASE}" exactly to confirm.`, "error");
    return;
  }

  setButtonLoading(btn, true);
  setStatus(status, "Submitting request…");

  try {
    const supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch("/api/account/export-request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ confirm: EXPORT_PHRASE }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `Server returned ${res.status}`);
    }
    if (phraseEl) phraseEl.value = "";
    setStatus(
      status,
      "Request received. We'll email you a download link within 30 days.",
      "success"
    );
  } catch (err) {
    setStatus(status, err?.message || "Could not submit request. Try again later.", "error");
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ---- Wire up -------------------------------------------------------- */

$("sec-password-form")?.addEventListener("submit", handlePasswordSubmit);
$("sec-signout-others")?.addEventListener("click", handleSignOutOthers);
$("sec-delete-form")?.addEventListener("submit", handleDeleteRequest);
$("sec-export-form")?.addEventListener("submit", handleExportRequest);
