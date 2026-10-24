/* ================================================================
   Owner-side payment modal — opens when a business accepts a bid.
   Creates a PaymentIntent server-side, mounts Stripe Payment Element,
   confirms the payment, then asks the server to flip the bid to
   `accepted` only after Stripe reports success.
   Sandbox/test-mode only.
   ================================================================ */

import { computeFees, formatUsd } from "/fees.js";
import { confirmDialog } from "/confirm-modal.js";
import { showError } from "/toast.js";

let stripePromise;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderFeeBreakdown(fees) {
  // All-in pricing: the business pays the offer and nothing on top. The
  // platform and card fees come out of the consultant's side, so no fee
  // lines here.
  return `
    <div class="pay-modal__breakdown" role="group" aria-label="Payment breakdown">
      <div class="pay-modal__line pay-modal__line--total">
        <span class="pay-modal__line-label">
          You'll be charged
          <span class="pay-modal__line-hint">No fees added</span>
        </span>
        <span class="pay-modal__line-value">${escapeHtml(formatUsd(fees.businessTotalCents))}</span>
      </div>
    </div>
  `;
}

// $0 offers skip Stripe entirely: confirm, then hit the free endpoint.
async function acceptWithoutPayment({ client, endpoint, payload, title, body, confirmLabel }) {
  const ok = await confirmDialog({ title, body, confirmLabel });
  if (!ok) return { ok: false, reason: "cancelled" };
  const { data: { session } } = await client.auth.getSession();
  const headers = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showError(data.error || "Could not accept the offer.");
    return { ok: false, reason: "error" };
  }
  return { ok: true, free: true };
}

// Injects https://js.stripe.com/v3/ once and resolves when window.Stripe
// is available. Idempotent — repeated calls share the same script tag.
function ensureStripeScript() {
  if (window.Stripe) return Promise.resolve();
  if (window.__grStripeScriptPromise) return window.__grStripeScriptPromise;
  window.__grStripeScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src^="https://js.stripe.com/v3/"]');
    if (existing) {
      if (window.Stripe) return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("stripe.js failed to load.")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("stripe.js failed to load."));
    document.head.appendChild(s);
  });
  return window.__grStripeScriptPromise;
}

async function loadStripe() {
  if (stripePromise) return stripePromise;
  stripePromise = (async () => {
    // Kick off the script load and config fetch in parallel; both must
    // succeed before we can instantiate the client.
    const [, cfg] = await Promise.all([
      ensureStripeScript(),
      fetch("/api/public-config").then((r) => r.json()),
    ]);
    if (!cfg.stripePublishableKey) {
      throw new Error("Payments aren't configured on the server.");
    }
    if (!window.Stripe) {
      throw new Error("stripe.js failed to load.");
    }
    return window.Stripe(cfg.stripePublishableKey);
  })();
  return stripePromise;
}

