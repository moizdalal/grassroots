// applications.js — the admin "applications" tab. Live data from
// /api/admin/applications: every student who applied on /for-students.
//
// Click a row to read the full application. From there:
//   Create invite link → makes a consultant invite for their .edu address,
//                        copies the link, marks the application invited.
//                        You send the link yourself (reply to their email).
//   Decline            → marks it declined. Nothing is emailed.
//   Move back to new   → undoes either of the above (an invite link already
//                        made keeps working until it expires).

import { getSupabaseClient } from "/supabase-loader.js";
import { showSuccess, showError } from "/toast.js";
import { confirmDialog } from "/confirm-modal.js";

const FILTERS = [
  ["new", "New"],
  ["invited", "Invited"],
  ["declined", "Declined"],
  ["all", "All"],
];
const PILL = { new: ["New", "pending"], invited: ["Invited", "accepted"], declined: ["Declined", "muted"] };

let applications = [];
let filter = "new";
let openId = null;
let loading = null;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

async function authHeaders() {
  const client = await getSupabaseClient();
  const { data: { session } } = await client.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function safeUrl(link) {
  if (!link) return null;
  const withScheme = /^https?:\/\//i.test(link) ? link : `https://${link}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch (_) {
    return null;
  }
}

function renderFilters() {
  const host = document.getElementById("adm-app-filters");
  host.innerHTML = FILTERS.map(([key, label]) => {
    const n = key === "all" ? applications.length : applications.filter((a) => a.status === key).length;
    return `<button type="button" class="adm-chip${key === filter ? " is-active" : ""}" data-app-filter="${key}">${esc(label)} · ${n}</button>`;
  }).join("");
  host.querySelectorAll("[data-app-filter]").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.appFilter;
    openId = null;
    renderFilters();
    renderTable();
  }));
}

function detailRow(a) {
  const extras = (a.extras || []).map((e) => `${esc(e.type)}: ${esc(e.name)}`).join(" · ");
  const url = safeUrl(a.link);
  const link = a.link
    ? (url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(a.link)}</a>` : esc(a.link))
    : `<span class="adm-cell-sub">None given</span>`;
  const reply = `mailto:${encodeURIComponent(a.email)}?subject=${encodeURIComponent("Your Grassroots application")}`;
  const actions = [
    a.status !== "invited" ? `<button type="button" class="gr-btn gr-btn--primary gr-btn--sm" data-app-action="invite">Create invite link</button>` : `<button type="button" class="gr-btn gr-btn--ghost gr-btn--sm" data-app-action="invite">New invite link</button>`,
    a.status === "new" ? `<button type="button" class="gr-btn gr-btn--ghost gr-btn--sm" data-app-action="decline">Decline</button>` : "",
    a.status !== "new" ? `<button type="button" class="gr-btn gr-btn--ghost gr-btn--sm" data-app-action="reopen">Move back to new</button>` : "",
    `<a class="gr-btn gr-btn--ghost gr-btn--sm" href="${reply}">Email them</a>`,
  ].join("");
  return `
    <tr class="adm-app-detail"><td colspan="6">
      <dl class="adm-app-kv">
        ${extras ? `<div><dt>Other degrees</dt><dd>${extras}</dd></div>` : ""}
        <div><dt>Strongest work</dt><dd>${link}</dd></div>
        <div><dt>A past project they're proud of</dt><dd class="adm-app-project">${esc(a.project)}</dd></div>
        <div><dt>Confirmation email</dt><dd>${a.confirmation_sent_at ? `Sent ${esc(day(a.confirmation_sent_at))}` : `<span class="adm-cell-sub">Not sent</span>`}</dd></div>
      </dl>
      <div class="adm-app-actions" data-app-id="${esc(a.id)}">${actions}</div>
      <p class="adm-app-invite" id="adm-app-invite" hidden></p>
    </td></tr>`;
}

function renderTable() {
  const tbody = document.getElementById("adm-app-tbody");
  const rows = filter === "all" ? applications : applications.filter((a) => a.status === filter);
  document.getElementById("adm-app-count").textContent = `${rows.length} of ${applications.length}`;
  if (!rows.length) {
    const empty = filter === "new" ? "No new applications. You're caught up." : "Nothing here right now.";
    tbody.innerHTML = `<tr><td colspan="6" class="adm-cell-sub">${empty}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((a) => {
    const [label, kind] = PILL[a.status] || [a.status, "muted"];
    const age = daysAgo(a.created_at);
    // New applications past the one-week promise get a warm nudge.
    const late = a.status === "new" && age >= 7;
    return `
      <tr class="adm-tr${a.id === openId ? " is-open" : ""}" data-app-row="${esc(a.id)}" tabindex="0" aria-expanded="${a.id === openId}">
        <td><div class="adm-cell-name">${esc(a.name)}</div><div class="adm-cell-sub">${esc(a.school)}</div></td>
        <td>${esc(a.email)}</td>
        <td>${esc(a.major)}</td>
        <td>${esc(a.city)}</td>
        <td>${esc(day(a.created_at))}<div class="adm-cell-sub${late ? " adm-app-late" : ""}">${age === 0 ? "Today" : `${age}d ago`}${late ? " · past 1 week" : ""}</div></td>
        <td><span class="adm-pill adm-pill--${kind}">${esc(label)}</span></td>
      </tr>${a.id === openId ? detailRow(a) : ""}`;
  }).join("");

  tbody.querySelectorAll("tr[data-app-row]").forEach((tr) => {
    const toggle = () => {
      openId = openId === tr.dataset.appRow ? null : tr.dataset.appRow;
      renderTable();
    };
    tr.addEventListener("click", toggle);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") toggle(); });
  });
  tbody.querySelectorAll("[data-app-action]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    act(b.closest("[data-app-id]").dataset.appId, b.dataset.appAction, b);
  }));
}

