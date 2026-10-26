# Bids

> A bid is a consultant's offer on a business owner's listing. It has a price, an optional message, and goes through a small state machine before becoming an engagement.

## The lifecycle

```
draft  →  pending  →  accepted  →  engagement begins
                  ↘  countered  →  consultant accepts counter  →  pending again
                  ↘  declined / withdrawn
```

## Submitting a bid (consultant)

1. Open a listing
2. Enter your offer amount (in USD)
3. (Optional) add a short message — up to 250 chars — to introduce yourself
4. Click **Submit offer**

If your Stripe account isn't fully active, the submit button stays disabled. Set up payouts first ([Stripe onboarding](./stripe-onboarding.md)).

Once submitted, the bid is read-only on your end. You can't edit it; you can only wait for the owner's response.

## What the owner sees

Every bid on their listing appears in a side rail, with the consultant's:
- Avatar + name
- Rating (if any reviews exist)
- LinkedIn link (if shared)
- Bid amount + message
- Portfolio / proposal samples (if attached)

The owner can:
- **Accept** — opens a Stripe payment modal; on confirmation, the bid moves to `accepted` and the engagement begins
- **Decline** — closes this bid; the consultant gets a notification
- **Counter** — proposes a different amount with a short note; the bid moves to `countered`

## Counter-offers

Each owner can counter up to three times per listing across all bids. Consultants accept a counter by submitting a new bid at the proposed amount; this moves the bid back to `pending` for final acceptance.

(The in-page "accept counter" button on the listing was removed — for now, accept a counter by responding through your inbox.)

## States reference

| State | Meaning |
|---|---|
| `pending` | Consultant submitted, owner hasn't acted yet |
| `accepted` | Owner paid, engagement is live |
| `countered` | Owner proposed a different amount |
| `declined` | Owner rejected |
| `withdrawn` | Consultant withdrew before acceptance |

## Acceptance triggers payment

The moment a bid is accepted, the owner's card is charged and the funds are routed to the consultant's Stripe account. See [payments & payouts](./payments-and-payouts.md) for the money flow.

## FAQ

- **Can I edit my bid?** No — submissions are final. If you want to change the amount, withdraw and re-bid (where supported).
- **Can I bid on the same listing twice?** No, one bid per consultant per listing.
- **What happens to my bid if the owner closes the listing?** It auto-resolves to `declined` and you get a notification.
- **Why is my submit button disabled?** You haven't finished Stripe payout setup. See [Stripe onboarding](./stripe-onboarding.md).
