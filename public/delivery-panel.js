// Delivery + review panel on engagement.html.
//
// Shows each payment grassroots is holding for this engagement and where it
// is in the review cycle. The consultant marks work delivered; the business
// reviews for 14 days (release, request changes, or contact support), then
// the payment releases automatically. Retainer periods open their window at
// period end. All state comes from /api/engagement/:bid/release-status so
// the dates match the server's release job exactly.
//
// Reported problems (Terms §7.1): the business can report a problem during
// the review. Support then picks an outcome: released (A); fixable (B), where
// the consultant has 5 days to redo the work once or give the payment back;
// or scope breached (C), a full refund. Finished outcomes stay on the panel.
import { showSuccess, showError } from "/toast.js";

const SUPPORT_EMAIL = "moiz@grassroots-marketplace.com";

let ctx = null; // { supabase, bidId, title }

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
const DAY_MS = 86400000;
const DECIDE_DAYS = 14;
const fmtUsd = (cents) => `$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function esc(text) {
  const d = document.createElement("div");
  d.textContent = String(text ?? "");
  return d.innerHTML;
}

async function authHeaders() {
  const { data: { session } } = await ctx.supabase.auth.getSession();
  const headers = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: await authHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "something went wrong. try again.");
  return data;
}

function supportHref(p) {
  const subject = `question about a held payment · ${ctx.title || "engagement"}`;
  const body = `engagement: ${location.origin}/engagement.html?bid=${ctx.bidId}\npayment: ${p.label} (${fmtUsd(p.amount_cents)})\n\nwhat's going on:\n`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function daysLeft(iso) {
  return Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / DAY_MS));
}

// Finished payments support decided, and payments mid-report.
function describeSupport(p, role) {
  const owner = role === "owner";
  const m = p.money || {};
  if (p.status === "released") {
    return {
      pill: ["released", "accepted"],
      lines: [owner
        ? "support found the work meets the agreed scope. grassroots released the payment to the consultant."
        : "support found your work meets the agreed scope. the payment was released to you."],
    };
  }
  if (p.status === "refunded" && /^give_back/.test(p.consultant_choice || "")) {
    const timedOut = p.consultant_choice === "give_back_timeout";
    return owner
      ? {
          pill: ["refunded", "muted"],
          lines: [timedOut
            ? `the consultant didn't choose in 5 days, so you were refunded ${fmtUsd(p.refunded_cents)}.`
            : `the consultant gave the payment back. you were refunded ${fmtUsd(p.refunded_cents)}.`],
          breakdown: [
            ["payment", fmtUsd(m.gross_cents)],
            ["card processing fee kept", `−${fmtUsd(m.card_fee_cents)}`],
            ["refunded to your card", fmtUsd(p.refunded_cents)],
          ],
          feeNote: m.card_fee_note,
        }
      : {
          pill: ["given back", "muted"],
          lines: [timedOut
            ? "you didn't choose in 5 days, so the payment went back to the business."
            : "you gave the payment back. the business was refunded, and you won't be paid for this payment."],
        };
  }
  if (p.status === "refunded") {
    return {
      pill: ["refunded", "muted"],
      lines: [owner
        ? `support found the agreed scope was breached. you were refunded ${fmtUsd(p.refunded_cents)} in full.`
        : "support found the agreed scope was breached. the business was refunded in full, so you won't be paid for this payment."],
    };
  }
  if (p.waiting_on_consultant) {
    const left = daysLeft(p.redo_deadline_at);
    return owner
      ? {
          pill: ["waiting on consultant", "warn"],
          lines: [`support found the work can be fixed. the consultant has until ${fmtDate(p.redo_deadline_at)} to redo it or give the payment back.`],
        }
      : {
          pill: [`${left} day${left === 1 ? "" : "s"} left to choose`, "warn"],
          lines: [
            "support found the work falls short but can be fixed. redo it, or give the payment back.",
            "if you don't choose in 5 days, the payment goes back to the business.",
          ],
        };
  }
  if (p.reported) {
    const by = fmtDate(new Date(Date.parse(p.problem_reported_at) + DECIDE_DAYS * DAY_MS).toISOString());
    return owner
      ? {
          pill: ["reported", "warn"],
          lines: [
            "you reported a problem. we're reviewing it. the payment won't release on its own.",
            `support aims to decide by ${by}. you can still release it yourself by marking the work complete.`,
          ],
        }
      : {
          pill: ["reported", "warn"],
          lines: [`the business reported a problem. support is reviewing it and aims to decide by ${by}.`],
        };
  }
  return null;
}

