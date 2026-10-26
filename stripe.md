# stripe on grassroots — a 0 to 100 reference

a reference document for understanding every piece of stripe infrastructure in this codebase: what stripe is doing for us, what we hand to it, what we get back, and what's persisted where. read top to bottom if you're new; jump by section if you know what you're after.

last updated: 2026-05-13.

## table of contents

1. [what stripe is, and what we're using it for](#1-what-stripe-is-and-what-were-using-it-for)
2. [the marketplace problem stripe connect solves](#2-the-marketplace-problem-stripe-connect-solves)
3. [the cast of characters (users + objects)](#3-the-cast-of-characters-users--objects)
4. [the money flow, end to end](#4-the-money-flow-end-to-end)
5. [escrow: how grassroots actually holds funds](#5-escrow-how-grassroots-actually-holds-funds)
6. [stripe objects in use, one by one](#6-stripe-objects-in-use-one-by-one)
7. [what stripe collects about each person, and why](#7-what-stripe-collects-about-each-person-and-why)
8. [our backend endpoints — every stripe-touching one](#8-our-backend-endpoints--every-stripe-touching-one)
9. [webhooks — events stripe sends back](#9-webhooks--events-stripe-sends-back)
10. [database tables that mirror stripe state](#10-database-tables-that-mirror-stripe-state)
11. [the contract flows in detail](#11-the-contract-flows-in-detail)
12. [test mode, live mode, and going live](#12-test-mode-live-mode-and-going-live)
13. [security, compliance, and pci scope](#13-security-compliance-and-pci-scope)
14. [sharp edges and known gaps](#14-sharp-edges-and-known-gaps)
15. [glossary](#15-glossary)
16. [where to read more](#16-where-to-read-more)

---

## 1. what stripe is, and what we're using it for

stripe is a payment processor. that means: when a business owner on grassroots types a credit card number into our site, stripe is the party that actually talks to the card network (visa / mastercard / amex), pulls the money, and deposits it. we never touch the raw card number — it goes from the browser straight to stripe.

at a higher level, stripe is two things stacked on top of each other:

1. **payment processing** — charging cards, refunds, fraud detection, 3d-secure (the "verify by sms" step issuers sometimes require), invoice billing, recurring subscriptions.
2. **stripe connect** — the marketplace product. lets a platform like grassroots sit between buyers (businesses) and sellers (consultants), and routes money between them, while taking on the compliance burden of being a "payment facilitator."

without stripe, grassroots would have to:
- become a licensed money transmitter in every us state (six figures of legal work, ongoing audits)
- handle pci-dss compliance for card numbers (extremely invasive scope on your infra)
- collect ssn / ein / bank account info from every consultant, store it securely, and pass it to the irs at year end
- handle chargebacks (when a business owner calls their bank and says "i didn't authorize this")

instead, we hand all of that to stripe, and in exchange:
- stripe takes a per-transaction fee (currently ~2.9% + $0.30 for cards in the us)
- stripe takes a smaller fee on transfers between our platform and consultants
- we accept that all financial state is "shadowed" — stripe is the source of truth, our database mirrors it

**the rule of thumb:** if money is involved, stripe is authoritative. our database is for ux and bookkeeping. when they disagree, stripe wins.

---

## 2. the marketplace problem stripe connect solves

a normal e-commerce site has one merchant (the store) and many buyers. money flows: buyer → stripe → store's bank account. simple.

a marketplace has many sellers. on grassroots: many consultants and many businesses, with grassroots in the middle. money should flow: business → grassroots (briefly) → consultant. that "briefly" is the entire problem — it makes grassroots a money transmitter unless we use a regulated intermediary.

stripe connect is that intermediary. when a consultant onboards, they don't become a customer of grassroots in the payments sense — they become a customer of stripe, with grassroots as the platform. stripe holds the regulatory relationship; we just orchestrate.

### the three account types stripe offers (we picked "custom")

- **standard accounts** — the consultant signs up at stripe.com themselves, has their own stripe dashboard. simplest, but the user has to navigate two brands.
- **express accounts** — stripe hosts the onboarding flow but white-labels it. consultant gets a lightweight stripe dashboard. medium complexity.
- **custom accounts** — we own every pixel of onboarding. consultant never sees the stripe brand if we don't want them to. most work, but matches our ux ambitions.

we use **custom**. see [app.js:835](app.js:835) — the `CONSULTANT_BUSINESS_PROFILE` constant pre-fills mcc (merchant category code) and platform url so stripe doesn't ask the consultant for those fields during onboarding.

### the embedded onboarding component

instead of redirecting consultants to a stripe-hosted url, we use stripe's `account_onboarding` component — a piece of stripe-rendered ui that loads inside an iframe on our own page. it asks for ssn, address, dob, bank account, government id (when triggered for verification). once submitted, stripe takes over the verification process and fires a webhook when status changes.

implementation: [app.js:918](app.js:918) — the `/api/stripe/account-session` endpoint creates an `AccountSession` with a short-lived `client_secret`. the frontend mounts the component using that secret. see also [public/payouts.html](public/payouts.html) for the consumer side.

---

## 3. the cast of characters (users + objects)

every flow on the site involves three (sometimes four) stripe objects. understanding the cast makes the rest of this doc obvious.

### the business owner → a `customer`

- created in stripe the first time they accept a bid.
- has a `stripe_customer_id` we store on the `profiles` table.
- holds: name, email, billing address, saved payment methods (cards), past charges/refunds.
- can have a `default_payment_method` on their `invoice_settings`. we set this after the first successful charge so retainer subscriptions can bill the same card without re-prompting.

implementation: [app.js:889](app.js:889) — `ensureOwnerStripeCustomer`. called lazily on first payment.

### the consultant → a `connect account`

- created the first time the consultant opens the payouts tab.
- has a `stripe_account_id` we store on the `profiles` table.
- has three crucial booleans stripe sets:
  - **`charges_enabled`** — can the account receive funds? (gates acceptance.)
  - **`payouts_enabled`** — can the account move money to a bank? (gates release.)
  - **`details_submitted`** — has the consultant finished the onboarding form?
- we cache an `active` / `pending` summary in `profiles.stripe_account_status`. webhook keeps it fresh.

implementation: [app.js:840](app.js:840) — `ensureConsultantStripeAccount`.

### the platform → grassroots' own stripe account

- this is the top-level account we (the grassroots team) signed up for on stripe.com.
- holds the platform's connect dashboard.
- when funds are in "escrow," they're literally sitting in this account's balance.
- has the api keys (secret + publishable) that the rest of the system uses.

we don't store its id anywhere — it's implicit when our server hits the stripe api with our secret key.

### a fourth, role-flipping character: the card

every payment uses a `payment_method` — usually a card. the card belongs to one of the customers (the business owner). after the first successful charge with `setup_future_usage='off_session'`, the card is saved to the customer for future charges. retainer subscriptions reuse this saved card.

---

## 4. the money flow, end to end

walk through a standard contract end to end. the flow is the same shape for phased and retainer; only the timing and the table that tracks state differ.

```
┌─────────────────┐   1. accept bid (server creates PI)   ┌──────────────────┐
│  business owner │ ─────────────────────────────────────▶│  stripe          │
│  (customer)     │                                       │  payment intent  │
└─────────────────┘                                       └──────────────────┘
        │                                                          │
        │ 2. confirms card via stripe elements                     │
        │                                                          ▼
        │                                                  ┌──────────────────┐
        │                                                  │ stripe charges   │
        │                                                  │ the card         │
        │                                                  └──────────────────┘
        │                                                          │
        │                                                          ▼
        │                                                  ┌──────────────────┐
        │                                                  │ funds land in    │
        │                                                  │ PLATFORM balance │
        │                                                  │ (this is escrow) │
        │                                                  └──────────────────┘
        │                                                          │
        │ 3. work happens off-stripe                               │
        │                                                          │
        │ 4. owner submits review                                  │
        │                                                          ▼
        │                                                  ┌──────────────────┐
        │                                                  │ stripe transfer  │
        │                                                  │ from platform    │
        │                                                  │ to consultant    │
        │                                                  └──────────────────┘
                                                                   │
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │ consultant's     │
                                                          │ connect balance  │
                                                          │ grows            │
                                                          └──────────────────┘
                                                                   │
                                                                   │ on stripe's
                                                                   │ schedule
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │ consultant's     │
                                                          │ bank account     │
                                                          └──────────────────┘
```

### the key insight

at no point does grassroots' own bank account hold the money. funds sit in stripe's accounts (platform-side or consultant-side) the entire time. that's deliberate — it's why we don't need a money-transmitter license.

### where each step is implemented

| step | code | stripe action |
|---|---|---|
| 1. create paymentintent | [app.js:987](app.js:987) `/api/stripe/payment-intent` | `stripe.paymentIntents.create` |
| 2. confirm card | [public/payment-modal.js](public/payment-modal.js) | `stripe.confirmPayment` (frontend) |
| 2b. server confirms + saves card | [app.js:1107](app.js:1107) `/api/stripe/confirm-acceptance` | retrieves PI, calls `stripe.customers.update` to save default_pm |
| 4. release transfer | [app.js:1177](app.js:1177) `/api/stripe/release-funds` | `stripe.transfers.create` with `source_transaction` |
| payout to bank | n/a (stripe auto-schedules) | stripe internal |

---

## 5. escrow: how grassroots actually holds funds

this is the most important section for understanding why our code looks the way it does.

### the two patterns stripe gives us

#### destination charge (the simple one — but we don't use it)

```js
stripe.paymentIntents.create({
  amount,
  transfer_data: { destination: consultant_stripe_account_id },
  on_behalf_of: consultant_stripe_account_id,
});
```

with this pattern, the moment the card is charged, funds automatically route to the consultant's connect account balance. no separate transfer call needed. fast and clean. **but funds reach the consultant immediately — there's no escrow.** the platform never holds the money.

before chunk 0 of the payments overhaul, grassroots used destination charges and called it "escrow" in the ui. that was a lie. funds were already with the consultant at capture; the "held / released" labels in the database were bookkeeping only.

#### separate charges and transfers (what we actually do)

```js
stripe.paymentIntents.create({
  amount,
  // notice: NO transfer_data, NO on_behalf_of
  customer: owner.stripe_customer_id,
});
// ...wait for capture...
stripe.transfers.create({
  amount,
  destination: consultant_stripe_account_id,
  source_transaction: charge_id, // crucial — see below
});
```

with this pattern:
- the charge lands in the **platform** balance.
- funds stay there indefinitely.
- when the owner submits their review (or whenever business logic says "release"), we call `transfers.create` to push the money to the consultant.
- this gives us real escrow. it's also how marketplaces like upwork model their payments.

### why we use `source_transaction` on every transfer

stripe normally requires the platform to have positive available balance before issuing a transfer. in test mode, the platform balance is often $0 (test charges don't add real money). `source_transaction: charge_id` tells stripe "pull from this specific charge directly." it bypasses the available-balance check and pins the transfer to a specific charge for accounting clarity.

this pattern is what makes the entire grassroots payment system work in both test and live modes.

### refunds in this model

there are exactly three states a payment can be in, with different refund rules in each:

| `bids.payment_status` | time since `paid_at` | refund available? | who can issue it |
|---|---|---|---|
| `held` | ≤ 24h | **yes, self-serve** | owner via "request refund" button |
| `held` | > 24h | **yes, by support** | platform support (funds still on platform; clean `stripe.refunds.create` on the PI) |
| `released` | any | **no — final** | nobody. work was marked complete and the review was submitted; the engagement is closed |

mechanically:
- **self-serve refund (held, within 24h)** → `stripe.refunds.create({ payment_intent })`. money goes back to the card. no transfer was ever made, so nothing to reverse.
- **support refund (held, past 24h)** → same shape, but the action happens off-platform (admin tool or the stripe dashboard, by a human at grassroots). the public endpoint returns 403 with `windowExpired: true` so the owner sees a "contact support" prompt.
- **released funds** → not refundable through the system or through support. once `release-funds` fires, the consultant has the money and the engagement is final. the only path that ever moves money back is a card-issuer-initiated chargeback (which stripe routes through `charge.dispute.created`; we'd handle it manually).

note: legacy data may have destination-charged PIs (pre-escrow migration). for those, a refund within the window passes `reverse_transfer: true` to claw the money back from the consultant's connect balance, since funds had already routed. new PIs never need that.

### the 24-hour refund window

`REFUND_WINDOW_MS = 24 * 60 * 60 * 1000` in [app.js:1269](app.js:1269). measured from `bids.paid_at` — the moment the owner accepted the bid and the PaymentIntent captured. the owner sees:

- **within 24h, payment_status='held'** → "request refund" button on the engagement page.
- **past 24h, payment_status='held'** → button hides, helper text appears: "the 24-hour no-questions refund window has passed. contact support to request a refund."
- **payment_status='released'** → button and helper both hidden. no refund-related ui at all.

defined in [public/engagement.js](public/engagement.js).

---

## 6. stripe objects in use, one by one

every object below shows up in your stripe dashboard. knowing which one is which is half the battle.

### `Customer`

represents the business owner. created the first time they accept a bid.

- **what it holds**: email, name, billing address, payment methods, charges, invoices, subscriptions, balance transactions.
- **what we set**: `name`, `metadata.grassroots_user_id`. lazy-created in [app.js:889](app.js:889).
- **what gets attached over time**: a `default_payment_method` (after the first successful PI with `setup_future_usage='off_session'`).
- **dashboard location**: customers → click into a customer to see all activity.

### `PaymentIntent` (PI)

the modern way to charge a card. supersedes the older `Charge` api directly.

- **lifecycle**: `requires_payment_method` → `requires_confirmation` → `processing` → `succeeded` (or `requires_action` for 3ds, then succeeded, or `canceled`).
- **what we set**: amount, currency, customer, `setup_future_usage='off_session'`, `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }`, metadata (bid_id, listing_id, owner_id, consultant_id).
- **what stripe gives back**: `client_secret` (the frontend uses this to confirm), `id` (we store), `latest_charge` (we use as `charge_id` for transfers).
- **dashboard location**: payments → payment intents.

every PI in our system has a `metadata.bid_id` linking it to a row in our `bids` or `bid_phase_payments` tables.

### `Charge`

the underlying card-charge object that a PI produces. you rarely deal with charges directly anymore — they're nested inside a PI as `pi.latest_charge`. but the `charge_id` is what `source_transaction` on a transfer needs.

### `Connect Account` (for consultants)

a stripe account that belongs to a consultant but is "controlled" by our platform.

- **type**: `custom` — see [app.js:840](app.js:840).
- **business_type**: `individual` (we don't currently support consultants registering as a business entity).
- **capabilities requested**: `transfers`, `card_payments`.
- **business_profile**: mcc `7392` (management/consulting) + the platform url + product description. pre-filled to skip stripe's "what's your industry" screens.
- **dashboard location**: connect → accounts.

key fields on an account stripe returns:
- `charges_enabled` — can receive funds from charges.
- `payouts_enabled` — can move funds to bank.
- `details_submitted` — finished onboarding form.
- `requirements.currently_due` — array of fields stripe still wants (e.g., `"individual.id_number"`, `"individual.verification.document"`).

### `Transfer`

a platform → consultant money movement. created when we release escrow.

- **what we set**: amount, currency, destination (consultant's account id), `source_transaction` (the original charge), metadata (bid_id, phase).
- **dashboard location**: connect → transfers.

### `Refund`

reverses a charge.

- **plain refund**: money goes back to the card. funds taken from wherever the charge currently lives.
- **`reverse_transfer: true`**: also reverses any prior transfer for that charge, pulling money back from the consultant. we use this for old destination-charged PIs that pre-date the escrow migration.

### `Product` + `Price` + `Subscription` (for retainers)

stripe's billing primitives.

- **product** — abstract "what is being billed." for us: `"retainer · {listing title}"`. we create one per retainer (overkill but clean lineage). see [app.js:1574](app.js:1574).
- **price** — a specific cost + interval. `unit_amount: feeCents, recurring: { interval: 'month', interval_count: 1 }` for monthly. see [app.js:1580](app.js:1580).
- **subscription** — links a customer to a price with a billing schedule. fires invoice events on cadence.

we deliberately do NOT pass `transfer_data` on the subscription, so invoices land on the platform balance. each period is then released individually (escrow per period).

### `Invoice`

stripe generates one per subscription period. it has a `payment_intent` (the PI that pays it) and a `charge` (the charge that paid the PI). when `invoice.paid` fires via webhook, we mirror it as a `bid_phase_payments` row.

### `AccountSession`

a short-lived secret that lets the frontend mount stripe's embedded onboarding component. see [app.js:918](app.js:918).

### `Event` (webhook payload)

every state change in stripe generates an event. they fire to our `/webhooks/stripe` endpoint with a signed payload. see section 9.

---

## 7. what stripe collects about each person, and why

this is where the regulatory ice gets thick. stripe collects this data because it has to, and because it can — being the regulated party means it has the right legal authority to ask.

### from the business owner (customer)

minimum to charge a card:
- **card number** (4242…) — sent from browser to stripe via stripe.js. **we never see it.**
- **expiry, cvc** — same.
- **postal code** — sometimes required by the issuer for verification.

optional:
- **billing address** — required by some issuers for 3ds.
- **email** — set if we provide it; helps with chargeback dispute evidence.

**we collect**: nothing. the card form is rendered by stripe elements (an iframe). our server only sees the resulting `payment_method.id`, a token like `pm_1Abc...`. this keeps us out of pci-dss scope (see section 13).

### from the consultant (connect account)

required for an individual us account to receive payouts:
- **legal name + dob** — identity verification.
- **address** — irs reporting, identity verification.
- **ssn** (or last 4 + verification document on high-volume accounts) — irs reporting (1099-k generation), kyc.
- **bank account number + routing number** (or a debit card for instant payouts) — where money goes.
- **id verification document** (driver's license, passport, etc.) — triggered for some accounts based on stripe's risk model.

**why**:
- **kyc / aml** (know your customer / anti-money-laundering) — federal law. stripe has to identify every person they pay.
- **tax reporting** — irs requires 1099-k forms for sellers crossing payment thresholds. stripe handles generation + filing.
- **fraud / chargeback defense** — if a card is disputed, stripe needs the receiving party's identity to recoup.

**we collect**: nothing about banking or ssn. we get back a `stripe_account_id` and status booleans. the actual financial data lives in stripe.

### what we (grassroots) can read about a consultant via the api

a `stripe.accounts.retrieve(account_id)` call returns:
- `charges_enabled`, `payouts_enabled`, `details_submitted` (our gates).
- `requirements.currently_due` — what stripe still needs.
- `requirements.eventually_due`, `disabled_reason`.
- `email`, `business_profile`, `metadata`.
- `individual.first_name`, `individual.last_name`, `individual.dob` — only if we requested them.
- never: full ssn, full bank account number, full id document.

### what we tell the consultant + business about each other

very little, financially. the consultant sees the bid amount but not the owner's card; the owner sees the consultant's bid but not their ssn or bank. all of that is between each party and stripe.

---

## 8. our backend endpoints — every stripe-touching one

every endpoint that talks to stripe lives in [app.js](app.js). they all sit behind `requireStripe(res)` ([app.js:817](app.js:817)) which returns 503 if `STRIPE_SECRET_KEY` isn't set.

### connect onboarding (consultants)

| endpoint | what it does | stripe calls |
|---|---|---|
| [`POST /api/stripe/account-session`](app.js:918) | open the embedded onboarding component for the current consultant. creates the account lazily on first call. | `accounts.create` (lazy), `accountSessions.create` |
| [`GET /api/stripe/account-status`](app.js:943) | poll the consultant's onboarding state. used by the payouts tab. | `accounts.retrieve` |

### standard contracts

| endpoint | what it does | stripe calls |
|---|---|---|
| [`POST /api/stripe/payment-intent`](app.js:987) | owner accepts a bid → server creates a PI for the bid amount, escrow into platform. returns `client_secret` for the frontend to confirm. | `customers.create` (lazy), `paymentIntents.create` or `retrieve` |
| [`POST /api/stripe/confirm-acceptance`](app.js:1107) | after stripe captures, server re-verifies + saves the default PM + flips the bid to `accepted` / `held`. | `paymentIntents.retrieve`, `customers.update` |
| [`POST /api/stripe/release-funds`](app.js:1177) | owner submits review → server creates a transfer (using `source_transaction`) for the held amount to the consultant. | `paymentIntents.retrieve`, `accounts.retrieve`, `transfers.create` |
| [`POST /api/stripe/refund-payment`](app.js:1271) | owner clicks "request refund" within 24h. refunds the PI (with `reverse_transfer` for legacy destination charges). | `paymentIntents.retrieve`, `refunds.create` |

### phased contracts

| endpoint | what it does | stripe calls |
|---|---|---|
| [`POST /api/stripe/phased/accept-proposals`](app.js:1358) | owner selects 1..N bids → server creates ONE PI for the sum of proposal fees + inserts `bid_phase_payments` rows. | `paymentIntents.create` |
| [`POST /api/stripe/phased/confirm-proposals`](app.js:2452) | after capture, server flips all linked phase rows to `held` + bids to `accepted`. | `paymentIntents.retrieve` |
| [`POST /api/stripe/phased/proposal-decision`](app.js:2336) | owner picks selected/declined after the kickoff. releases the proposal fee to the consultant either way. | `accounts.retrieve`, `transfers.create` |
| [`POST /api/stripe/phased/start-service`](app.js:2069) | for each selected consultant, server creates a PI for the service fee + a `bid_phase_payments` row. | `paymentIntents.create` |
| [`POST /api/stripe/phased/confirm-service`](app.js:2195) | after capture, server flips the service phase row to `held`. | `paymentIntents.retrieve` |
| [`POST /api/stripe/phased/release-service`](app.js:2233) | owner submits review → server transfers the service fee from the service charge. | `accounts.retrieve`, `transfers.create` |

### retainer contracts

| endpoint | what it does | stripe calls |
|---|---|---|
| [`POST /api/stripe/retainer/start-subscription`](app.js:1520) | first-period released → owner continues. server creates Product + Price + Subscription (no `transfer_data`). | `products.create`, `prices.create`, `subscriptions.create` |
| [`POST /api/stripe/retainer/cancel-subscription`](app.js:1924) | cancels the subscription mid-cycle. | `subscriptions.cancel` |
| [`POST /api/stripe/retainer/offer`](app.js:1677) | owner offers an ongoing retainer at the end of any released engagement. inserts `retainer_subscriptions` row with status='offered'. no stripe call yet. | — |
| [`POST /api/stripe/retainer/accept-offer`](app.js:1768) | consultant accepts the offer. server creates Product + Price + Subscription, flips row to active/pending. | `products.create`, `prices.create`, `subscriptions.create` |
| [`POST /api/stripe/retainer/decline-offer`](app.js:1883) | consultant declines. row flipped to status='declined'. | — |
| [`POST /api/stripe/retainer/release-period`](app.js:1982) | per-period release after stripe bills + owner marks delivered. transfers from that period's charge. | `accounts.retrieve`, `transfers.create` |

---

## 9. webhooks — events stripe sends back

webhooks are how stripe tells us about state changes that didn't happen during a request we made. without them, we'd have no way to know when an async invoice billed, when a consultant finished onboarding, or when a payment was disputed.

### the endpoint

[`POST /webhooks/stripe`](app.js:60). it's registered **before** the global `express.json()` middleware because stripe signature verification requires the raw bytes of the request body.

flow:
1. stripe sends a POST with `Stripe-Signature` header.
2. we verify with `stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET)`. if the signature is bad, return 400.
3. we route on `event.type`, run a handler, and always return 200 — even if the handler throws. (stripe retries on 5xx, so we don't want one broken handler to spam retries.)

### events we currently handle

| event | handler | what happens |
|---|---|---|
| `account.updated` | [onConnectAccountUpdated](app.js:114) | updates `profiles.stripe_account_status` to active or pending based on charges_enabled + payouts_enabled + details_submitted. |
| `account.application.deauthorized` | [onConnectAccountDeauthorized](app.js:131) | the consultant disconnected our app from stripe. nulls out their `stripe_account_id`. |
| `invoice.paid` / `invoice.payment_succeeded` | [onRetainerInvoicePaid](app.js:143) | retainer subscription billed a period. inserts a `bid_phase_payments` row (status='held'), increments `periods_billed`, and auto-cancels via stripe if we've reached `period_count`. |
| `invoice.payment_failed` | [onRetainerInvoiceFailed](app.js:217) | logs only today. stripe handles its own retry schedule. |
| `customer.subscription.deleted` | [onSubscriptionDeleted](app.js:230) | flips `retainer_subscriptions.status` to canceled (unless already completed). |
| `customer.subscription.updated` | [onSubscriptionUpdated](app.js:244) | promotes pending → active when stripe activates the subscription. |

### events we should subscribe to but don't handle yet

| event | why it matters |
|---|---|
| `charge.dispute.created` | a card holder disputed a charge. we'd want to alert the owner + consultant and pause release. |
| `charge.refunded` | someone (us or stripe) refunded a charge — keep our `bids.payment_status` honest. |
| `transfer.created` / `transfer.failed` | confirm our release transfers actually went through (today we trust the synchronous response, which is usually fine but not bulletproof). |
| `payout.failed` | a consultant's bank rejected a payout. they'd need to update their account. |

### the signing secret

`STRIPE_WEBHOOK_SECRET` (an env var, format `whsec_…`). stripe gives it to you when you register a webhook endpoint in their dashboard. it's how we know a webhook actually came from stripe and not a random internet attacker poking the endpoint.

### idempotency

stripe retries webhooks on non-2xx responses for up to ~3 days. every event also has a unique `event.id`, so even if you get the same event twice your handlers should produce the same result the second time. our retainer-invoice handler is idempotent via insert-or-update on `(bid_id, phase, period_index)`. the account-updated handler is naturally idempotent (it's just an `update`).

### local development with webhooks

webhooks need a public url. for local dev you can't use `localhost:3000`. options:

```bash
# stripe's own cli tool tunnels events from stripe to your local server
stripe listen --forward-to localhost:3000/webhooks/stripe
```

this prints a `whsec_…` for the tunneled session. drop it into your `.env` as `STRIPE_WEBHOOK_SECRET` for local testing. then trigger an event from a real flow (or use `stripe trigger invoice.paid` to fire a synthetic one).

---

## 10. database tables that mirror stripe state

stripe is authoritative for money. we mirror just enough state to render the ui and gate state transitions. every column here either references a stripe id or replicates a stripe value for fast access.

### `profiles`

added by [supabase/migrations/add_stripe_fields.sql](supabase/migrations/add_stripe_fields.sql).

| column | type | who | mirrors |
|---|---|---|---|
| `stripe_account_id` | text | consultants | their connect account `acct_…` |
| `stripe_account_status` | text ('pending', 'active', null) | consultants | derived from `account.charges_enabled && payouts_enabled && details_submitted` |
| `stripe_customer_id` | text | business owners | their customer `cus_…` |

### `bids` — for standard contracts

added by [add_stripe_fields.sql](supabase/migrations/add_stripe_fields.sql).

| column | type | mirrors |
|---|---|---|
| `payment_intent_id` | text | the PI on this bid (`pi_…`) |
| `payment_status` | text ('unpaid', 'authorizing', 'held', 'released', 'refunded', 'failed') | our state machine; loosely tracks the PI lifecycle |
| `payment_amount_cents` | integer | snapshot of the amount we charged (in case bid.amount_cents drifts) |
| `transfer_id` | text | the release `Transfer` id (`tr_…`) — null for in-flight or pre-escrow data |
| `paid_at` | timestamptz | when the bid flipped to `held` (also the 24h refund window anchor) |
| `released_at` | timestamptz | when funds were released to the consultant |

### `bids` — added later for phased

added by [add_phased_retainer_payments.sql](supabase/migrations/add_phased_retainer_payments.sql).

| column | type | mirrors |
|---|---|---|
| `proposal_fee_cents` | integer | consultant's proposal fee bid (phased only) |
| `service_fee_cents` | integer | consultant's full-job fee bid (phased only) |
| `move_forward_status` | text ('pending', 'selected', 'declined') | owner's decision after the kickoff |
| `move_forward_decided_at` | timestamptz | when the decision was made |

### `bid_phase_payments` — for phased + retainer

added by [add_phased_retainer_payments.sql](supabase/migrations/add_phased_retainer_payments.sql). one row per actual money movement.

| column | meaning |
|---|---|
| `bid_id` | the bid this payment is part of |
| `phase` | 'proposal' \| 'service' \| 'maintenance' \| 'retainer_period' |
| `period_index` | for retainer_period: the cycle number (0-based). null for others. |
| `amount_cents` | what stripe billed |
| `payment_intent_id` | the PI on stripe |
| `charge_id` | the underlying charge (needed for `source_transaction` on release) |
| `transfer_id` | the release transfer, once released |
| `refund_id` | (reserved) for partial refunds on phased proposals |
| `status` | mirrors `bids.payment_status` enum |
| `paid_at` / `released_at` / `refunded_at` | timeline |

unique constraint: `(bid_id, phase, coalesce(period_index, -1))` — postgres treats nulls as distinct by default, so we coalesce.

### `retainer_subscriptions`

added by [add_phased_retainer_payments.sql](supabase/migrations/add_phased_retainer_payments.sql), extended by [add_retainer_offer_columns.sql](supabase/migrations/add_retainer_offer_columns.sql).

| column | meaning |
|---|---|
| `bid_id` | the bid this retainer continues from |
| `stripe_subscription_id` | the stripe subscription `sub_…` (null while status='offered') |
| `cadence` | 'weekly' \| 'biweekly' \| 'monthly' \| 'quarterly' |
| `period_count` | how many periods the retainer should run |
| `fee_cents` | per-period fee |
| `periods_billed` | counter incremented by webhook on each `invoice.paid` |
| `status` | 'offered' \| 'pending' \| 'active' \| 'canceled' \| 'completed' \| 'declined' |
| `offered_by` | (offer flow) the owner who proposed |
| `offered_at`, `accepted_at`, `declined_at`, `canceled_at`, `started_at`, `ends_at` | timeline |
| `offer_message` | optional note from owner |

### `listings` — retainer config

added by [add_phased_retainer_payments.sql](supabase/migrations/add_phased_retainer_payments.sql) and [add_listing_contract_type_columns.sql](supabase/migrations/add_listing_contract_type_columns.sql).

| column | meaning |
|---|---|
| `contract_type` | 'standard' \| 'phased' \| 'retainer' |
| `proposal_budget` | (phased) ceiling for consultant proposal fees |
| `maintenance_terms` | (phased) free-text terms for the optional maintenance phase |
| `retainer_terms` | (retainer) 'fixed' or 'tentative' |
| `retainer_cadence`, `retainer_period_count`, `retainer_fee_cents` | (retainer, fixed) the proposed terms |

---

## 11. the contract flows in detail

three contract types. each has slightly different state transitions in stripe + our db.

### standard — single fee, single charge, single release

```
listing posted → consultant submits bid → owner clicks accept
  └─▶ /payment-intent: PI created in stripe, escrow into platform
       (PI also passes setup_future_usage='off_session' to save the card)
  └─▶ stripe elements collects card, frontend confirms PI
  └─▶ /confirm-acceptance: bids.status='accepted', payment_status='held'
       (default_payment_method also set on the customer here)
... work happens off-stripe ...
owner submits review
  └─▶ /release-funds: stripe.transfers.create with source_transaction=charge_id
  └─▶ bids.payment_status='released', transfer_id set
... eventually ...
stripe runs its payout schedule
  └─▶ consultant's bank account receives the funds
```

if owner clicks refund within 24h of paid_at:
```
  └─▶ /refund-payment: stripe.refunds.create on the PI
  └─▶ bids.payment_status='refunded', status='rejected'
```

### phased — proposal escrow per consultant, service escrow per selected

```
listing posted (contract_type='phased', proposal_budget=X)
each consultant: submits bid with proposal_fee_cents + service_fee_cents
owner: checks bids they want → clicks "pay N proposal fees"
  └─▶ /phased/accept-proposals: ONE PI for sum of proposal fees
       inserts N rows in bid_phase_payments (phase='proposal', status='authorizing')
  └─▶ stripe elements → frontend confirms
  └─▶ /phased/confirm-proposals: all rows → status='held', charge_id set
       all bids → status='accepted'
... each consultant delivers their proposal, kickoff meetings happen ...
owner picks who to move forward with (per consultant)
  └─▶ /phased/proposal-decision (decision='selected' | 'declined'):
       transfers that consultant's proposal_fee_cents from the charge
       bid_phase_payments row → status='released'
       bids.move_forward_status set
for each selected consultant: service phase begins
  └─▶ /phased/start-service: new PI for service_fee_cents
       bid_phase_payments row inserted (phase='service', status='authorizing')
  └─▶ stripe elements → confirm
  └─▶ /phased/confirm-service: phase row → status='held'
... work happens ...
owner submits review (per consultant)
  └─▶ /phased/release-service: transfer from service charge
       phase row → status='released'
```

each consultant has their own engagement page (one bid = one engagement). the owner's review applies to that bid alone.

### retainer (fixed terms) — escrow per period

```
listing posted (contract_type='retainer', retainer_terms='fixed',
  retainer_cadence='monthly', retainer_period_count=6, retainer_fee_cents=50000)
consultant submits bid (per-period fee, defaults to listing fee)
owner accepts the bid
  └─▶ /payment-intent: standard first-period PI for amount_cents
       (this is identical to a standard contract — escrow + release)
  └─▶ standard flow plays through. first period released.
after release, owner sees retainer-decision-panel on engagement page
  └─▶ click "continue retainer":
       /retainer/start-subscription: stripe Product + Price + Subscription
       retainer_subscriptions row inserted (status='active' or 'pending')
       (subscription has no transfer_data — invoices escrow on platform)
... time passes ...
stripe fires invoice.paid for period 2
  └─▶ webhook onRetainerInvoicePaid:
       inserts bid_phase_payments row (phase='retainer_period', period_index=1)
       increments retainer_subscriptions.periods_billed
owner clicks release for period 2 on the periods panel
  └─▶ /retainer/release-period: transfer from period 2's charge
       phase row → status='released'
... repeat per period ...
when periods_billed >= period_count
  └─▶ webhook auto-cancels the subscription via stripe.subscriptions.cancel
  └─▶ later: customer.subscription.deleted fires, row → status='completed'
       (we use 'completed' over 'canceled' to reflect the natural end)
```

### retainer (tentative terms) — owner negotiates after first delivery

same as fixed retainer, except the listing has `retainer_terms='tentative'` and the cadence/period/fee fields are null. on the retainer-decision-panel after first release, the owner sees a form to fill in cadence/period/fee before clicking continue. those values are sent in the request body to `/retainer/start-subscription`.

### convert-to-retainer offer (any released engagement)

```
any non-retainer engagement reaches bids.payment_status='released'
owner sees the retainer-offer-panel on the engagement page
  └─▶ click "offer retainer", fill in cadence/period/fee/message
  └─▶ /retainer/offer: inserts retainer_subscriptions row, status='offered'
consultant visits engagement page, sees the offer + accept/decline buttons
  └─▶ click "accept retainer":
       /retainer/accept-offer: creates Product + Price + Subscription on the
         owner's customer (using their saved default_payment_method)
       row flips to 'active' (or 'pending')
  └─▶ click "decline":
       /retainer/decline-offer: row flips to 'declined'
```

from here, the subscription behaves exactly like the chunk-7 retainer flow (webhooks insert periods, owner releases each, auto-cancel at period_count).

---

## 12. test mode, live mode, and going live

stripe has two completely separate environments.

### test mode

- api keys start with `sk_test_` / `pk_test_`.
- test cards work, real cards don't.
- common test cards (every digit/format matters):
  - `4242 4242 4242 4242` — successful visa charge.
  - `4000 0000 0000 9995` — insufficient funds decline.
  - `4000 0027 6000 3184` — requires 3d-secure authentication.
  - any future date for expiry, any 3-digit cvc.
- test webhooks fire only to test endpoints.
- you can advance time using **test clocks** to simulate subscription billing without waiting a month.

### running webhooks against local dev

stripe needs to "phone home" to your laptop to deliver events like `invoice.paid` (retainers) and `account.updated` (consultant onboarding). a local server isn't reachable from stripe's network on its own, so we use stripe's tunnel.

one-time setup (per machine):
```sh
brew install stripe/stripe-cli/stripe   # or download from stripe.com/docs/stripe-cli
stripe login                            # opens browser, links your stripe account
```

every time you're testing webhook-driven flows (retainer billing especially) start the tunnel:
```sh
npm run stripe:listen
```

that's an alias for `stripe listen --forward-to localhost:3000/webhooks/stripe`. it prints a `whsec_…` value the first time — copy it into `STRIPE_WEBHOOK_SECRET` in `.env`. leave the tunnel running while you test; events fire in real time.

**why this matters:** without the tunnel, retainer subscription invoices get paid in stripe but our database never learns about it (no `bid_phase_payments` row, no period to release). the standard and phased one-off flows don't need the tunnel because they're driven by client-side `confirmPayment` + a direct server call to `/api/stripe/confirm-acceptance` — no webhook in the critical path. **only retainer billing depends on webhook delivery.**

### live mode

- api keys start with `sk_live_` / `pk_live_`.
- only real cards. real money moves.
- mistakes cost real dollars + can trigger chargebacks.

### required env vars

| var | what for | format |
|---|---|---|
| `STRIPE_SECRET_KEY` | server-side stripe sdk auth | `sk_test_…` or `sk_live_…` |
| `STRIPE_PUBLISHABLE_KEY` | frontend stripe.js init | `pk_test_…` or `pk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | verify webhook signatures | `whsec_…` |
| `PLATFORM_URL` | the platform's url written into every consultant's `business_profile.url` | full url string |

read by [app.js:19-24](app.js:19).

### what changes between test and live

| concern | test | live |
|---|---|---|
| consultant onboarding | accepts fake ssn (`000-00-0000`), test bank routing/account numbers | real ssn + real bank required |
| platform balance | seeded $0; rely on `source_transaction` to release | will accumulate real funds from charges; payouts apply |
| 1099-k tax forms | not generated | stripe generates and files |
| disputes/chargebacks | manually triggerable via test cards | real, with real evidence windows |
| webhook url | usually a local tunnel (`stripe listen`) | needs to be a public https url |

### going-live checklist

1. switch all three env vars in production to live values.
2. register a new webhook endpoint pointing at `https://your-domain.com/webhooks/stripe`. subscribe to:
   - `account.updated`, `account.application.deauthorized`
   - `invoice.paid` (and/or `invoice.payment_succeeded`), `invoice.payment_failed`
   - `customer.subscription.deleted`, `customer.subscription.updated`
   - (future) `charge.dispute.created`, `charge.refunded`, `transfer.created`, `transfer.failed`, `payout.failed`
3. update `PLATFORM_URL` to the production url. (consultants who onboarded in test mode will have the test url on their account.)
4. confirm every consultant has finished onboarding (`stripe_account_status='active'`) before they can be accepted. our endpoints already gate on this; live mode tightens the screws further.
5. set up payout schedule on consultants. default is daily, but stripe may delay the first payout for new accounts (typically 7 days).
6. enable email alerts in stripe dashboard for failed webhooks, disputes, and account requirement changes.

---

## 13. security, compliance, and pci scope

### pci-dss — why we use stripe elements

handling raw card numbers puts your servers in pci-dss scope, which means quarterly scans, annual self-assessments (or auditor visits for high volume), strict logging, and many other constraints. expensive.

**we never see a card number.** stripe elements is an iframe hosted on stripe.com that we embed via stripe.js. when the user types their card, the data goes directly from the iframe to stripe's servers. our server only ever sees the resulting tokenized `payment_method.id` (e.g. `pm_1Abc…`). this keeps us in pci scope level "self-assessment questionnaire a" — the minimum.

if you ever want to receive a raw card number on your own servers (e.g., to use a different processor), you instantly leap into a much harder pci tier. don't.

### webhook signature verification

a webhook url is a public endpoint. anyone could POST to it claiming to be stripe. signature verification — `stripe.webhooks.constructEvent(body, sig, secret)` — proves the payload came from stripe and wasn't tampered with.

we require both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to be set. if `STRIPE_WEBHOOK_SECRET` is missing, the endpoint returns 500 and refuses to process anything — see [app.js:66](app.js:66).

### scope of secrets

- `STRIPE_SECRET_KEY` lives only on the server. exposing it would let an attacker create charges + refunds in our name. treat it like a database root password.
- `STRIPE_PUBLISHABLE_KEY` is fine in the browser — it can only create tokens, not move money.
- `STRIPE_WEBHOOK_SECRET` is server-only. exposing it would let an attacker forge webhook events to manipulate our db state.

### sca / 3d-secure 2

european issuers (and some us banks) require strong customer authentication — the "verify by sms" challenge. stripe handles this automatically when we use `automatic_payment_methods: { enabled: true }` on the PaymentIntent. on the frontend we pass `redirect: 'if_required'` to `stripe.confirmPayment` — stripe auto-handles the challenge inline.

### kyc and the data we don't store

ssns, full bank account numbers, government id documents — stripe holds all of it. our server never receives any of those fields. the most sensitive piece of data we hold is the consultant's `stripe_account_id` — which on its own is meaningless to anyone without our secret key.

### data residency

stripe stores data primarily in the us (with regional caveats — eu data may be replicated). all charges run through stripe's us payment processing. if grassroots ever expands internationally, this matters.

---

## 14. sharp edges and known gaps

these are real things that could bite you. read once now and again before going live.

### 1. funds in escrow are technically grassroots' liability

while money sits in the platform balance, it's accounted to grassroots' stripe account. on stripe's books, it's our money — even though business logic says it's earmarked for consultants. if grassroots' stripe account were ever frozen (rare, but possible after suspicious activity), those funds could be inaccessible. this is the cost of real escrow.

### 2. application fee is zero

we don't take a cut today. the `application_fee_amount` parameter on PaymentIntents is unset. when grassroots monetizes, this is the single line to change — add `application_fee_amount` (in cents) to every PI's create call. stripe will route that amount to grassroots and the rest to the consultant on transfer.

### 3. the 7-day capture window does not apply to us

stripe's docs warn about a 7-day window between authorization and capture. we don't use manual capture — `automatic_payment_methods: { enabled: true }` defaults to immediate capture. funds are charged the moment the owner confirms.

### 4. webhook race conditions

if `invoice.paid` arrives before the `start-subscription` endpoint finishes inserting the `retainer_subscriptions` row, our handler logs "unknown subscription" and skips. in practice this is fast (sub-millisecond), but a proper fix would queue retries from a cron. flagged in [to-do tests.md](to-do%20tests.md).

### 5. tax forms

stripe generates 1099-k forms for us-based consultants who cross the irs threshold ($600 for 2024, but the threshold has been in flux). we don't actively configure tax settings — stripe uses its defaults. for production, you'd want to set tax preferences in the stripe dashboard.

### 6. chargebacks (disputes)

if an owner disputes a charge through their bank weeks after release, the money has already gone to the consultant. stripe will pull it back from the platform balance by default. we have no automated dispute response today — would need a `charge.dispute.created` webhook + admin tooling to upload evidence.

### 7. consultant deauthorization mid-engagement

if a consultant clicks "disconnect" in their stripe dashboard during an active engagement, our `account.application.deauthorized` handler nulls their `stripe_account_id`. any pending releases will fail at the transfer step. the engagement page will show "consultant hasn't set up payouts" — which is technically true but misleading. open issue.

### 8. multi-listing batches on phased accept

the `/phased/accept-proposals` endpoint doesn't currently enforce that all `bid_ids` belong to the same listing. as long as the owner owns the listings, it'll accept a mixed batch and create one combined PI. flagged in [to-do tests.md](to-do%20tests.md).

### 9. proposal-batch refunds are partial

if an owner refunds one consultant's proposal fee out of a batch of three, we'd need a partial refund (`stripe.refunds.create({ payment_intent, amount })`). not implemented. today the only refund path is the 24-hour full-PI refund on standard bids.

### 10. subscription period_count is no longer enforced

retainer subscriptions are now open-ended. the `period_count` column on `retainer_subscriptions` is kept on the row as a legacy soft hint but is no longer used to auto-cancel. termination happens via either party's "end after current period" click (sets stripe `cancel_at_period_end: true`) or an owner-set `terminates_at` (mirrors to stripe's `cancel_at`). see §11 for the current retainer model.

### 11. held funds: delivery-anchored release

held payments release on a delivery-anchored review window, run daily by `GET /api/cron/auto-release` (vercel cron, `Bearer $CRON_SECRET`). migration: `supabase/migrations/add_delivery_release.sql`.

- **one-time jobs + phased service fees:** the consultant marks the work delivered (`POST /api/engagement/mark-delivered`, optional note + link). the owner has 14 days to release (mark complete + review), request changes (`POST /api/engagement/request-changes`, clears the delivered mark; the window restarts on the next mark), or contact support. day 7: in-app heads-up to the owner. day 14: auto-release, both sides notified. nothing delivered → never auto-releases.
- **retainers:** each period's window opens at the end of the period (`bid_phase_payments.period_end_at` from the invoice line, fallback `paid_at` + cadence). the consultant may mark a period delivered early to open it sooner. once the owner requests changes on a period, only a new delivered mark reopens it. a retainer listing's first period (paid on the bid) uses the listing cadence. the owner's `auto_release` toggle still releases each period at `invoice.paid`.
- **phased proposal fees:** released only by the owner's move-forward decision; backstop only.
- **90-day backstop:** anything still held 90 days after its charge is flagged once (`backstop_flagged_at`, admin notification `held_payment_backstop`, ops alert) and never auto-released.
- **reported problems (terms §6.4, §7.1, §21):** migration `add_support_outcomes.sql`. during the 14-day review the owner can `POST /api/engagement/report-problem` (`note` required, optional `link`). that sets the support hold: no auto-release, but the owner can still release it. support decides on the admin **payments** tab (`/admin/?tab=payments`) via `POST /api/admin/payments/outcome`:
  - `meets_scope` (A) → release (same transfer path, `source_transaction` pinned, dispute check).
  - `fixable` (B) → the consultant has 5 days (`redo_deadline_at`) to `POST /api/engagement/redo-choice` with `redo` (once per payment, `redo_used`; clears the delivered mark like a change request, lifts the hold, a new 14-day review starts on the next mark) or `give_back` (full refund of what's left on the charge). the daily job reminds the consultant on day 3 and gives the payment back at the deadline (`give_back_timeout`).
  - `scope_breached` (C) → full refund of what the business paid; consultant gets nothing.
  - `split` → support divides what's left on the charge (`refund_cents` to the business + `transfer_cents` to the consultant, both > 0, sum ≤ what's left, `transfer_cents` ≤ the consultant's full-release payout) with a required `reason`. claim held → released (compare-and-set), refund then transfer (`source_transaction` pinned), both with idempotency keys. a failed refund rolls back; a failed transfer after the refund leaves the row released with no `transfer_id`, alerts ops (`split_transfer_failed`) and shows on the admin screen with `POST /api/admin/payments/retry-split-transfer`. dispute blocks it. available wherever A/C are.
  - **every support-driven refund is in full; grassroots absorbs Stripe's card fee** (moiz, 2026-10-24). the actual fee (from the charge's balance transaction, with a plain reason when it isn't 2.9% + 30¢) is recorded only in the audit row (`card_fee_absorbed_cents`, `fee_note`) and shown on the admin screen, never to either party.
  - all-in pricing: the business paid exactly the offer, so "in full" means everything it paid. the card fee and platform fee only ever came out of the consultant's payout (`paymentMoney()` in app.js).
  - free ($0) jobs have no charge: report-a-problem, hold, every outcome and settlement return 409, and they don't show on the admin payments tab.
  - after a redo, a second report allows only A, C or split (`fixable` refused while `redo_used`).
  - undecided 14+ days after the report → `problem_report_stale` ops alert every run + one admin notification.
- **consultant's side:** a report or hold opens a 48-hour window (`response_due_at`). the consultant is told why (the business's note and link, or support's reason) and can `POST /api/engagement/respond-to-report` (note + optional link; editable until the deadline, refused after). the text is kept only in `payment_audit` (server-only), so the business sees that a response was sent, not what it says. support sees it on the admin drawer. deciding an outcome or settlement inside the window without a response returns 409 `response_window_open`; resending with `decide_early: true` goes through and is recorded as early in the audit row.
- **support hold:** admin only, `POST /api/admin/payments/hold` (`bid_id`, optional `payment_id`, `reason` both sides see). only for cases the business can't report itself (nothing delivered, proposal fee, review over); during an open review it returns 409 and support points the business to "report a problem". same lock and 48-hour window as a report. there is no clear-hold: a hold ends only with an outcome, a remainder settlement, or the consultant choosing to redo. owner-initiated release still works during a hold.
- **settling partial refunds:** `POST /api/admin/payments/settle-remainder` with `release` (payout = min(stored payout, remaining − card fee − platform fee)) or `refund` (everything left on the charge).
- **audit:** every report, hold, outcome, choice, timeout and settlement writes a `payment_audit` row (who, when, action, amount, stripe object id). server-only table; read it on the admin drawer or `GET /api/admin/payments/audit?payment_id=`.
- **disputes:** open or lost card disputes block every release path (unchanged).
- **partial refunds:** `charge.refunded` with a partial amount stamps the unexplained refunded amount (charge total minus refunds grassroots already recorded on refunded rows, e.g. a give-back or one row of a proposal batch) on every held row of that payment intent and notifies admins. a refund grassroots issued itself is not flagged. every release path claims with `refunded_cents = 0`, so a partially refunded payment can't release for the full amount (owner or job). support settles it by hand.
- every auto-release claim is compare-and-set on the delivery / hold state the job read, so a hold or change request landing mid-run wins.

**detection:** `select * from stranded_funds_report(14);` (service role / sql editor only) or `GET /api/admin/payments/held` (admin; `?all=1` includes payments on their normal schedule). the admin endpoint lists held payments that need a person (on hold, reported, waiting on the consultant, partly refunded, 90-day backstop, open or lost dispute, undecided 14+ days), with the money breakdown and the actions the server will accept.

**harness:** `node scripts/test-payment-release.js` (in-memory supabase + fake stripe, real app.js over http). grants: `node scripts/test-delivery-release-grants.mjs` (needs `npm i --no-save @electric-sql/pglite@0.2.17`).

### 12. stripe `invoice.charge` is null on newer api versions

historical: `invoice.charge` populated at the top level on older stripe api versions. on the current api, the charge lives nested at `invoice.payments.data[0].payment.payment_intent → latest_charge`. our `onRetainerInvoicePaid` handler resolves this via a `resolveInvoiceCharge()` helper before writing to `bid_phase_payments` — if it ever wrote `charge_id: null`, the subsequent release-period transfer would fail because `source_transaction` can't be pinned.

---

## 15. glossary

quick definitions for jargon used in this doc.

- **3d-secure (3ds)** — the "verify by sms" challenge some issuers require. stripe handles it via `automatic_payment_methods` + `redirect: 'if_required'`.
- **acct_…** — id prefix for a connect account.
- **application fee** — the cut a platform takes from each charge. we set this to 0 today.
- **capture** — actually moving money from the card holder. in our flow, this happens immediately on PI confirmation.
- **charge** — the underlying card-charge object inside a successful PaymentIntent.
- **ch_…** — id prefix for a charge.
- **connect** — stripe's marketplace product. lets a platform sit between buyers and many sellers.
- **custom account** — a connect account type where the platform owns onboarding ui. we use this.
- **cus_…** — id prefix for a customer.
- **destination charge** — a payment pattern where funds route to the connected account at capture time. we don't use this (no real escrow).
- **escrow** — funds held by a neutral party between buyer and seller. we implement this via `separate_charges_and_transfers` in the platform balance.
- **idempotency** — operation can be repeated with the same result. webhooks need idempotent handlers.
- **kyc** — know your customer. regulatory requirement to verify identity of anyone receiving funds.
- **mcc** — merchant category code. an industry classification. we use 7392 (management/consulting).
- **payout** — stripe moving money from a connect account's balance to that account's bank. happens on a schedule (usually daily).
- **pci-dss** — payment card industry data security standard. you don't want to be in scope.
- **pi_…** — id prefix for a paymentintent.
- **pm_…** — id prefix for a payment method.
- **price** — stripe billing object: cost + recurring interval. attached to a product.
- **product** — stripe billing object: an abstract "what is being billed." parent of price.
- **sca** — strong customer authentication. eu regulation; 3ds is one way to satisfy it.
- **separate charges and transfers** — payment pattern where funds capture into the platform and are transferred to the connected account later. this is real escrow.
- **setup_future_usage** — paymentintent flag that saves the payment method to the customer for off-session reuse. we set this to `'off_session'` to enable retainer subscriptions to reuse the card.
- **source_transaction** — parameter on `transfers.create` that pins the transfer to a specific charge, bypassing the platform's available-balance requirement.
- **sub_…** — id prefix for a subscription.
- **transfer** — stripe object representing money movement from the platform to a connected account.
- **tr_…** — id prefix for a transfer.
- **webhook** — http callback stripe sends to our server when state changes happen (`POST /webhooks/stripe`).
- **whsec_…** — id prefix for a webhook signing secret.

---

## 16. where to read more

### stripe's docs (canonical references)

- [connect overview](https://stripe.com/docs/connect) — start here for any marketplace work.
- [payment intents api lifecycle](https://stripe.com/docs/payments/payment-intents) — the diagram is worth memorizing.
- [separate charges and transfers](https://stripe.com/docs/connect/separate-charges-and-transfers) — exactly the pattern we use.
- [billing / subscriptions overview](https://stripe.com/docs/billing/subscriptions/overview) — for retainer mechanics.
- [webhooks](https://stripe.com/docs/webhooks) — including the signature verification deep-dive.
- [test clocks](https://stripe.com/docs/billing/testing/test-clocks) — for advancing subscription time in test mode.
- [stripe cli](https://stripe.com/docs/stripe-cli) — `stripe listen` for local webhook tunneling.

### in this codebase

- [app.js](app.js) — every stripe endpoint and webhook handler. start at line 58 (webhook handler) and 815 (the section comment for stripe connect).
- [public/payment-modal.js](public/payment-modal.js) — frontend stripe elements integration. three exported flows: `payAndAcceptBid` (standard), `payAndAcceptProposals` (phased batch), `payAndStartService` (phased service).
- [public/engagement.js](public/engagement.js) — the engagement-page state machine for proposal-phase / service-phase / retainer panels. all the role-aware "owner sees X, consultant sees Y" logic.
- [supabase/migrations/add_stripe_fields.sql](supabase/migrations/add_stripe_fields.sql) — initial stripe schema.
- [supabase/migrations/add_phased_retainer_payments.sql](supabase/migrations/add_phased_retainer_payments.sql) — phased + retainer schema.
- [supabase/migrations/add_retainer_offer_columns.sql](supabase/migrations/add_retainer_offer_columns.sql) — offer flow schema extensions.
- [supabase/migrations/add_listing_contract_type_columns.sql](supabase/migrations/add_listing_contract_type_columns.sql) — contract_type + proposal_budget on listings.
- [to-do tests.md](to-do%20tests.md) — the remaining live-card test punch list, by chunk.
