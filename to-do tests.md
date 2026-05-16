# to-do tests

manual live tests pending. each chunk's automated/dom checks happen during build, but the stripe-touching paths need a real test-mode card to fully verify.

## chunk 0 — standard real escrow

- [ ] **accept a bid** as `testbiz@gmail.com`. confirm in stripe dashboard:
  - paymentintent succeeds
  - charge appears on the **platform** balance (not the consultant's connect balance)
  - no `transfer_data.destination` on the intent
- [ ] **mark work complete + submit review** on that engagement. confirm:
  - `transfer.created` event fires
  - amount appears in the consultant's connect balance
  - bid's `payment_status` flips to `released`, `transfer_id` is set
- [ ] **request refund within 24h** of acceptance on a fresh bid. confirm:
  - refund button visible in owner actions
  - `refund.created` event fires, no transfer created
  - bid `payment_status` → `refunded`, `status` → `rejected`
- [ ] **request refund past 24h** (or check existing bid `88200592` which is past window). confirm:
  - button is hidden
  - "the 24-hour no-questions refund window has passed" helper text shows with a mailto link

## chunk 1 — schema migration

migration `add_phased_retainer_payments.sql` applied live. plus supplemental `add_listing_contract_type_columns.sql` (contract_type / proposal_budget / maintenance_terms were collected in the create-listing form but never had columns; promoted them now).

- [ ] create a phased listing via the ui — verify `listings.contract_type='phased'`, `proposal_budget` populated.
- [ ] create a retainer listing with terms='fixed' — verify retainer_cadence/period_count/fee_cents persist. (chunk 6 will wire this end to end.)
- [ ] create a retainer listing with terms='tentative' — verify cadence/period_count/fee_cents stay null. (chunk 6.)
- [x] phased bid insert via the new ui writes proposal_fee_cents + service_fee_cents + amount_cents.
- [ ] verify RLS — sign in as a consultant unrelated to a bid and confirm they cannot read its `bid_phase_payments` rows.

## chunk 2 — consultant phased bid ui

- [x] consultant offer panel switches to two-input layout when listing.contract_type='phased'.
- [x] proposal budget ceiling shown as hint when listing.proposal_budget is set.
- [x] form validation rejects empty/zero/over-budget proposal fee.
- [x] owner's proposal card shows "$X proposal / $Y full job" with tags.
- [ ] standard listings still show single offer-amount input (regression check).
- [ ] retainer listings — still show single input today; will branch in chunk 6.

## chunk 3 — owner multi-proposal accept flow

- [x] phased listing's proposal cards show a checkbox in place of the single accept button.
- [x] sticky "pay proposal fee(s)" cta shows the running total in escrow as checkboxes toggle.
- [x] `/api/stripe/phased/accept-proposals` creates one paymentintent for the sum and inserts `bid_phase_payments` rows (phase='proposal', status='authorizing').
- [x] modal opens with the correct title, total, and copy.
- [ ] **live card test**: select 2 bids on a phased listing, click pay, enter 4242 4242 4242 4242. confirm:
  - paymentintent succeeds in stripe dashboard (single charge for the sum)
  - both bid_phase_payments rows flip to status='held' with charge_id populated
  - both bids flip to status='accepted'
- [ ] **live multi-listing rejection**: send `bid_ids` from two different listings to the endpoint — expect 400 (each call must be for one listing's bids). _(not currently enforced — accepts mixed listings as long as viewer owns both; consider whether this is desired)_
- [ ] **decline path**: a bid not selected stays pending; the owner can later counter or decline it manually.

## chunk 4 — proposal phase decision

- [x] decision panel renders on engagement page for phased bids with `bid_phase_payments.status='held'`.
- [x] owner sees two-button decision (move forward / stay at proposal only). consultant sees status only.
- [x] panel updates to "you moved forward" / "you closed out" with released pill after a decision is recorded.
- [ ] **live release**: with a real `charge_id` from a successful proposal-batch capture, click "move forward" → confirm transfer fires, `bid_phase_payments.status='released'`, `transfer_id` set, `bids.move_forward_status='selected'`.
- [ ] **live decline**: same flow but click "stay at proposal only" → same release, `move_forward_status='declined'`.
- [ ] **idempotency**: calling decision endpoint twice — second call returns alreadyReleased and doesn't double-transfer.

## chunk 5 — service phase for selected consultants

- [x] service-phase panel renders for owner on a 'selected' bid with no service phase row yet (cta with fee total).
- [x] service-phase panel renders for consultant on the same state (waiting copy, no actions).
- [x] `/api/stripe/phased/start-service` creates a paymentintent and a `bid_phase_payments` row with phase='service', status='authorizing'.
- [x] held state shows "in escrow" pill + role-specific copy on both sides.
- [ ] **live card test**: click "pay service fee" → 4242 4242 4242 4242 → confirm:
  - paymentintent succeeds on platform balance
  - bid_phase_payments service row flips to held with charge_id
- [ ] **live release on review**: as owner submit a review on a phased engagement with service in escrow → confirm:
  - `transfer.created` fires (drawing from the service charge)
  - bid_phase_payments service row flips to released with transfer_id
- [ ] **retry**: if the first capture fails (decline card), confirm endpoint shouldn't flip the phase row. retry from the cta should re-use the same row (upsert), not create a duplicate.

## chunk 6 — retainer listing config + first-period escrow

- [x] picking 'retainer' on create-listing reveals the terms panel (cadence/period count/fee per period).
- [x] picking 'tentative' hides the fields and clears their values.
- [x] consultant offer panel for retainer listing shows a single input labeled "fee per period", prefilled with `retainer_fee_cents` when terms are fixed.
- [ ] create a real retainer listing via the form (cadence=monthly, periods=3, fee=$500). verify the listings row has correct contract_type/retainer_terms/retainer_cadence/retainer_period_count/retainer_fee_cents.
- [ ] create a retainer listing with terms=tentative — verify retainer_cadence/period_count/fee_cents stay null.
- [ ] consultant submits offer for a retainer listing; owner accepts → first-period PI captures into platform balance (standard escrow flow today).
- [ ] **note**: first-period release happens via the standard work-completed + review flow today. chunk 7 adds the "continue or cancel" decision after that release.

## chunk 7 — retainer continue / cancel decision

- [x] decision panel renders for retainer bids with `payment_status='released'`.
- [x] fixed terms → no form, body shows the cadence/period/fee from listing, "continue retainer" + "close as one-off" buttons.
- [x] tentative terms → cadence/period/fee form appears alongside the same buttons.
- [x] "close as one-off" (no sub yet) → records locally, panel flips to "closed as one-off".
- [x] when a `retainer_subscriptions` row exists with status='active', panel shows "retainer is live · period N of M" + "cancel retainer" button (continue is hidden).
- [x] standard PaymentIntent now passes `setup_future_usage='off_session'` and `/confirm-acceptance` promotes the PM to the customer's default invoice_settings — so subscriptions inherit the card without re-prompting.
- [ ] **live continue (fixed)**: complete a real first-period payment on a fixed-terms retainer listing, release, click "continue retainer". confirm:
  - Stripe subscription created with cadence + period + fee
  - retainer_subscriptions row inserted with status='active' (or 'pending' if subscription is incomplete)
  - subscription has no transfer_data (charges land on platform — release per period is escrow)
- [ ] **live continue (tentative)**: same flow but listing has terms='tentative'. enter cadence/periods/fee in the panel form. confirm subscription uses the entered values.
- [ ] **live cancel**: click "cancel retainer" on an active subscription. confirm Stripe subscription canceled + retainer_subscriptions row flipped to 'canceled'.
- [ ] **webhook follow-up (not in chunk 7)**: invoice.paid → insert bid_phase_payments row (phase='retainer_period', period_index); periods_billed counter advances; auto-cancel subscription when periods_billed >= period_count.

## chunk 8 — convert-to-retainer offer

- [x] released non-retainer engagement (standard or phased) shows the "offer retainer" panel for the owner.
- [x] panel hidden for retainer-contract listings (those use chunk-7's continue / cancel decision).
- [x] click "offer retainer" expands the cadence/periods/fee/message form. submit POSTs `/api/stripe/retainer/offer`.
- [x] db row inserted with status='offered', fee_cents stored, offered_by/at populated, optional message captured.
- [x] consultant view of pending offer shows the terms + accept/decline buttons; the owner's message renders as a quote.
- [x] consultant decline → status='declined'; both sides see the "offer declined" state.
- [ ] **live accept**: as the consultant click "accept retainer" on a real engagement where the owner has a default PM on file. confirm:
  - stripe Product + Price + Subscription created (subscription's metadata.source='offer')
  - row updates to status='active' (or 'pending' if incomplete) with stripe_subscription_id and accepted_at
- [ ] **block accept without PM**: try accept when the owner's customer has no default PM → expect a clean error.
- [ ] **cancel from active offer-sub**: after accepting, the owner's "cancel retainer" button on the offer panel cancels the live subscription.
- [ ] **idempotency**: try to create a second offer while one is already 'offered' / 'pending' / 'active' → expect 409.

## chunk 9 — retainer webhooks + per-period release

- [x] webhook handler added for `invoice.paid` / `invoice.payment_succeeded` — inserts a `bid_phase_payments` row (phase='retainer_period', status='held') and increments `periods_billed`; cancels the subscription when `periods_billed >= period_count`.
- [x] webhook handler added for `customer.subscription.deleted` — flips row to canceled unless already completed.
- [x] webhook handler added for `customer.subscription.updated` — promotes pending → active when stripe confirms.
- [x] webhook handler added for `invoice.payment_failed` — logged for follow-up notifications.
- [x] `/api/stripe/retainer/release-period` endpoint — validates owner + held status, transfers from charge_id, flips row to released. validation chain verified live (404 / alreadyReleased / 500 from fake charge_id all return the right responses).
- [x] periods panel on engagement page lists each period with status pill, amount, and "release" button on held rows (owner only). consultant sees the same list without buttons.
- [ ] **live webhook test**: in stripe dashboard, configure the webhook url to point at the dev/staging server. fire a `invoice.paid` event manually (or use a test clock on a real subscription). confirm:
  - `bid_phase_payments` row inserted with the new period
  - `retainer_subscriptions.periods_billed` incremented
  - if it was the last period, subscription auto-canceled
- [ ] **live release**: on a real period with a real charge_id, click "release". confirm transfer fires + row flips to released.
- [ ] **out-of-order events**: simulate webhook arriving before the start-subscription endpoint finishes (race). confirm the handler logs gracefully and doesn't crash (currently logs + returns; would need a retry queue for production).

## chunk 2+

_(add tests here as chunks land)_