// Status pill + one or two short lines for a payment, per viewer.
function describe(p, role) {
  const now = Date.now();
  const opens = p.review_opens_at ? Date.parse(p.review_opens_at) : null;
  const windowOpen = opens && opens <= now;
  const releaseOn = fmtDate(p.auto_release_at);
  const lastRedo = p.redo_used && p.consultant_choice === "redo";

  const support = describeSupport(p, role);
  if (support) return support;
  if (p.on_hold) {
    return { pill: ["on hold", "muted"], lines: ["support is reviewing this payment. it won't release on its own until that's done."] };
  }
  if (p.partially_refunded) {
    return { pill: ["needs support", "muted"], lines: ["part of this payment was refunded. support will settle the rest with you both."] };
  }
  if (Date.parse(p.backstop_at) <= now) {
    return { pill: ["with support", "muted"], lines: ["this payment has been held a long time. support is following up with you both."] };
  }
  if (p.kind === "proposal") {
    return {
      pill: ["held", "warn"],
      lines: [role === "owner"
        ? "this releases when you decide whether to move forward."
        : "this releases when the business decides whether to move forward."],
    };
  }
  if (windowOpen) {
    const by = p.review_opens_by === "period_end" ? `the period ended ${fmtDate(p.review_opens_at)}.` : `marked delivered ${fmtDate(p.delivered_at)}.`;
    const lines = role === "owner"
      ? [by, `review it by ${releaseOn}. after that, grassroots releases it to the consultant.`]
      : [by, `the business has until ${releaseOn} to review. then it releases to you.`];
    if (lastRedo) {
      lines.push(role === "owner"
        ? "this was the last redo. if there's still a problem, report it. support will release it or refund you in full."
        : "this was your one redo. if the business reports a problem again, support will release it or refund them in full.");
    }
    return { pill: ["in review", "warn"], lines };
  }
  if (opens && p.review_opens_by === "period_end") {
    return {
      pill: ["period running", "muted"],
      lines: role === "owner"
        ? [`this period ends ${fmtDate(p.review_opens_at)}. you'll have 14 days after that to review.`]
        : [`this period ends ${fmtDate(p.review_opens_at)}. done early? mark it delivered to start the review now.`],
    };
  }
  if (lastRedo) {
    return {
      pill: ["redoing the work", "warn"],
      lines: role === "owner"
        ? ["the consultant is redoing the work. you'll get a new 14-day review when they deliver. this is the last redo for this payment."]
        : ["you chose to redo the work. mark it delivered when it's ready. this is your one redo for this payment."],
    };
  }
  if (p.changes_requested_at) {
    return {
      pill: ["changes requested", "warn"],
      lines: role === "owner"
        ? ["you asked for changes. the 14-day review restarts when the consultant marks it delivered again."]
        : ["the business asked for changes. update the work, then mark it delivered again."],
    };
  }
  return {
    pill: ["held", "warn"],
    lines: role === "owner"
      ? ["grassroots is holding this until the consultant marks the work delivered."]
      : ["grassroots is holding this for you. mark the work delivered when it's done."],
  };
}

