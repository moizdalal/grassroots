# payments & payouts

> grassroots uses **stripe connect** to move money from business owners to consultants. you don't enter card details on grassroots — stripe handles that and our servers never see them.

## the flow at a glance

```
owner accepts bid  →  card charged  →  funds routed to consultant
                                         (held until review)
                                         ↓
owner submits review  →  engagement marked released
                          ↓
                          consultant's stripe payout schedule kicks in
                          (typically 2 business days to bank)
```

## what business owners pay

1. you accept a consultant's bid
2. a stripe payment modal opens — enter card details there
3. the bid amount is captured immediately; **funds route directly to the consultant's connected stripe account** (no platform middleman)
4. you finish the engagement and submit a review
5. grassroots marks the bid `released` — your obligation is done

stripe is the merchant of record on your statement. line item reads "grassroots — [listing title]".

## what consultants receive

1. funds land on your connect account's **pending balance** the moment the owner pays
2. once the owner submits their review, the bid flips to `released`
3. stripe pays out on its normal cadence (default: 2 business days to your linked bank)
4. you can change payout cadence inside your stripe-embedded settings (daily, weekly, monthly)

if you haven't completed payout setup, you **cannot receive bids** — the submit-offer button is disabled until stripe shows your account as fully active.

## bid payment states

every bid carries a `payment_status` field. it moves like this:

| state | meaning |
|---|---|
| `unpaid` | bid submitted, owner hasn't accepted yet |
| `authorizing` | owner is in the payment modal — card not yet captured |
| `held` | card captured, funds routed to consultant's pending balance, engagement underway |
| `released` | owner submitted their review, grassroots considers the engagement closed |
| `refunded` | (rare) owner-initiated refund; funds pulled back from consultant |
| `failed` | card declined or stripe error |

## refunds

refunds are owner-initiated and only available before the engagement is marked released. once `released`, the consultant has been credited and the money is no longer recoverable from grassroots — you'd need to work out a return directly with the consultant.

we'll publish the formal refund window and dispute process here as policy when it lands.

## why stripe handles it

- we never store card numbers or bank info — fewer compliance obligations and a smaller blast radius if grassroots is ever breached
- stripe issues 1099s to consultants automatically each january (no paperwork from you)
- payouts use stripe's existing global rails, so consultants in different states get paid the same way

## faq

- **can i pay in installments?** not currently. the full bid amount is charged at acceptance.
- **what cards work?** anything stripe accepts in your region: visa, mastercard, amex, discover, plus apple pay / google pay on supported devices.
- **does grassroots take a cut?** not yet. for the current period the platform fee is 0% — consultants receive 100% of the bid amount.