function buildModal({ amount, title, feeBreakdown }) {
  const overlay = document.createElement("div");
  overlay.className = "pay-overlay is-open";
  // Standard escrow flow passes a fee breakdown so the business sees
  // exactly what the consultant absorbs. Phased / retainer callers
  // currently pass just `amount` and fall back to the bare summary
  // until pass 2/3 wires their endpoints through the fee math.
  const amountBlock = feeBreakdown
    ? renderFeeBreakdown(feeBreakdown)
    : `
        <div class="pay-modal__amount">
          <span>Amount</span>
          <strong>${escapeHtml(formatUsd(amount))}</strong>
        </div>
      `;
  overlay.innerHTML = `
    <div class="pay-overlay__backdrop" data-pay-close></div>
    <div class="pay-modal" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <header class="pay-modal__head">
        <div>
          <p class="pay-modal__eyebrow">Accept &amp; pay · sandbox</p>
          <h2 id="pay-title" class="pay-modal__title">${escapeHtml(title || "engagement")}</h2>
        </div>
        <button type="button" class="pay-modal__close" data-pay-close aria-label="Close">&times;</button>
      </header>
      <p class="pay-modal__intro">
        Grassroots <strong>holds your payment</strong> until you mark the work complete and submit your review. Your card is saved for payments you approve later. See the <a href="/terms.html#refunds" target="_blank" rel="noopener">refund policy</a>. Test card: <code>4242 4242 4242 4242</code>, any future date, any CVC.
      </p>
      ${amountBlock}
      <div id="pay-element" class="pay-modal__element"></div>
      <p id="pay-status" class="gr-status" aria-live="polite"></p>
      <div class="pay-modal__actions">
        <button type="button" class="gr-btn gr-btn--ghost" data-pay-close>Cancel</button>
        <button type="button" class="gr-btn gr-btn--primary" id="pay-submit" disabled>Pay &amp; accept</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add("gr-modal-open");
  return overlay;
}

function closeModal(overlay) {
  overlay.remove();
  document.body.classList.remove("gr-modal-open");
}

/**
 * Walk an owner through the payment flow for accepting a bid.
 * Resolves with `{ ok: true }` only after Stripe captures + the server
 * flips the bid status to `accepted`. Resolves with `{ ok: false, ... }`
 * if the user cancels or payment fails.
 *
 * @param {object} params
 *   client: Supabase client (used to grab the current session for auth).
 *   bid: { id, amount_cents, counter_offer_cents, consultant_id }
 *   listing: { id, title }
 */
export async function payAndAcceptBid({ client, bid, listing }) {
  const amount = bid.counter_offer_cents != null ? bid.counter_offer_cents : bid.amount_cents;
  if (Number(amount) === 0) {
    return acceptWithoutPayment({
      client,
      endpoint: "/api/engagement/accept-free",
      payload: { bid_id: bid.id },
      title: "Accept this offer?",
      body: "This offer is $0, so there's no payment step. You'll go straight to kickoff.",
      confirmLabel: "Accept offer",
    });
  }
  const feeBreakdown = computeFees(amount);
  const overlay = buildModal({ amount, title: listing?.title, feeBreakdown });
  const submitBtn = overlay.querySelector("#pay-submit");
  const statusEl = overlay.querySelector("#pay-status");
  const elementHost = overlay.querySelector("#pay-element");

  return new Promise((resolve) => {
    let cleanedUp = false;
    function cleanup(result) {
      if (cleanedUp) return;
      cleanedUp = true;
      closeModal(overlay);
      resolve(result);
    }

    overlay.querySelectorAll("[data-pay-close]").forEach((el) => {
      el.addEventListener("click", () => cleanup({ ok: false, reason: "cancelled" }));
    });

    (async () => {
      try {
        const { data: { session } } = await client.auth.getSession();
        const headers = { "Content-Type": "application/json" };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

        const intentRes = await fetch("/api/stripe/payment-intent", {
          method: "POST",
          headers,
          body: JSON.stringify({ bid_id: bid.id }),
        });
        const intentData = await intentRes.json();
        if (!intentRes.ok) throw new Error(intentData.error || "Could not start payment.");

        const stripe = await loadStripe();
        const css = getComputedStyle(document.documentElement);
        const v = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
        // Detect light/dark to pick the matching base theme.
        const surface2 = v("--fo-surface-2", "#f6f3ea");
        const surface = v("--fo-surface", "#ffffff");
        const text = v("--fo-text", "#0f1f1a");
        const textMuted = v("--fo-text-3", "#7d8b85");
        const accent = v("--fo-accent", "#2d6a4f");
        const line = v("--fo-line", "rgba(20,32,26,0.16)");
        const isDarkMode = (() => {
          const m = surface.match(/^#?([0-9a-f]{6})$/i) || surface.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
          if (!m) return false;
          const r = m[1] && /^[0-9a-f]+$/i.test(m[1]) ? parseInt(m[1].slice(0, 2), 16) : Number(m[1]);
          const g = m[1] && /^[0-9a-f]+$/i.test(m[1]) ? parseInt(m[1].slice(2, 4), 16) : Number(m[2]);
          const b = m[1] && /^[0-9a-f]+$/i.test(m[1]) ? parseInt(m[1].slice(4, 6), 16) : Number(m[3]);
          return (r * 299 + g * 587 + b * 114) / 1000 < 128;
        })();

        const elements = stripe.elements({
          clientSecret: intentData.client_secret,
          appearance: {
            theme: isDarkMode ? "night" : "stripe",
            variables: {
              colorPrimary: accent,
              colorBackground: surface2,
              colorText: text,
              colorTextSecondary: textMuted,
              colorTextPlaceholder: textMuted,
              colorDanger: "#d4715a",
              fontFamily: "Figtree, system-ui, sans-serif",
              fontSizeBase: "0.92rem",
              fontSizeSm: "0.8rem",
              borderRadius: "10px",
              spacingUnit: "4px",
            },
            rules: {
              ".Label": {
                fontSize: "0.8rem",
                fontWeight: "600",
                color: text,
                marginBottom: "0.4rem",
              },
              ".Input": {
                border: `1px solid ${line}`,
                padding: "0.6rem 0.75rem",
                boxShadow: "none",
              },
              ".Input:focus": {
                borderColor: accent,
                boxShadow: `0 0 0 3px ${accent}33`,
              },
              ".Input::placeholder": {
                color: textMuted,
              },
              ".Tab": {
                border: `1px solid ${line}`,
                padding: "0.55rem 0.75rem",
                backgroundColor: surface2,
                color: text,
              },
              ".Tab:hover": {
                color: text,
                borderColor: line,
              },
              ".Tab--selected": {
                borderColor: accent,
                backgroundColor: surface2,
                color: text,
              },
              ".Tab--selected:focus": {
                borderColor: accent,
                color: text,
                boxShadow: `0 0 0 3px ${accent}33`,
              },
              ".TabLabel": {
                color: text,
              },
              ".TabLabel--selected": {
                color: text,
                fontWeight: "600",
              },
              ".TabIcon--selected": {
                color: accent,
                fill: accent,
              },
            },
          },
        });
        const paymentElement = elements.create("payment");
        paymentElement.mount(elementHost);
        paymentElement.on("ready", () => { submitBtn.disabled = false; });

        submitBtn.addEventListener("click", async () => {
          submitBtn.disabled = true;
          statusEl.textContent = "Processing payment…";
          statusEl.className = "gr-status";

          const { error: confirmErr } = await stripe.confirmPayment({
            elements,
            redirect: "if_required",
          });
          if (confirmErr) {
            statusEl.textContent = confirmErr.message || "Payment failed.";
            statusEl.className = "gr-status error";
            submitBtn.disabled = false;
            return;
          }

          // Server-side validation + bid flip.
          const confirmRes = await fetch("/api/stripe/confirm-acceptance", {
            method: "POST",
            headers,
            body: JSON.stringify({ bid_id: bid.id }),
          });
          const confirmData = await confirmRes.json();
          if (!confirmRes.ok) {
            statusEl.textContent = confirmData.error || "Payment captured but server failed to confirm. Contact support.";
            statusEl.className = "gr-status error";
            submitBtn.disabled = false;
            return;
          }

          statusEl.textContent = "Payment held. Redirecting to engagement…";
          statusEl.className = "gr-status success";
          setTimeout(() => cleanup({ ok: true }), 700);
        });
      } catch (err) {
        statusEl.textContent = err.message || "Something went wrong.";
        statusEl.className = "gr-status error";
      }
    })();
  });
}

/**
 * Phased contracts: accept proposal fees for one or more bids in a single
 * charge. Mirrors payAndAcceptBid but hits the /phased/* endpoints and
 * confirms via payment_intent_id instead of bid_id.
 *
 * @param {object} params
 *   client: Supabase client.
 *   bids:   Array<{ id, proposal_fee_cents, consultant_name? }>
 *   listing: { id, title }
 */
export async function payAndAcceptProposals({ client, bids, listing }) {
  const totalAmount = bids.reduce((sum, b) => sum + Number(b.proposal_fee_cents || 0), 0);
  if (totalAmount === 0) {
    return acceptWithoutPayment({
      client,
      endpoint: "/api/stripe/phased/accept-proposals",
      payload: { bid_ids: bids.map((b) => b.id) },
      title: bids.length === 1 ? "Accept this proposal?" : `Accept ${bids.length} proposals?`,
      body: "The proposal fee is $0, so there's no payment step.",
      confirmLabel: bids.length === 1 ? "Accept proposal" : "Accept proposals",
    });
  }
  const titleLabel = bids.length === 1
    ? `Proposal fee · ${listing?.title || "engagement"}`
    : `${bids.length} proposal fees · ${listing?.title || "engagement"}`;
  // Show the aggregate breakdown (sum of all proposal offers + their
  // platform fees) so the business sees the total markup as one row.
  const feeBreakdown = computeFees(totalAmount);
  const overlay = buildModal({ amount: totalAmount, title: titleLabel, feeBreakdown });
  const submitBtn = overlay.querySelector("#pay-submit");
  const statusEl = overlay.querySelector("#pay-status");
  const elementHost = overlay.querySelector("#pay-element");

  // Reframe the intro copy for the proposal phase.
  const intro = overlay.querySelector(".pay-modal__intro");
  if (intro) {
    intro.innerHTML = `Grassroots <strong>holds proposal fees</strong> as soon as you pay. Consultants are paid out only after they deliver their proposal and you mark it accepted. Test card: <code>4242 4242 4242 4242</code>.`;
  }
  submitBtn.textContent = bids.length === 1 ? "Pay proposal fee" : `Pay ${bids.length} proposal fees`;

  return new Promise((resolve) => {
    let cleanedUp = false;
    function cleanup(result) {
      if (cleanedUp) return;
      cleanedUp = true;
      closeModal(overlay);
      resolve(result);
    }

    overlay.querySelectorAll("[data-pay-close]").forEach((el) => {
      el.addEventListener("click", () => cleanup({ ok: false, reason: "cancelled" }));
    });

    (async () => {
      try {
        const { data: { session } } = await client.auth.getSession();
        const headers = { "Content-Type": "application/json" };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

        const intentRes = await fetch("/api/stripe/phased/accept-proposals", {
          method: "POST",
          headers,
          body: JSON.stringify({ bid_ids: bids.map((b) => b.id) }),
        });
        const intentData = await intentRes.json();
        if (!intentRes.ok) throw new Error(intentData.error || "Could not start payment.");

        const stripe = await loadStripe();
        const css = getComputedStyle(document.documentElement);
        const v = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
        const surface2 = v("--fo-surface-2", "#f6f3ea");
        const surface = v("--fo-surface", "#ffffff");
        const text = v("--fo-text", "#0f1f1a");
        const textMuted = v("--fo-text-3", "#7d8b85");
        const accent = v("--fo-accent", "#2d6a4f");
        const line = v("--fo-line", "rgba(20,32,26,0.16)");
        const isDarkMode = (() => {
          const m = surface.match(/^#?([0-9a-f]{6})$/i);
          if (!m) return false;
          const r = parseInt(m[1].slice(0, 2), 16);
          const g = parseInt(m[1].slice(2, 4), 16);
          const b = parseInt(m[1].slice(4, 6), 16);
          return (r * 299 + g * 587 + b * 114) / 1000 < 128;
        })();

        const elements = stripe.elements({
          clientSecret: intentData.client_secret,
          appearance: {
            theme: isDarkMode ? "night" : "stripe",
            variables: {
              colorPrimary: accent,
              colorBackground: surface2,
              colorText: text,
              colorTextSecondary: textMuted,
              colorTextPlaceholder: textMuted,
              colorDanger: "#d4715a",
              fontFamily: "Figtree, system-ui, sans-serif",
              fontSizeBase: "0.92rem",
              fontSizeSm: "0.8rem",
              borderRadius: "10px",
              spacingUnit: "4px",
            },
          },
        });
        const paymentElement = elements.create("payment");
        paymentElement.mount(elementHost);
        paymentElement.on("ready", () => { submitBtn.disabled = false; });

        submitBtn.addEventListener("click", async () => {
          submitBtn.disabled = true;
          statusEl.textContent = "Processing payment…";
          statusEl.className = "gr-status";

          const { error: confirmErr } = await stripe.confirmPayment({
            elements,
            redirect: "if_required",
          });
          if (confirmErr) {
            statusEl.textContent = confirmErr.message || "Payment failed.";
            statusEl.className = "gr-status error";
            submitBtn.disabled = false;
            return;
          }

          const confirmRes = await fetch("/api/stripe/phased/confirm-proposals", {
            method: "POST",
            headers,
            body: JSON.stringify({ payment_intent_id: intentData.payment_intent_id }),
          });
          const confirmData = await confirmRes.json();
          if (!confirmRes.ok) {
            statusEl.textContent = confirmData.error || "Payment captured but server failed to confirm. Contact support.";
            statusEl.className = "gr-status error";
            submitBtn.disabled = false;
            return;
          }

          statusEl.textContent = "Proposal fees held. Reloading…";
          statusEl.className = "gr-status success";
          setTimeout(() => cleanup({ ok: true, bid_ids: confirmData.bid_ids }), 700);
        });
      } catch (err) {
        statusEl.textContent = err.message || "Something went wrong.";
        statusEl.className = "gr-status error";
      }
    })();
  });
}

/**
 * Phased contracts: pay the service fee for a single bid after the owner
 * decided to move forward with that consultant. Single PI into platform
 * escrow; released later when the owner submits their review.
 */
export async function payAndStartService({ client, bid, listing }) {
  const amount = Number(bid.service_fee_cents);
  const feeBreakdown = computeFees(amount);
  const overlay = buildModal({
    amount,
    title: `Service fee · ${listing?.title || "engagement"}`,
    feeBreakdown,
  });
  const submitBtn = overlay.querySelector("#pay-submit");
  const statusEl = overlay.querySelector("#pay-status");
  const elementHost = overlay.querySelector("#pay-element");

  const intro = overlay.querySelector(".pay-modal__intro");
  if (intro) {
    intro.innerHTML = `Grassroots <strong>holds the service fee</strong> as soon as you pay. It releases to the consultant once you mark the work complete and submit your review. Test card: <code>4242 4242 4242 4242</code>.`;
  }
  submitBtn.textContent = "Pay service fee";

  return new Promise((resolve) => {
    let cleanedUp = false;
    function cleanup(result) {
      if (cleanedUp) return;
      cleanedUp = true;
      closeModal(overlay);
      resolve(result);
    }

    overlay.querySelectorAll("[data-pay-close]").forEach((el) => {
      el.addEventListener("click", () => cleanup({ ok: false, reason: "cancelled" }));
    });

    (async () => {
      try {
        const { data: { session } } = await client.auth.getSession();
        const headers = { "Content-Type": "application/json" };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

        const intentRes = await fetch("/api/stripe/phased/start-service", {
          method: "POST",
          headers,
          body: JSON.stringify({ bid_id: bid.id }),
        });
        const intentData = await intentRes.json();
        if (!intentRes.ok) throw new Error(intentData.error || "Could not start payment.");

        const stripe = await loadStripe();
        const css = getComputedStyle(document.documentElement);
        const v = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
        const surface2 = v("--fo-surface-2", "#f6f3ea");
        const surface = v("--fo-surface", "#ffffff");
        const text = v("--fo-text", "#0f1f1a");
        const textMuted = v("--fo-text-3", "#7d8b85");
        const accent = v("--fo-accent", "#2d6a4f");
        const isDarkMode = (() => {
          const m = surface.match(/^#?([0-9a-f]{6})$/i);
          if (!m) return false;
          const r = parseInt(m[1].slice(0, 2), 16);
          const g = parseInt(m[1].slice(2, 4), 16);
          const b = parseInt(m[1].slice(4, 6), 16);
          return (r * 299 + g * 587 + b * 114) / 1000 < 128;
        })();

        const elements = stripe.elements({
          clientSecret: intentData.client_secret,
          appearance: {
            theme: isDarkMode ? "night" : "stripe",
            variables: {
              colorPrimary: accent,
              colorBackground: surface2,
              colorText: text,
              colorTextSecondary: textMuted,
              colorTextPlaceholder: textMuted,
              colorDanger: "#d4715a",
              fontFamily: "Figtree, system-ui, sans-serif",
              fontSizeBase: "0.92rem",
              fontSizeSm: "0.8rem",
              borderRadius: "10px",
              spacingUnit: "4px",
            },
          },
        });
        const paymentElement = elements.create("payment");
        paymentElement.mount(elementHost);
        paymentElement.on("ready", () => { submitBtn.disabled = false; });

        submitBtn.addEventListener("click", async () => {
          submitBtn.disabled = true;
          statusEl.textContent = "Processing payment…";
          statusEl.className = "gr-status";

          const { error: confirmErr } = await stripe.confirmPayment({
            elements,
            redirect: "if_required",
          });
          if (confirmErr) {
            statusEl.textContent = confirmErr.message || "Payment failed.";
            statusEl.className = "gr-status error";
            submitBtn.disabled = false;
            return;
          }

          const confirmRes = await fetch("/api/stripe/phased/confirm-service", {
            method: "POST",
            headers,
            body: JSON.stringify({ payment_intent_id: intentData.payment_intent_id }),
          });
          const confirmData = await confirmRes.json();
          if (!confirmRes.ok) {
            statusEl.textContent = confirmData.error || "Payment captured but server failed to confirm. Contact support.";
            statusEl.className = "gr-status error";
            submitBtn.disabled = false;
            return;
          }

          statusEl.textContent = "Service fee held. Reloading…";
          statusEl.className = "gr-status success";
          setTimeout(() => cleanup({ ok: true }), 700);
        });
      } catch (err) {
        statusEl.textContent = err.message || "Something went wrong.";
        statusEl.className = "gr-status error";
      }
    })();
  });
}
