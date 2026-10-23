// Delivery + review panel on engagement.html.
//
// Shows each payment grassroots is holding for this engagement and where it
// is in the review cycle. The consultant marks work delivered; the business
// reviews for 14 days (release, request changes, or contact support), then
// the payment releases automatically. Retainer periods open their window at
// period end. All state comes from /api/engagement/:bid/release-status so
// the dates match the server's release job exactly.
import { showSuccess, showError } from "/toast.js";

const SUPPORT_EMAIL = "moiz@grassroots-marketplace.com";

let ctx = null; // { supabase, bidId, title }

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
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

// Status pill + one or two short lines for a payment, per viewer.
function describe(p, role) {
  const now = Date.now();
  const opens = p.review_opens_at ? Date.parse(p.review_opens_at) : null;
  const windowOpen = opens && opens <= now;
  const releaseOn = fmtDate(p.auto_release_at);

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
    return {
      pill: ["in review", "warn"],
      lines: role === "owner"
        ? [by, `review it by ${releaseOn}. after that, grassroots releases it to the consultant.`]
        : [by, `the business has until ${releaseOn} to review. then it releases to you.`],
    };
  }
  if (opens && p.review_opens_by === "period_end") {
    return {
      pill: ["period running", "muted"],
      lines: role === "owner"
        ? [`this period ends ${fmtDate(p.review_opens_at)}. you'll have 14 days after that to review.`]
        : [`this period ends ${fmtDate(p.review_opens_at)}. done early? mark it delivered to start the review now.`],
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
  if (!p.delivered_at && p.changes_requested_at && p.changes_request_note) {
    deliveryBits.push(`<p class="eg-delivery__quote">“${esc(p.changes_request_note)}”</p>`);
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

  if (p.can_mark_delivered && !p.on_hold) {
    actions.appendChild(button("mark delivered", "primary", () => openDeliverForm(p, form, actions)));
  }
  if (p.can_request_changes) {
    actions.appendChild(button("request changes", "ghost", () => openChangesForm(p, form, actions)));
  }
  if (role === "owner" && p.kind !== "proposal") {
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