function renderItem(p, role) {
  const li = document.createElement("li");
  li.className = "eg-period eg-delivery";
  li.id = p.key;
  const d = describe(p, role);
  const deliveryBits = [];
  if (p.delivered_at && (p.delivery_note || p.delivery_link)) {
    if (p.delivery_note) deliveryBits.push(`<p class="eg-delivery__quote">“${esc(p.delivery_note)}”</p>`);
    if (p.delivery_link) deliveryBits.push(`<a class="eg-delivery__link" href="${esc(p.delivery_link)}" target="_blank" rel="noopener noreferrer nofollow">open the delivered work</a>`);
  }
  if (!p.delivered_at && p.changes_requested_at && p.changes_request_note && !p.reported) {
    deliveryBits.push(`<p class="eg-delivery__quote">“${esc(p.changes_request_note)}”</p>`);
  }
  if (p.reported && p.problem_report_note && p.status === "held") {
    deliveryBits.push(`<p class="eg-delivery__line">${role === "owner" ? "your report" : "the business's report"}:</p>`);
    deliveryBits.push(`<p class="eg-delivery__quote">“${esc(p.problem_report_note)}”</p>`);
    if (p.problem_report_link) deliveryBits.push(`<a class="eg-delivery__link" href="${esc(p.problem_report_link)}" target="_blank" rel="noopener noreferrer nofollow">open the business's link</a>`);
  }
  if (d.breakdown) {
    deliveryBits.push(`<dl class="eg-delivery__breakdown">${d.breakdown.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`);
    if (d.feeNote) deliveryBits.push(`<p class="eg-delivery__line">${esc(d.feeNote)}</p>`);
  }
  li.innerHTML = `
    <div class="eg-period__head">
      <span class="eg-period__label">${esc(p.label)}</span>
      <span class="gr-pill gr-pill--${d.pill[1]} gr-pill--no-dot">${esc(d.pill[0])}</span>
    </div>
    <div class="eg-period__row">
      <span class="eg-period__amount">${fmtUsd(p.amount_cents)}</span>
    </div>
    ${d.lines.map((l) => `<p class="eg-delivery__line">${esc(l)}</p>`).join("")}
    ${deliveryBits.join("")}
    <div class="eg-delivery__actions"></div>
    <div class="eg-delivery__form hidden"></div>
  `;
  const actions = li.querySelector(".eg-delivery__actions");
  const form = li.querySelector(".eg-delivery__form");

  if (p.can_mark_delivered && !p.on_hold && p.status === "held") {
    actions.appendChild(button("mark delivered", "primary", () => openDeliverForm(p, form, actions)));
  }
  if (p.can_choose) {
    actions.appendChild(button("redo the work", "primary", () => openChoiceForm(p, "redo", form, actions)));
    actions.appendChild(button("give the payment back", "ghost", () => openChoiceForm(p, "give_back", form, actions)));
  }
  if (p.can_request_changes) {
    actions.appendChild(button("request changes", "ghost", () => openChangesForm(p, form, actions)));
  }
  if (p.can_report_problem) {
    actions.appendChild(button("report a problem", "ghost", () => openReportForm(p, form, actions)));
  }
  if (role === "owner" && p.kind !== "proposal" && p.status === "held") {
    const a = document.createElement("a");
    a.className = "gr-btn gr-btn--ghost gr-btn--sm";
    a.href = supportHref(p);
    a.textContent = "contact support";
    actions.appendChild(a);
  }
  if (!actions.children.length) actions.remove();
  return li;
}

function button(label, kind, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `gr-btn gr-btn--${kind} gr-btn--sm`;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function openDeliverForm(p, form, actions) {
  form.innerHTML = `
    <label class="gr-label">
      <span>note for the business (optional)</span>
      <textarea rows="2" maxlength="1000" data-field="note" placeholder="what you delivered, where to find it"></textarea>
    </label>
    <label class="gr-label">
      <span>link to the work (optional)</span>
      <input type="url" maxlength="500" data-field="link" placeholder="https://" />
    </label>
    <p class="eg-delivery__line">the business gets 14 days to review. then grassroots releases your payment.</p>
  `;
  const row = document.createElement("div");
  row.className = "eg-delivery__actions";
  row.append(
    button("cancel", "ghost", () => closeForm(form, actions)),
    button("send for review", "primary", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const data = await post("/api/engagement/mark-delivered", {
          bid_id: ctx.bidId,
          payment_id: p.payment_id,
          note: form.querySelector("[data-field=note]").value,
          link: form.querySelector("[data-field=link]").value,
        });
        showSuccess(`sent for review. it releases ${fmtDate(data.auto_release_at)} unless the business asks for changes.`, { duration: 5000 });
        await refreshDeliveryPanel();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
      }
    }),
  );
  form.appendChild(row);
  form.classList.remove("hidden");
  actions.classList.add("hidden");
  form.querySelector("textarea").focus();
}

function openChangesForm(p, form, actions) {
  form.innerHTML = `
    <label class="gr-label">
      <span>what needs to change?</span>
      <textarea rows="3" maxlength="1000" data-field="note" placeholder="be specific so the consultant can fix it fast"></textarea>
    </label>
    <p class="eg-delivery__line">this pauses the automatic release. the 14-day review restarts when they deliver again.</p>
  `;
  const row = document.createElement("div");
  row.className = "eg-delivery__actions";
  row.append(
    button("cancel", "ghost", () => closeForm(form, actions)),
    button("send request", "primary", async (e) => {
      const note = form.querySelector("[data-field=note]").value.trim();
      if (!note) { showError("tell the consultant what needs to change."); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await post("/api/engagement/request-changes", { bid_id: ctx.bidId, payment_id: p.payment_id, note });
        showSuccess("request sent. we let the consultant know.");
        await refreshDeliveryPanel();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
      }
    }),
  );
  form.appendChild(row);
  form.classList.remove("hidden");
  actions.classList.add("hidden");
  form.querySelector("textarea").focus();
}

