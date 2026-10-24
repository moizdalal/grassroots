// payments.js — the admin "payments" tab. Live data (not fixtures): every
// held payment that needs a person, from /api/admin/payments/held.
//
// Support decides reported problems here (Terms §7.1):
//   A meets scope    → release to the consultant
//   B fixable        → consultant has 5 days to redo (once) or give it back
//   C scope breached → full refund, consultant gets nothing
// plus settling partly refunded payments and placing a hold. The server
// re-checks every rule; this page only offers what the server lists in
// `actions`. Every action writes an audit row, shown in the drawer.

import { getSupabaseClient } from "/supabase-loader.js";
import { showSuccess, showError } from "/toast.js";
import { confirmDialog } from "/confirm-modal.js";

const FILTERS = [
  ["all", "all", () => true],
  ["reported", "reported", (p) => p.flags.reported],
  ["waiting", "waiting on consultant", (p) => p.flags.waiting_on_consultant],
  ["hold", "on hold", (p) => p.flags.on_hold],
  ["partial", "partly refunded", (p) => p.flags.partly_refunded],
  ["backstop", "90-day backstop", (p) => p.flags.backstop],
  ["disputed", "disputed", (p) => p.flags.disputed],
  ["stale", "undecided 14+ days", (p) => p.flags.stale],
];

let payments = [];
let filter = "all";
let loading = null;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (cents) => `$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).toLowerCase() : "—");

async function authHeaders() {
  const client = await getSupabaseClient();
  const { data: { session } } = await client.auth.getSession();
  return { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) };
}

async function call(path, body) {
  const res = await fetch(path, body
    ? { method: "POST", headers: await authHeaders(), body: JSON.stringify(body) }
    : { headers: await authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "something went wrong. try again.");
  return data;
}

// One short state for the table, most urgent first.
function statePill(p) {
  const f = p.flags;
  if (f.disputed) return ["disputed", "warn"];
  if (f.stale) return ["undecided 14+ days", "warn"];
  if (f.waiting_on_consultant) return [`consultant choosing · ${day(p.redo_deadline_at)}`, "pending"];
  if (f.reported) return [p.problem_report_count > 1 ? "reported again" : "reported", "warn"];
  if (f.partly_refunded) return ["partly refunded", "warn"];
  if (f.on_hold) return ["on hold", "muted"];
  if (f.backstop) return ["held 90+ days", "warn"];
  return ["on schedule", "muted"];
}

function renderFilters() {
  const host = document.getElementById("adm-pay-filters");
  host.innerHTML = FILTERS.map(([key, label, test]) => {
    const n = payments.filter(test).length;
    return `<button type="button" class="adm-chip${key === filter ? " is-active" : ""}" data-pay-filter="${key}">${esc(label)} · ${n}</button>`;
  }).join("");
  host.querySelectorAll("[data-pay-filter]").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.payFilter;
    renderFilters();
    renderTable();
  }));
}

function renderTable() {
  const tbody = document.getElementById("adm-pay-tbody");
  const test = FILTERS.find(([key]) => key === filter)[2];
  const rows = payments.filter(test);
  document.getElementById("adm-pay-count").textContent = `${rows.length} of ${payments.length}`;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="adm-cell-sub">nothing here right now.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((p) => {
    const [label, kind] = statePill(p);
    return `
      <tr data-pay-key="${esc(p.key)}" tabindex="0">
        <td class="adm-cell-listing"><div class="adm-cell-name">${esc(p.title)}</div><div class="adm-cell-sub">${esc(p.label)} · held ${p.days_held}d</div></td>
        <td>${esc(p.owner.name || "—")}</td>
        <td>${esc(p.consultant.name || "—")}</td>
        <td class="adm-cell-money">${usd(p.amount_cents)}${p.refunded_cents ? `<div class="adm-cell-sub">${usd(p.refunded_cents)} refunded</div>` : ""}</td>
        <td>${day(p.delivered_at)}</td>
        <td><span class="adm-pill adm-pill--${kind}">${esc(label)}</span></td>
      </tr>`;
  }).join("");
  tbody.querySelectorAll("tr[data-pay-key]").forEach((tr) => {
    const open = () => openPayment(tr.dataset.payKey);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  });
}

function kv(rows) {
  return `<dl class="adm-pay-kv">${rows
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}

