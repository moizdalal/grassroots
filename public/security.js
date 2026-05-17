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
    setStatus(status, "new password must be at least 8 characters.", "error");
    return;
  }
  if (nextPw !== confirmPw) {
    setStatus(status, "passwords don't match. retype the new one.", "error");
    return;
  }
  if (nextPw === currentPw) {
    setStatus(status, "new password matches the current one. pick something different.", "error");
    return;
  }

  setButtonLoading(saveBtn, true);
  setStatus(status, "updating password…");

  try {
    const supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email;
    if (!email) {
      setStatus(status, "you're signed out. refresh and sign back in.", "error");
      return;
    }

    // Verify current password before changing — Supabase doesn't gate
    // updateUser on a re-auth, so we have to do it ourselves.
    const reauth = await supabase.auth.signInWithPassword({ email, password: currentPw });
    if (reauth.error) {
      setStatus(status, "current password is incorrect.", "error");
      return;
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: nextPw });
    if (updateErr) {
      setStatus(status, updateErr.message || "could not update password. try again.", "error");
      return;
    }

    // Wipe inputs + confirmation.
    if (currentEl) currentEl.value = "";
    if (nextEl) nextEl.value = "";
    if (confirmEl) confirmEl.value = "";
    setStatus(status, "password updated.", "success");
  } catch (err) {
    setStatus(status, err?.message || "something went wrong. try again.", "error");
  } finally {
    setButtonLoading(saveBtn, false);
  }
}

/* ---- Sign out other devices ----------------------------------------- */

async function handleSignOutOthers() {
  const status = $("sec-signout-status");
  const btn = $("sec-signout-others");

  if (!window.confirm("sign out of every other session? this browser stays signed in.")) {
    return;
  }

  setButtonLoading(btn, true);
  setStatus(status, "signing out other sessions…");

  try {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) {
      setStatus(status, error.message || "could not sign out other sessions.", "error");
      return;
    }
    setStatus(status, "other sessions signed out.", "success");
  } catch (err) {
    setStatus(status, err?.message || "something went wrong. try again.", "error");
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
    setStatus(status, `type "${DELETE_PHRASE}" exactly to confirm.`, "error");
    return;
  }

  if (!window.confirm("submit a deletion request? we'll email you to confirm before anything is removed.")) {
    return;
  }

  setButtonLoading(btn, true);
  setStatus(status, "submitting request…");

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
      throw new Error(body?.error || `server returned ${res.status}`);
    }
    if (phraseEl) phraseEl.value = "";
    setStatus(status, "request received. we'll email you to confirm before deleting anything.", "success");
  } catch (err) {
    setStatus(status, err?.message || "could not submit request. try again later.", "error");
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ---- Wire up -------------------------------------------------------- */

$("sec-password-form")?.addEventListener("submit", handlePasswordSubmit);
$("sec-signout-others")?.addEventListener("click", handleSignOutOthers);
$("sec-delete-form")?.addEventListener("submit", handleDeleteRequest);