async function act(id, action, btn) {
  const a = applications.find((x) => x.id === id);
  if (!a) return;
  if (action === "invite" && a.status === "invited") {
    const ok = await confirmDialog({
      title: "Make a new invite link?",
      body: `Any earlier link for ${a.email} stops working. Only the new one will let them sign up.`,
      confirmLabel: "Make new link",
    });
    if (!ok) return;
  }
  if (action === "decline") {
    const ok = await confirmDialog({
      title: `Decline ${a.name}?`,
      body: "This only marks the application declined. Nothing is emailed to them. You can move it back to new later.",
      confirmLabel: "Decline",
      kind: "danger",
    });
    if (!ok) return;
  }

  btn.disabled = true;
  try {
    const res = await fetch(`/api/admin/applications/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "That didn't work. Try again.");
    a.status = data.status;
    if (action !== "invite") openId = null;
    renderFilters();
    renderTable();

    if (data.invite?.url) {
      const out = document.getElementById("adm-app-invite");
      if (out) {
        out.hidden = false;
        out.innerHTML = `Invite link for ${esc(a.email)}, good until ${esc(day(data.invite.expiresAt))}:<br><code>${esc(data.invite.url)}</code>`;
      }
      let copied = false;
      try {
        await navigator.clipboard.writeText(data.invite.url);
        copied = true;
      } catch (_) { /* clipboard blocked; the link is shown on the page */ }
      showSuccess(copied ? "Invite link copied. Send it to them by email." : "Invite link created. Copy it from the application.");
    } else {
      showSuccess(action === "decline" ? "Marked declined." : "Moved back to new.");
    }
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
  }
}

export async function renderApplications(force = false) {
  if (loading && !force) return loading;
  const status = document.getElementById("adm-app-status");
  status.hidden = false;
  status.className = "adm-gate";
  status.textContent = "Loading…";

  loading = (async () => {
    try {
      const res = await fetch("/api/admin/applications", { headers: await authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load applications.");
      applications = data.applications || [];
      status.hidden = true;
      renderFilters();
      renderTable();
    } catch (err) {
      status.className = "adm-gate adm-gate--error";
      status.textContent = err.message;
    } finally {
      loading = null;
    }
  })();
  return loading;
}