// What each action does, in the words support confirms.
function actionSpec(p, action) {
  const m = p.money;
  return {
    meets_scope: { label: `A · meets scope — release`, kind: "primary", title: "release to the consultant?", body: `the consultant gets ${usd(m.payout_cents)}. both sides are notified. this can't be undone.`, path: "/api/admin/payments/outcome", body2: { outcome: "meets_scope" }, note: true },
    fixable: { label: "B · fixable — consultant chooses", kind: "ghost", title: "offer a redo or give-back?", body: `the consultant has 5 days to redo the work once, or give the payment back (${usd(m.give_back_cents)} to the business, ${usd(m.card_fee_cents)} card fee kept). no answer means give back.`, path: "/api/admin/payments/outcome", body2: { outcome: "fixable" }, note: true },
    scope_breached: { label: `C · scope breached — refund in full`, kind: "danger", title: "refund the business in full?", body: `the business gets ${usd(m.full_refund_cents)} back, including the platform fee. the consultant gets nothing. grassroots absorbs the ${usd(m.card_fee_cents)} card fee.`, path: "/api/admin/payments/outcome", body2: { outcome: "scope_breached" }, note: true },
    release_remainder: { label: `release the rest — ${usd(m.remainder_payout_cents)}`, kind: "primary", title: "release the rest?", body: `${usd(m.refunded_cents)} was already refunded. the consultant gets ${usd(m.remainder_payout_cents)} of the remaining ${usd(m.remaining_cents)}.`, path: "/api/admin/payments/settle-remainder", body2: { action: "release" } },
    refund_remainder: { label: `refund the rest — ${usd(m.remaining_cents)}`, kind: "danger", title: "refund the rest?", body: `the business gets the remaining ${usd(m.remaining_cents)} back. the consultant gets nothing for this payment.`, path: "/api/admin/payments/settle-remainder", body2: { action: "refund" } },
    hold: { label: "put on hold", kind: "ghost", title: "put this payment on hold?", body: "it won't release on its own until you pick an outcome. both sides are notified.", path: "/api/admin/payments/hold", body2: {}, reason: true },
  }[action];
}

async function runAction(p, action, drawerEl) {
  const spec = actionSpec(p, action);
  const text = drawerEl.querySelector("#adm-pay-note")?.value.trim() || "";
  if (spec.reason && !text) { showError("add a short reason for the hold."); return; }
  const ok = await confirmDialog({ title: spec.title, body: spec.body, confirmLabel: "confirm", kind: spec.kind === "danger" ? "danger" : "primary" });
  if (!ok) return;
  try {
    await call(spec.path, {
      bid_id: p.bid_id,
      payment_id: p.payment_id,
      ...spec.body2,
      ...(spec.note && text ? { note: text } : {}),
      ...(spec.reason ? { reason: text } : {}),
    });
    showSuccess("done. both sides were notified.");
    await renderPayments(true);
    const fresh = payments.find((x) => x.key === p.key);
    if (fresh) openPayment(fresh.key);
    else closeDrawer();
  } catch (err) {
    showError(err.message);
  }
}

function closeDrawer() {
  const drawer = document.getElementById("adm-drawer");
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
}

