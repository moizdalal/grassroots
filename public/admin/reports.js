// reports.js — the admin "reports" tab. Live data from /api/admin/reports:
// profiles, listings and messages people reported (report-modal.js).
//
// Support reads the report, opens the thing, and marks it:
//   actioned  → we did something (talked to them, removed a listing,
//               paused an account). Say what in the note.
//   dismissed → nothing wrong, or not enough to act on.
// Nothing here changes the reported account by itself. A decided report
// can be reopened.

import { getSupabaseClient } from "/supabase-loader.js";
import { showSuccess, showError } from "/toast.js";
import { REPORT_REASONS } from "/report-modal.js";

const REASON = Object.fromEntries(REPORT_REASONS);
const TYPE = { profile: "Profile", listing: "Listing", message: "Message" };

const FILTERS = [
  ["open", "Open", (r) => r.status === "open"],
  ["repeat", "Reported 3+ times", (r) => r.status === "open" && (r.reported_user?.report_count || 0) >= 3],
  ["actioned", "Actioned", (r) => r.status === "actioned"],
  ["dismissed", "Dismissed", (r) => r.status === "dismissed"],
  ["all", "All", () => true],
];

let reports = [];
let filter = "open";
let loading = null;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

async function call(path, body) {
  const client = await getSupabaseClient();
  const { data: { session } } = await client.auth.getSession();
  const headers = { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) };
  const res = await fetch(path, body ? { method: "POST", headers, body: JSON.stringify(body) } : { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

function statePill(r) {
  if (r.status === "actioned") return ["Actioned", "muted"];
  if (r.status === "dismissed") return ["Dismissed", "muted"];
  if (daysAgo(r.created_at) >= 2) return [`Open ${daysAgo(r.created_at)}d`, "warn"];
  return ["Open", "pending"];
}

function renderFilters() {
  const host = document.getElementById("adm-rep-filters");
  host.innerHTML = FILTERS.map(([key, label, test]) =>
    `<button type="button" class="adm-chip${key === filter ? " is-active" : ""}" data-rep-filter="${key}">${esc(label)} · ${reports.filter(test).length}</button>`
  ).join("");
  host.querySelectorAll("[data-rep-filter]").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.repFilter;
    renderFilters();
    renderTable();
  }));
}

function summaryLine(r) {
  if (r.target_removed) return `<span class="adm-cell-sub">Removed since</span>`;
  const text = r.target_type === "message" ? `“${r.target_summary}”` : r.target_summary;
  return esc(text.length > 80 ? `${text.slice(0, 79)}…` : text);
}

function renderTable() {
  const tbody = document.getElementById("adm-rep-tbody");
  const test = FILTERS.find(([key]) => key === filter)[2];
  const rows = reports.filter(test);
  document.getElementById("adm-rep-count").textContent = `${rows.length} of ${reports.length}`;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="adm-cell-sub">Nothing here right now.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const [label, kind] = statePill(r);
    const count = r.reported_user?.report_count || 0;
    return `
      <tr data-rep-id="${esc(r.id)}" tabindex="0">
        <td class="adm-cell-listing"><div class="adm-cell-name">${TYPE[r.target_type]}</div><div class="adm-cell-sub">${summaryLine(r)}</div></td>
        <td>${esc(REASON[r.reason] || r.reason)}</td>
        <td>${esc(r.reported_user?.name || "—")}${count > 1 ? `<div class="adm-cell-sub${count >= 3 ? " adm-cell--warn" : ""}">${count} reports</div>` : ""}</td>
        <td>${esc(r.reporter?.name || "Deleted account")}</td>
        <td>${when(r.created_at)}</td>
        <td><span class="adm-pill adm-pill--${kind}">${esc(label)}</span></td>
      </tr>`;
  }).join("");
  tbody.querySelectorAll("tr[data-rep-id]").forEach((tr) => {
    const open = () => openReport(tr.dataset.repId);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  });
}

