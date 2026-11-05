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

const fmtWhen = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
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
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

function supportHref(p) {
  const subject = `Question about a held payment · ${ctx.title || "engagement"}`;
  const body = `engagement: ${location.origin}/engagement.html?bid=${ctx.bidId}\npayment: ${p.label} (${fmtUsd(p.amount_cents)})\n\nwhat's going on:\n`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function daysLeft(iso) {
  return Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / DAY_MS));
}

// The consultant's 48 hours to tell support their side, per viewer.
function responseLines(p, role) {
  if (role === "owner") return p.responded_at ? ["The consultant sent support their side."] : [];
  if (p.responded_at && p.can_respond) return [`You sent support your side. You can update it until ${fmtWhen(p.response_due_at)}.`];
  if (p.responded_at) return ["You sent support your side. Support will decide and let you both know."];
  if (p.can_respond) return [`Tell support your side by ${fmtWhen(p.response_due_at)}. After that, support decides from the engagement record.`];
  if (p.response_due_at) return ["The 48 hours to respond have passed. Support will decide from the engagement record."];
  return [];
}

// Finished payments support decided, and payments mid-report.
function describeSupport(p, role) {
  const owner = role === "owner";
  const m = p.money || {};
  if (p.support_outcome === "split") {
    return {
      pill: ["Split by support", "muted"],
      lines: [owner
        ? "Support reviewed the work and split the payment between you and the consultant."
        : "Support reviewed the work and split the payment between you and the business."],
      breakdown: owner
        ? [["Refunded to you", fmtUsd(m.split_refund_cents)], ["Paid to the consultant", fmtUsd(m.split_transfer_cents)]]
        : [["Refunded to the business", fmtUsd(m.split_refund_cents)], ["Paid to you", fmtUsd(m.split_transfer_cents)]],
    };
  }
  if (p.status === "released" && p.support_outcome) {
    return {
      pill: ["Released", "accepted"],
      lines: [owner
        ? "Support found the work meets the agreed scope. Grassroots released the payment to the consultant."
        : "Support found your work meets the agreed scope. The payment was released to you."],
    };
  }
  if (p.status === "refunded" && /^give_back/.test(p.consultant_choice || "")) {
    const timedOut = p.consultant_choice === "give_back_timeout";
    return owner
      ? {
          pill: ["Refunded", "muted"],
          lines: [timedOut
            ? `The consultant didn't choose in 5 days, so you were refunded ${fmtUsd(p.refunded_cents)} in full.`
            : `The consultant gave the payment back. You were refunded ${fmtUsd(p.refunded_cents)} in full.`],
        }
      : {
          pill: ["Given back", "muted"],
          lines: [timedOut
            ? "You didn't choose in 5 days, so the payment went back to the business."
            : "You gave the payment back. The business was refunded, and you won't be paid for this payment."],
        };
  }
  if (p.status === "refunded") {
    return {
      pill: ["Refunded", "muted"],
      lines: [owner
        ? `Support found the agreed scope was breached. You were refunded ${fmtUsd(p.refunded_cents)} in full.`
        : "Support found the agreed scope was breached. The business was refunded in full, so you won't be paid for this payment."],
    };
  }
  if (p.waiting_on_consultant) {
    const left = daysLeft(p.redo_deadline_at);
    return owner
      ? {
          pill: ["Waiting on consultant", "warn"],
          lines: [`Support found the work can be fixed. The consultant has until ${fmtDate(p.redo_deadline_at)} to redo it or give the payment back.`],
        }
      : {
          pill: [`${left} day${left === 1 ? "" : "s"} left to choose`, "warn"],
          lines: [
            "Support found the work falls short but can be fixed. Redo it, or give the payment back.",
            "If you don't choose in 5 days, the payment goes back to the business.",
          ],
        };
  }
  if (p.reported) {
    const by = fmtDate(new Date(Date.parse(p.problem_reported_at) + DECIDE_DAYS * DAY_MS).toISOString());
    return owner
      ? {
          pill: ["Reported", "warn"],
          lines: [
            "You reported a problem. We're reviewing it. The payment won't release on its own.",
            `Support aims to decide by ${by}. You can still release it yourself by marking the work complete.`,
            ...responseLines(p, role),
          ],
        }
      : {
          pill: ["Reported", "warn"],
          lines: [`The business reported a problem. Support is reviewing it and aims to decide by ${by}.`, ...responseLines(p, role)],
        };
  }
  if (p.on_hold && p.status === "held") {
    return {
      pill: ["On hold", "warn"],
      lines: [
        p.hold_reason ? `Support put this payment on hold: “${p.hold_reason}”` : "Support put this payment on hold.",
        owner ? "It won't release until support decides. We'll let you both know." : "It won't release until support decides.",
        ...responseLines(p, role),
      ],
    };
  }
  return null;
}

