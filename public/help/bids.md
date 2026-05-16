# bids

> a bid is a consultant's offer on a business owner's listing. it has a price, an optional message, and goes through a small state machine before becoming an engagement.

## the lifecycle

```
draft  →  pending  →  accepted  →  engagement begins
                  ↘  countered  →  consultant accepts counter  →  pending again
                  ↘  declined / withdrawn
```

## submitting a bid (consultant)

1. open a listing
2. enter your offer amount (in usd)
3. (optional) add a short message — up to 250 chars — to introduce yourself
4. click **submit offer**

if your stripe account isn't fully active, the submit button stays disabled. set up payouts first ([stripe onboarding](./stripe-onboarding.md)).

once submitted, the bid is read-only on your end. you can't edit it; you can only wait for the owner's response.

## what the owner sees

every bid on their listing appears in a side rail, with the consultant's:
- avatar + name
- rating (if any reviews exist)
- linkedin link (if shared)
- bid amount + message
- portfolio / proposal samples (if attached)

the owner can:
- **accept** — opens a stripe payment modal; on confirmation, the bid moves to `accepted` and the engagement begins
- **decline** — closes this bid; the consultant gets a notification
- **counter** — proposes a different amount with a short note; the bid moves to `countered`

## counter-offers

each owner can counter up to three times per listing across all bids. consultants accept a counter by submitting a new bid at the proposed amount; this moves the bid back to `pending` for final acceptance.

(the in-page "accept counter" button on the listing was removed — for now, accept a counter by responding through your inbox.)

## states reference

| state | meaning |
|---|---|
| `pending` | consultant submitted, owner hasn't acted yet |
| `accepted` | owner paid, engagement is live |
| `countered` | owner proposed a different amount |
| `declined` | owner rejected |
| `withdrawn` | consultant withdrew before acceptance |

## acceptance triggers payment

the moment a bid is accepted, the owner's card is charged and the funds are routed to the consultant's stripe account. see [payments & payouts](./payments-and-payouts.md) for the money flow.

## faq

- **can i edit my bid?** no — submissions are final. if you want to change the amount, withdraw and re-bid (where supported).
- **can i bid on the same listing twice?** no, one bid per consultant per listing.
- **what happens to my bid if the owner closes the listing?** it auto-resolves to `declined` and you get a notification.
- **why is my submit button disabled?** you haven't finished stripe payout setup. see [stripe onboarding](./stripe-onboarding.md).