function kv(rows) {
  return `<dl class="adm-pay-kv">${rows
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}

function openReport(id) {
  const r = reports.find((x) => x.id === id);
  if (!r) return;
  const [stateLabel, stateKind] = statePill(r);
  const drawer = document.getElementById("adm-drawer");
  const body = document.getElementById("adm-drawer-body");
  document.getElementById("adm-drawer-title").textContent = "Report";
  const link = r.target_link
    ? `<a href="${esc(r.target_link)}" target="_blank" rel="noopener noreferrer nofollow">Open the ${r.target_type === "message" ? "listing it was about" : r.target_type}</a>`
    : null;
  const count = r.reported_user?.report_count || 0;

  body.innerHTML = `
    <div class="adm-drawer-head">
      <div>
        <div class="adm-drawer-name">${esc(REASON[r.reason] || r.reason)}</div>
        <div class="adm-drawer-sub">${TYPE[r.target_type]} · <span class="adm-pill adm-pill--${stateKind}">${esc(stateLabel)}</span></div>
      </div>
    </div>
    <h3 class="adm-section-h">What was reported</h3>
    ${kv([
      [TYPE[r.target_type], r.target_removed ? "Removed since the report" : `<span class="adm-pay-quote">${esc(r.target_type === "message" ? `“${r.target_summary}”` : r.target_summary)}</span>`],
      ["Link", link],
      ["Belongs to", r.reported_user ? `${esc(r.reported_user.name || r.reported_user.id)}${r.reported_user.role ? ` · ${r.reported_user.role === "business_owner" ? "business" : "consultant"}` : ""}` : null],
      ["Reports against them", count ? `<span class="${count >= 3 ? "adm-cell--warn" : ""}">${count}</span>` : null],
    ])}
    <h3 class="adm-section-h">From the reporter</h3>
    ${kv([
      ["Reporter", esc(r.reporter?.name || "Deleted account")],
      ["Sent", when(r.created_at)],
      ["Their words", r.details ? `<span class="adm-pay-quote">“${esc(r.details)}”</span>` : "No details given."],
    ])}
    <h3 class="adm-section-h">Decide</h3>
    ${r.status === "open" ? "" : kv([
      ["Decided", when(r.reviewed_at)],
      ["Note", r.admin_note ? `<span class="adm-pay-quote">${esc(r.admin_note)}</span>` : null],
    ])}
    <label class="gr-label adm-pay-note"><span>Note for the record${r.status === "open" ? " (say what you did)" : ""}</span><textarea id="adm-rep-note" rows="2" maxlength="1000">${r.status === "open" ? "" : esc(r.admin_note || "")}</textarea></label>
    <div class="adm-pay-actions">
      ${r.status === "open" ? `
        <button type="button" class="gr-btn gr-btn--primary gr-btn--sm" data-rep-decide="actioned">Mark actioned</button>
        <button type="button" class="gr-btn gr-btn--ghost gr-btn--sm" data-rep-decide="dismissed">Dismiss</button>
      ` : `<button type="button" class="gr-btn gr-btn--ghost gr-btn--sm" data-rep-decide="open">Reopen</button>`}
    </div>
  `;
  body.querySelectorAll("[data-rep-decide]").forEach((b) => b.addEventListener("click", async () => {
    const status = b.dataset.repDecide;
    const note = body.querySelector("#adm-rep-note").value.trim();
    if (status === "actioned" && !note) {
      showError("Add a note that says what you did.");
      body.querySelector("#adm-rep-note").focus();
      return;
    }
    b.classList.add("is-loading");
    b.disabled = true;
    try {
      await call("/api/admin/reports/decide", { id: r.id, status, note });
      showSuccess(status === "open" ? "Reopened." : status === "actioned" ? "Marked actioned." : "Dismissed.");
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
      await renderReports(true);
    } catch (err) {
      showError(err.message);
      b.classList.remove("is-loading");
      b.disabled = false;
    }
  }));
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
}

export async function renderReports(force = false) {
  const status = document.getElementById("adm-rep-status");
  if (loading && !force) return loading;
  status.hidden = false;
  status.className = "adm-gate";
  status.textContent = "Loading…";
  loading = call("/api/admin/reports")
    .then((data) => {
      reports = data.reports || [];
      status.hidden = true;
      renderFilters();
      renderTable();
    })
    .catch((err) => {
      status.className = "adm-gate adm-gate--error";
      status.textContent = err.message;
    })
    .finally(() => { loading = null; });
  return loading;
}

// The preview page feeds fixtures through this instead of the API.
export function renderReportsFrom(list) {
  reports = list;
  document.getElementById("adm-rep-status").hidden = true;
  renderFilters();
  renderTable();
}

export { openReport };