// Free jobs ($0) have no money held, so the copy talks about the work
// being marked complete instead of a payment releasing.
function describeFree(p, role) {
  const now = Date.now();
  const opens = p.review_opens_at ? Date.parse(p.review_opens_at) : null;
  const closeOn = fmtDate(p.auto_release_at);
  if (p.kind === "proposal") {
    return {
      pill: ["Pending", "muted"],
      lines: [role === "owner"
        ? "Next, decide whether to move forward."
        : "The business decides next whether to move forward."],
    };
  }
  if (opens && opens <= now) {
    return {
      pill: ["In review", "warn"],
      lines: role === "owner"
        ? [`Marked delivered ${fmtDate(p.delivered_at)}.`, `Review it by ${closeOn}. After that, it's marked complete.`]
        : [`Marked delivered ${fmtDate(p.delivered_at)}.`, `The business has until ${closeOn} to review. Then it's marked complete.`],
    };
  }
  if (p.changes_requested_at) {
    return {
      pill: ["Changes requested", "warn"],
      lines: role === "owner"
        ? ["You asked for changes. The 14-day review restarts when the consultant marks it delivered again."]
        : ["The business asked for changes. Update the work, then mark it delivered again."],
    };
  }
  return {
    pill: ["In progress", "muted"],
    lines: role === "owner"
      ? ["Waiting for the consultant to mark the work delivered."]
      : ["Mark the work delivered when it's done."],
  };
}

// A payment released without support stepping in: the settled record.
function describeReleased(p, role) {
  const on = fmtDate(p.released_at);
  if (p.free) {
    return { pill: ["Complete", "accepted"], lines: [`Marked complete ${on}.`] };
  }
  const payout = p.money?.released_payout_cents ?? p.amount_cents;
  return {
    pill: ["Released", "accepted"],
    lines: [role === "owner"
      ? `Released ${fmtUsd(p.amount_cents)} to the consultant on ${on}.`
      : `You received ${fmtUsd(payout)} on ${on}. It's in your Stripe balance.`],
  };
}

