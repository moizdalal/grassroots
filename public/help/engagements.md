# Engagements

> An engagement is the active period after a bid is accepted. It covers the kickoff meeting, the working window, the final review, and closing the loop on payment.

## The lifecycle

```
bid accepted  →  kickoff scheduling  →  work in progress  →  review  →  released
```

Each stage has its own UI on the engagement page (`/engagement.html?bid=...`).

## The kickoff meeting

The kickoff is a single video / call between the owner and the consultant — it sets expectations, confirms scope, and starts the clock.

### How it gets scheduled

1. **Owner sets meeting length** (default 30 min, options: 30 / 60 / 90)
2. **Owner marks availability** for the upcoming week (click-and-drag on the calendar)
3. **Consultant picks one time** inside the highlighted slots — they can't pick something the owner didn't offer, and can't change the duration
4. **Calendar invite generated** (`.ics` file) — both sides can download and add to their calendar

Once the time is confirmed, the engagement status flips to `scheduled`.

## Working window

Between the kickoff and the wrap, the engagement page has:

- A **messaging thread** between owner and consultant (separate from the bid-time chat — see [messaging](./messaging.md))
- **Meeting summary** — confirmed time + calendar invite download
- **Owner actions** — review other offers (does nothing destructive), close opportunity, work-completed button

No enforced milestones today. Trust + communication carries the work.

## Wrapping up

When the work is delivered, the **business owner** has to do two things to close the engagement:

1. Submit a five-dimension review (see [reviews & ratings](./reviews-and-ratings.md))
2. Click **Work completed**

Both are required. The review can't be edited later, so save the click for when you're actually done.

## What the consultant sees

- Live chat during the engagement
- The meeting time and calendar invite
- A read-only "engagement closing" status once the owner submits their review
- A "released" notification when the bid hits its final state

Consultants don't review the business owner today.

## States reference

| Status | Meaning |
|---|---|
| `awaiting_owner` | Bid accepted, owner needs to mark availability |
| `awaiting_consultant` | Owner shared availability, consultant needs to pick a time |
| `scheduled` | Meeting time locked in |
| `completed` | Owner submitted review |

## Cancellations

If the engagement needs to stop early, the [refund policy](./payments-and-payouts.md#refunds) applies:

- Within 24 hours of paying for a one-time job, the owner can cancel from the engagement page for a full refund
- After that, while the payment is still held, email [moiz@grassroots-marketplace.com](mailto:moiz@grassroots-marketplace.com) with the bid ID. We review it and release it, send it back for a redo, or refund you
- Once the payment is released, it's final

## FAQ

- **Can we reschedule the kickoff?** The owner can re-mark availability to nudge the consultant to a new time. There's no formal "reschedule" button yet.
- **What if the consultant ghosts?** Contact us while the payment is still held. We'll review it and refund what wasn't delivered.
- **Can I have multiple active engagements with the same business?** Yes — they'd post separate listings, and you'd bid on each.
