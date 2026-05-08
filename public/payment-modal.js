/* ================================================================
   Owner-side payment modal — opens when a business accepts a bid.
   Creates a PaymentIntent server-side, mounts Stripe Payment Element,
   confirms the payment, then asks the server to flip the bid to
   `accepted` only after Stripe reports success.
   Sandbox/test-mode only.
   ================================================================ */

let stripePromise;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatUsd(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
}

async function loadStripe() {
  if (stripePromise) return stripePromise;
  stripePromise = (async () => {
    const res = await fetch("/api/public-config");
    const cfg = await res.json();
    if (!cfg.stripePublishableKey) {
      throw new Error("payments aren't configured on the server.");
    }
    if (!window.Stripe) {
      throw new Error("stripe.js failed to load.");
    }
    return window.Stripe(cfg.stripePublishableKey);
  })();
  return stripePromise;
}

function buildModal({ amount, title }) {
  const overlay = document.createElement("div");
  overlay.className = "pay-overlay is-open";
  overlay.innerHTML = `
    <div class="pay-overlay__backdrop" data-pay-close></div>
    <div class="pay-modal" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <header class="pay-modal__head">
        <div>
          <p class="pay-modal__eyebrow">accept &amp; pay · sandbox</p>
          <h2 id="pay-title" class="pay-modal__title">${escapeHtml(title || "engagement")}</h2>
        </div>
        <button type="button" class="pay-modal__close" data-pay-close aria-label="close">&times;</button>
      </header>
      <p class="pay-modal__intro">
        funds are <strong>held in escrow by grassroots</strong> until you mark the work complete and submit your review. test card: <code>4242 4242 4242 4242</code>, any future date, any cvc.
      </p>
      <div class="pay-modal__amount">
        <span>amount</span>
        <strong>${escapeHtml(formatUsd(amount))}</strong>
      </div>
      <div id="pay-element" class="pay-modal__element"></div>
      <p id="pay-status" class="gr-status" aria-live="polite"></p>
      <div class="pay-modal__actions">
        <button type="button" class="gr-btn gr-btn--ghost" data-pay-close>cancel</button>
        <button type="button" class="gr-btn gr-btn--primary" id="pay-submit" disabled>pay &amp; accept</button>
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
  const overlay = buildModal({ amount, title: listing?.title });
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
        if (!intentRes.ok) throw new Error(intentData.error || "could not start payment.");

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
              fontFamily: "Manrope, system-ui, sans-serif",
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
          statusEl.textContent = "processing payment…";
          statusEl.className = "gr-status";

          const { error: confirmErr } = await stripe.confirmPayment({
            elements,
            redirect: "if_required",
          });
          if (confirmErr) {
            statusEl.textContent = confirmErr.message || "payment failed.";
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
            statusEl.textContent = confirmData.error || "payment captured but server failed to confirm. contact support.";
            statusEl.className = "gr-status error";
            submitBtn.disabled = false;
            return;
          }

          statusEl.textContent = "payment held in escrow. redirecting to engagement…";
          statusEl.className = "gr-status success";
          setTimeout(() => cleanup({ ok: true }), 700);
        });
      } catch (err) {
        statusEl.textContent = err.message || "something went wrong.";
        statusEl.className = "gr-status error";
      }
    })();
  });
}
