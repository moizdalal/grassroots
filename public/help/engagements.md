# engagements

> an engagement is the active period after a bid is accepted. it covers the kickoff meeting, the working window, the final review, and closing the loop on payment.

## the lifecycle

```
bid accepted  →  kickoff scheduling  →  work in progress  →  review  →  released
```

each stage has its own UI on the engagement page (`/engagement.html?bid=...`).

## the kickoff meeting

the kickoff is a single video / call between the owner and the consultant — it sets expectations, confirms scope, and starts the clock.

### how it gets scheduled

1. **owner sets meeting length** (default 30 min, options: 30 / 60 / 90)
2. **owner marks availability** for the upcoming week (click-and-drag on the calendar)
3. **consultant picks one time** inside the highlighted slots — they can't pick something the owner didn't offer, and can't change the duration
4. **calendar invite generated** (`.ics` file) — both sides can download and add to their calendar

once the time is confirmed, the engagement status flips to `scheduled`.

## working window

between the kickoff and the wrap, the engagement page has:

- a **messaging thread** between owner and consultant (separate from the bid-time chat — see [messaging](./messaging.md))
- **meeting summary** — confirmed time + calendar invite download
- **owner actions** — review other offers (does nothing destructive), close opportunity, work-completed button

no enforced milestones today. trust + communication carries the work.

## wrapping up

when the work is delivered, the **business owner** has to do two things to close the engagement:

1. submit a five-dimension review (see [reviews & ratings](./reviews-and-ratings.md))
2. click **work completed**

both are required. the review can't be edited later, so save the click for when you're actually done.

## what the consultant sees

- live chat during the engagement
- the meeting time and calendar invite
- a read-only "engagement closing" status once the owner submits their review
- a "released" notification when the bid hits its final state

consultants don't review the business owner today.

## states reference

| status | meaning |
|---|---|
| `awaiting_owner` | bid accepted, owner needs to mark availability |
| `awaiting_consultant` | owner shared availability, consultant needs to pick a time |
| `scheduled` | meeting time locked in |
| `completed` | owner submitted review |

## cancellations

if the engagement needs to stop early, the [refund policy](./payments-and-payouts.md#refunds) applies:

- within 24 hours of paying for a one-time job, the owner can cancel from the engagement page for a full refund
- after that, while the payment is still held, email [moiz@grassroots-marketplace.com](mailto:moiz@grassroots-marketplace.com) with the bid id. we review it and release it, send it back for a redo, or refund you
- once the payment is released, it's final

## faq

- **can we reschedule the kickoff?** the owner can re-mark availability to nudge the consultant to a new time. there's no formal "reschedule" button yet.
- **what if the consultant ghosts?** contact us while the payment is still held. we'll review it and refund what wasn't delivered.
- **can i have multiple active engagements with the same business?** yes — they'd post separate listings, and you'd bid on each.