// Business: report a problem. Locks the payment until support decides.
function openReportForm(p, form, actions) {
  form.innerHTML = `
    <label class="gr-label">
      <span>what's wrong?</span>
      <textarea rows="3" maxlength="1000" data-field="note" placeholder="what doesn't match the agreed scope"></textarea>
    </label>
    <label class="gr-label">
      <span>link <span class="gr-optional">optional</span></span>
      <input type="url" maxlength="500" data-field="link" placeholder="https://" />
    </label>
    <p class="eg-delivery__line">this locks the payment. it won't release on its own while support reviews it. you can still release it yourself.</p>
  `;
  const row = document.createElement("div");
  row.className = "eg-delivery__actions";
  row.append(
    button("cancel", "ghost", () => closeForm(form, actions)),
    button("send to support", "primary", async (e) => {
      const note = form.querySelector("[data-field=note]").value.trim();
      if (!note) { showError("tell support what's wrong."); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await post("/api/engagement/report-problem", {
          bid_id: ctx.bidId,
          payment_id: p.payment_id,
          note,
          link: form.querySelector("[data-field=link]").value,
        });
        showSuccess("sent to support. the payment is locked while they review it.", { duration: 5000 });
        await refreshDeliveryPanel();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
      }
    }),
  );
  form.appendChild(row);
  form.classList.remove("hidden");
  actions.classList.add("hidden");
  form.querySelector("textarea").focus();
}

// Consultant, after support's "fixable" outcome: confirm redo or give back.
function openChoiceForm(p, choice, form, actions) {
  const m = p.money || {};
  form.innerHTML = choice === "redo"
    ? `<p class="eg-delivery__line">you can redo the work once for this payment. when you mark it delivered again, the business gets a new 14-day review.</p>`
    : `<p class="eg-delivery__line">the business gets ${esc(fmtUsd(m.give_back_cents))} back (the payment minus the ${esc(fmtUsd(m.card_fee_cents))} card fee), and you get nothing for this payment. this can't be undone.</p>${m.card_fee_note ? `<p class="eg-delivery__line">${esc(m.card_fee_note)}</p>` : ""}`;
  const row = document.createElement("div");
  row.className = "eg-delivery__actions";
  row.append(
    button("cancel", "ghost", () => closeForm(form, actions)),
    button(choice === "redo" ? "yes, redo it" : "yes, give it back", "primary", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await post("/api/engagement/redo-choice", { bid_id: ctx.bidId, payment_id: p.payment_id, choice });
        showSuccess(choice === "redo"
          ? "got it. mark the work delivered when it's ready."
          : "done. the business was refunded.", { duration: 5000 });
        await refreshDeliveryPanel();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
      }
    }),
  );
  form.appendChild(row);
  form.classList.remove("hidden");
  actions.classList.add("hidden");
}

function closeForm(form, actions) {
  form.innerHTML = "";
  form.classList.add("hidden");
  actions.classList.remove("hidden");
}

export async function refreshDeliveryPanel() {
  const panel = document.getElementById("eg-delivery-panel");
  const list = document.getElementById("eg-delivery-list");
  const intro = document.getElementById("eg-delivery-intro");
  if (!panel || !list || !ctx) return;
  let data;
  try {
    const res = await fetch(`/api/engagement/${encodeURIComponent(ctx.bidId)}/release-status`, { headers: await authHeaders() });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "could not load payment status.");
  } catch (err) {
    console.warn("delivery panel:", err.message);
    panel.classList.add("hidden");
    return;
  }
  const payments = data.payments || [];
  if (!payments.length) {
    panel.classList.add("hidden");
    return;
  }
  intro.textContent = data.role === "owner"
    ? "grassroots holds each payment until the work is in. you get 14 days to review before it releases."
    : "grassroots holds each payment until you deliver. the business gets 14 days to review, then it's yours.";
  list.innerHTML = "";
  for (const p of payments) list.appendChild(renderItem(p, data.role));
  panel.classList.remove("hidden");
  if (location.hash && document.getElementById(location.hash.slice(1))) {
    document.getElementById(location.hash.slice(1)).scrollIntoView({ block: "center" });
  }
}

export async function mountDeliveryPanel({ supabase, bidId, title }) {
  ctx = { supabase, bidId, title };
  window.addEventListener("eg:payments-changed", () => refreshDeliveryPanel());
  await refreshDeliveryPanel();
}