async function openPayment(key) {
  const p = payments.find((x) => x.key === key);
  if (!p) return;
  const m = p.money;
  const [stateLabel, stateKind] = statePill(p);
  const drawer = document.getElementById("adm-drawer");
  const body = document.getElementById("adm-drawer-body");
  document.getElementById("adm-drawer-title").textContent = "held payment";

  const link = (href, text) => (href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(text)}</a>` : null);
  const quote = (t) => (t ? `<span class="adm-pay-quote">“${esc(t)}”</span>` : null);
  const needsNote = p.actions.some((a) => ["meets_scope", "fixable", "scope_breached", "hold"].includes(a));

  body.innerHTML = `
    <div class="adm-drawer-head">
      <div>
        <div class="adm-drawer-name">${esc(p.title)}</div>
        <div class="adm-drawer-sub">${esc(p.label)} · <span class="adm-pill adm-pill--${stateKind}">${esc(stateLabel)}</span></div>
      </div>
      <div class="adm-drawer-amount">${usd(p.amount_cents)}</div>
    </div>
    <h3 class="adm-section-h">engagement</h3>
    ${kv([
      ["business", esc(p.owner.name || p.owner.id)],
      ["consultant", esc(p.consultant.name || p.consultant.id)],
      ["engagement", link(p.engagement_link, "open the engagement page")],
      ["charged", `${day(p.paid_at)} · held ${p.days_held} days`],
      ["delivered", p.delivered_at ? day(p.delivered_at) : "not yet"],
      ["delivery note", quote(p.delivery_note)],
      ["delivered work", link(p.delivery_link, "open link")],
      ["review ends", p.review_ends_at ? day(p.review_ends_at) : null],
    ])}
    ${p.flags.on_hold || p.flags.reported ? `<h3 class="adm-section-h">report</h3>${kv([
      ["on hold since", p.support_hold_at ? when(p.support_hold_at) : null],
      ["reason", esc(p.support_hold_reason)],
      ["decide by", p.decide_by && !p.support_outcome ? `<span class="${p.flags.stale ? "adm-cell--warn" : ""}">${day(p.decide_by)}</span>` : null],
      ["business says", quote(p.problem_report_note)],
      ["business link", link(p.problem_report_link, "open link")],
      ["reports", p.problem_report_count ? String(p.problem_report_count) : null],
      ["redo", p.redo_used ? "used. only A or C now." : "not used"],
      ["consultant chooses by", p.flags.waiting_on_consultant ? when(p.redo_deadline_at) : null],
    ])}` : ""}
    ${p.dispute ? `<h3 class="adm-section-h">card dispute</h3>${kv([
      ["status", esc(p.dispute.status)],
      ["reason", esc(p.dispute.reason)],
      ["respond by", p.dispute.due_by ? day(p.dispute.due_by) : null],
      ["note", "release and refunds are blocked. respond in the stripe dashboard."],
    ])}` : ""}
    <h3 class="adm-section-h">money</h3>
    ${kv([
      ["charged", usd(m.gross_cents)],
      ["platform fee", usd(m.platform_fee_cents)],
      ["card fee (estimate)", usd(m.card_fee_cents)],
      ["refunded so far", m.refunded_cents ? usd(m.refunded_cents) : null],
      ["consultant payout", usd(m.payout_cents)],
      ["B give-back refund", p.actions.includes("fixable") ? usd(m.give_back_cents) : null],
      ["C full refund", p.actions.includes("scope_breached") ? usd(m.full_refund_cents) : null],
      ["rest to consultant", p.actions.includes("release_remainder") ? usd(m.remainder_payout_cents) : null],
      ["backstop flagged", p.backstop_flagged_at ? day(p.backstop_flagged_at) : null],
    ])}
    <h3 class="adm-section-h">decide</h3>
    ${p.actions.length ? `
      ${needsNote ? `<label class="gr-label adm-pay-note"><span>${p.actions.includes("hold") ? (p.actions.length === 1 ? "reason for the hold" : "note for the record (a hold needs one)") : "note for the record (optional)"}</span><textarea id="adm-pay-note" rows="2" maxlength="500"></textarea></label>` : ""}
      <div class="adm-pay-actions">${p.actions.map((a) => {
        const spec = actionSpec(p, a);
        return `<button type="button" class="gr-btn gr-btn--${spec.kind === "danger" ? "ghost adm-pay-danger" : spec.kind} gr-btn--sm" data-pay-action="${a}">${esc(spec.label)}</button>`;
      }).join("")}</div>`
      : `<p class="adm-cell-sub">${p.flags.waiting_on_consultant ? "waiting on the consultant. if they don't choose by the deadline, the daily job gives the payment back." : p.flags.disputed ? "nothing to do here until the dispute closes." : "no action available."}</p>`}
    <h3 class="adm-section-h">history</h3>
    <ul class="adm-pay-audit" id="adm-pay-audit"><li class="adm-cell-sub">loading…</li></ul>
  `;
  body.querySelectorAll("[data-pay-action]").forEach((b) => b.addEventListener("click", () => runAction(p, b.dataset.payAction, body)));
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");

  const list = body.querySelector("#adm-pay-audit");
  try {
    const { entries } = await call(`/api/admin/payments/audit?payment_id=${encodeURIComponent(p.payment_id || p.bid_id)}`);
    list.innerHTML = entries.length
      ? entries.map((e) => `<li><span class="adm-cell-name">${esc(e.action.replace(/_/g, " "))}</span>${e.amount_cents != null ? ` · ${usd(e.amount_cents)}` : ""}<div class="adm-cell-sub">${when(e.created_at)} · ${esc(e.actor_email || "unknown")}</div></li>`).join("")
      : `<li class="adm-cell-sub">no support actions yet.</li>`;
  } catch (err) {
    list.innerHTML = `<li class="adm-cell-sub">${esc(err.message)}</li>`;
  }
}

export async function renderPayments(force = false) {
  const status = document.getElementById("adm-pay-status");
  if (loading && !force) return loading;
  status.hidden = false;
  status.className = "adm-gate";
  status.textContent = "loading…";
  loading = call("/api/admin/payments/held")
    .then((data) => {
      payments = data.payments || [];
      status.hidden = true;
      renderFilters();
      renderTable();
      const hashKey = location.hash.slice(1).split("-hold-")[0];
      if (hashKey && payments.some((x) => x.key === hashKey)) openPayment(hashKey);
    })
    .catch((err) => {
      status.className = "adm-gate adm-gate--error";
      status.textContent = err.message;
    })
    .finally(() => { loading = null; });
  return loading;
}