// Status pill + one or two short lines for a payment, per viewer.
function describe(p, role) {
  if (p.status === "released" && !p.support_outcome) return describeReleased(p, role);
  if (p.free) return describeFree(p, role);
  const now = Date.now();
  const opens = p.review_opens_at ? Date.parse(p.review_opens_at) : null;
  const windowOpen = opens && opens <= now;
  const releaseOn = fmtDate(p.auto_release_at);
  const lastRedo = p.redo_used && p.consultant_choice === "redo";

  const support = describeSupport(p, role);
  if (support) return support;
  if (p.on_hold) {
    return { pill: ["On hold", "muted"], lines: ["Support is reviewing this payment. It won't release on its own until that's done."] };
  }
  if (p.partially_refunded) {
    return { pill: ["Needs support", "muted"], lines: ["Part of this payment was refunded. Support will settle the rest with you both."] };
  }
  if (Date.parse(p.backstop_at) <= now) {
    return { pill: ["With support", "muted"], lines: ["This payment has been held a long time. Support is following up with you both."] };
  }
  if (p.kind === "proposal") {
    return {
      pill: ["Held", "warn"],
      lines: [role === "owner"
        ? "This releases when you decide whether to move forward."
        : "This releases when the business decides whether to move forward."],
    };
  }
  if (windowOpen) {
    const by = p.review_opens_by === "period_end" ? `The period ended ${fmtDate(p.review_opens_at)}.` : `Marked delivered ${fmtDate(p.delivered_at)}.`;
    const lines = role === "owner"
      ? [by, `Review it by ${releaseOn}. After that, Grassroots releases it to the consultant.`]
      : [by, `The business has until ${releaseOn} to review. Then it releases to you.`];
    if (lastRedo) {
      lines.push(role === "owner"
        ? "This was the last redo. If there's still a problem, report it. Support will release it or refund you in full."
        : "This was your one redo. If the business reports a problem again, support will release it or refund them in full.");
    }
    return { pill: ["In review", "warn"], lines };
  }
  if (opens && p.review_opens_by === "period_end") {
    return {
      pill: ["Period running", "muted"],
      lines: role === "owner"
        ? [`This period ends ${fmtDate(p.review_opens_at)}. You'll have 14 days after that to review.`]
        : [`This period ends ${fmtDate(p.review_opens_at)}. Done early? Mark it delivered to start the review now.`],
    };
  }
  if (lastRedo) {
    return {
      pill: ["Redoing the work", "warn"],
      lines: role === "owner"
        ? ["The consultant is redoing the work. You'll get a new 14-day review when they deliver. This is the last redo for this payment."]
        : ["You chose to redo the work. Mark it delivered when it's ready. This is your one redo for this payment."],
    };
  }
  if (p.changes_requested_at) {
    return {
      pill: ["Changes requested", "warn"],
      lines: role === "owner"
        ? ["You asked for changes. The 14-day review restarts when the consultant marks it delivered again."]
        : ["The business asked for changes. Update the work, then mark it delivered again."],
    };
  }
  return {
    pill: ["Held", "warn"],
    lines: role === "owner"
      ? ["Grassroots is holding this until the consultant marks the work delivered."]
      : ["Grassroots is holding this for you. Mark the work delivered when it's done."],
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
    if (p.delivery_link) deliveryBits.push(`<a class="eg-delivery__link" href="${esc(p.delivery_link)}" target="_blank" rel="noopener noreferrer nofollow">Open the delivered work</a>`);
  }
  if (!p.delivered_at && p.changes_requested_at && p.changes_request_note && !p.reported) {
    deliveryBits.push(`<p class="eg-delivery__quote">“${esc(p.changes_request_note)}”</p>`);
  }
  if (p.reported && p.problem_report_note && p.status === "held") {
    deliveryBits.push(`<p class="eg-delivery__line">${role === "owner" ? "Your report" : "The business's report"}:</p>`);
    deliveryBits.push(`<p class="eg-delivery__quote">“${esc(p.problem_report_note)}”</p>`);
    if (p.problem_report_link) deliveryBits.push(`<a class="eg-delivery__link" href="${esc(p.problem_report_link)}" target="_blank" rel="noopener noreferrer nofollow">Open the business's link</a>`);
  }
  if (role === "consultant" && p.consultant_response_note) {
    deliveryBits.push(`<p class="eg-delivery__line">Your response to support:</p>`);
    deliveryBits.push(`<p class="eg-delivery__quote">“${esc(p.consultant_response_note)}”</p>`);
    if (p.consultant_response_link) deliveryBits.push(`<a class="eg-delivery__link" href="${esc(p.consultant_response_link)}" target="_blank" rel="noopener noreferrer nofollow">Open your link</a>`);
  }
  if (d.breakdown) {
    deliveryBits.push(`<dl class="eg-delivery__breakdown">${d.breakdown.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`);
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

  if (p.can_approve) {
    // Release needs a review first, so this hands off to the review form.
    actions.appendChild(button(p.free ? "Mark complete" : "Approve and release", "primary", () => {
      window.dispatchEvent(new CustomEvent("eg:approve-release", { detail: { key: p.key } }));
    }));
  }
  if (p.can_mark_delivered && !p.on_hold && p.status === "held") {
    actions.appendChild(button("Mark delivered", "primary", () => openDeliverForm(p, form, actions)));
  }
  if (p.can_respond) {
    actions.appendChild(button(p.responded_at ? "Update your response" : "Tell support your side", p.responded_at ? "ghost" : "primary", () => openResponseForm(p, form, actions)));
  }
  if (p.can_choose) {
    actions.appendChild(button("Redo the work", "primary", () => openChoiceForm(p, "redo", form, actions)));
    actions.appendChild(button("Give the payment back", "ghost", () => openChoiceForm(p, "give_back", form, actions)));
  }
  if (p.can_request_changes) {
    actions.appendChild(button("Request changes", "ghost", () => openChangesForm(p, form, actions)));
  }
  if (p.can_report_problem) {
    actions.appendChild(button("Report a problem", "ghost", () => openReportForm(p, form, actions)));
  }
  if (role === "owner" && p.kind !== "proposal" && p.status === "held" && !p.free) {
    const a = document.createElement("a");
    a.className = "gr-btn gr-btn--ghost gr-btn--sm";
    a.href = supportHref(p);
    a.textContent = "Contact support";
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
      <span>Note for the business (optional)</span>
      <textarea rows="2" maxlength="1000" data-field="note" placeholder="What you delivered, where to find it"></textarea>
    </label>
    <label class="gr-label">
      <span>Link to the work (optional)</span>
      <input type="url" maxlength="500" data-field="link" placeholder="https://" />
    </label>
    <p class="eg-delivery__line">${p.free
      ? "The business gets 14 days to review. Then it's marked complete."
      : "The business gets 14 days to review. Then Grassroots releases your payment."}</p>
  `;
  const row = document.createElement("div");
  row.className = "eg-delivery__actions";
  row.append(
    button("Cancel", "ghost", () => closeForm(form, actions)),
    button("Send for review", "primary", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const data = await post("/api/engagement/mark-delivered", {
          bid_id: ctx.bidId,
          payment_id: p.payment_id,
          note: form.querySelector("[data-field=note]").value,
          link: form.querySelector("[data-field=link]").value,
        });
        showSuccess(p.free
          ? `Sent for review. It's marked complete ${fmtDate(data.auto_release_at)} unless the business asks for changes.`
          : `Sent for review. It releases ${fmtDate(data.auto_release_at)} unless the business asks for changes.`, { duration: 5000 });
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
      <span>What needs to change?</span>
      <textarea rows="3" maxlength="1000" data-field="note" placeholder="Be specific so the consultant can fix it fast"></textarea>
    </label>
    <p class="eg-delivery__line">This pauses the automatic release. The 14-day review restarts when they deliver again.</p>
  `;
  const row = document.createElement("div");
  row.className = "eg-delivery__actions";
  row.append(
    button("Cancel", "ghost", () => closeForm(form, actions)),
    button("Send request", "primary", async (e) => {
      const note = form.querySelector("[data-field=note]").value.trim();
      if (!note) { showError("Tell the consultant what needs to change."); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await post("/api/engagement/request-changes", { bid_id: ctx.bidId, payment_id: p.payment_id, note });
        showSuccess("Request sent. We let the consultant know.");
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
      <span>What's wrong?</span>
      <textarea rows="3" maxlength="1000" data-field="note" placeholder="What doesn't match the agreed scope"></textarea>
    </label>
    <label class="gr-label">
      <span>Link <span class="gr-optional">Optional</span></span>
      <input type="url" maxlength="500" data-field="link" placeholder="https://" />
    </label>
    <p class="eg-delivery__line">This locks the payment. It won't release on its own while support reviews it. You can still release it yourself.</p>
  `;
  const row = document.createElement("div");
  row.className = "eg-delivery__actions";
  row.append(
    button("Cancel", "ghost", () => closeForm(form, actions)),
    button("Send to support", "primary", async (e) => {
      const note = form.querySelector("[data-field=note]").value.trim();
      if (!note) { showError("Tell support what's wrong."); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await post("/api/engagement/report-problem", {
          bid_id: ctx.bidId,
          payment_id: p.payment_id,
          note,
          link: form.querySelector("[data-field=link]").value,
        });
        showSuccess("Sent to support. The payment is locked while they review it.", { duration: 5000 });
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

// Consultant: tell support their side within 48 hours of the hold.
function openResponseForm(p, form, actions) {
  form.innerHTML = `
    <label class="gr-label">
      <span>What happened?</span>
      <textarea rows="4" maxlength="2000" data-field="note" placeholder="What you delivered, when, and where the business can find it"></textarea>
    </label>
    <label class="gr-label">
      <span>Link <span class="gr-optional">Optional</span></span>
      <input type="url" maxlength="500" data-field="link" placeholder="https://" />
    </label>
    <p class="eg-delivery__line">Only support sees this. The business is told you responded.</p>
  `;
  form.querySelector("[data-field=note]").value = p.consultant_response_note || "";
  form.querySelector("[data-field=link]").value = p.consultant_response_link || "";
  const row = document.createElement("div");
  row.className = "eg-delivery__actions";
  row.append(
    button("Cancel", "ghost", () => closeForm(form, actions)),
    button("Send to support", "primary", async (e) => {
      const note = form.querySelector("[data-field=note]").value.trim();
      if (!note) { showError("Tell support what happened."); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await post("/api/engagement/respond-to-report", {
          bid_id: ctx.bidId,
          payment_id: p.payment_id,
          note,
          link: form.querySelector("[data-field=link]").value,
        });
        showSuccess("Sent to support. We'll let you know what they decide.", { duration: 5000 });
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
    ? `<p class="eg-delivery__line">You can redo the work once for this payment. When you mark it delivered again, the business gets a new 14-day review.</p>`
    : `<p class="eg-delivery__line">The business gets the full ${esc(fmtUsd(m.give_back_cents))} back, and you get nothing for this payment. This can't be undone.</p>`;
  const row = document.createElement("div");
  row.className = "eg-delivery__actions";
  row.append(
    button("Cancel", "ghost", () => closeForm(form, actions)),
    button(choice === "redo" ? "Yes, redo it" : "Yes, give it back", "primary", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await post("/api/engagement/redo-choice", { bid_id: ctx.bidId, payment_id: p.payment_id, choice });
        showSuccess(choice === "redo"
          ? "Got it. Mark the work delivered when it's ready."
          : "Done. The business was refunded.", { duration: 5000 });
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
    if (!res.ok) throw new Error(data.error || "Could not load payment status.");
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
  const allFree = payments.every((p) => p.free);
  const settled = payments.every((p) => p.status !== "held");
  const heading = panel.querySelector(".eg-panel__title");
  if (heading) heading.textContent = settled ? "Payment record" : "What Grassroots is holding";
  intro.textContent = settled
    ? (allFree ? "This engagement is complete." : "Every payment on this engagement is settled.")
    : allFree
    ? (data.role === "owner"
      ? "You get 14 days to review delivered work. Then it's marked complete."
      : "The business gets 14 days to review your work. Then it's marked complete.")
    : data.role === "owner"
      ? "Grassroots holds each payment until the work is in. You get 14 days to review before it releases."
      : "Grassroots holds each payment until you deliver. The business gets 14 days to review, then it's yours.";
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
