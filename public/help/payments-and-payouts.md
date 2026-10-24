# payments & payouts

> grassroots charges the business, holds the money, and pays the consultant when the business releases it. stripe processes every card and payout. our servers never see card or bank numbers.

this page summarizes [sections 6–10 of the terms](/terms.html#payments). if anything here differs, the terms win.

## the flow at a glance

```
business accepts offer  →  card charged by grassroots
                            ↓
                            payment held in grassroots' stripe balance
                            ↓
business marks work complete + submits review  →  payment released
                            ↓
                            stripe transfer to the consultant's connected account
                            ↓
                            stripe pays out to the consultant's bank
```

grassroots is the merchant of record. the charge appears on your card statement from grassroots, not from the consultant or stripe. the consultant appoints grassroots as their agent to collect payment, so paying grassroots counts as paying the consultant.

grassroots is not an escrow company or a bank. held money sits in grassroots' own stripe balance until it's released or refunded.

## what business owners pay

1. you accept a consultant's offer.
2. a stripe payment form opens. you pay the offer price. no fees are added on top.
3. grassroots holds the payment while the work happens.
4. the consultant marks the work delivered.
5. you mark the work complete and submit your review. that releases the payment. if you do nothing for 14 days after delivery, it releases automatically.

your rating doesn't change what the consultant is paid. the review is required, the score isn't.

your card is saved with stripe so retainer periods and future payments you approve can be charged without re-entering it. you can remove it any time.

## pricing models

| model | when you're charged | when it's released |
|---|---|---|
| **one-time** | full offer at acceptance | when you mark it complete and review, or 14 days after delivery |
| **phased: proposal fee** | at acceptance, for one or more consultants at once | once you've met and decided whether to move forward, either way |
| **phased: service fee** | when you move forward with a consultant | when you mark it complete and review, or 14 days after delivery |
| **retainer** | at the start of each period, to your saved card | when you release it, right away if auto-release is on, or 14 days after the period ends |

the consultant marks the work delivered when it's done. from then you have 14 days to review before it releases automatically. proposal fees only release when you decide. anything still held 90 days after the charge goes to our team for a manual review instead.

retainers stop billing after the number of periods in the offer. you can change the length, but not below the periods already paid. either side can end it after the current period.

## what consultants receive

1. you finish stripe payout setup before you can submit offers. see [stripe onboarding](./stripe-onboarding.md).
2. when the business pays, the money is held by grassroots. it isn't in your stripe balance yet.
3. when the work is done, mark it delivered on the engagement page. the business has 14 days to review. retainer periods don't need marking: the 14 days start when the period ends.
4. when it's released, grassroots transfers your payout to your connected account.
5. stripe pays out to your bank on your payout schedule, usually about 2 business days.

your payout is the offer minus card processing (**2.9% + $0.30** per payment) and the platform fee: **10% of the part above $10**, **5% during launch**. there's no platform fee on the first $10. the offer screen shows your take-home before you send it. if stripe charges more on a card (international, amex), grassroots absorbs the difference.

## fees

| who | fee |
|---|---|
| business | none. you pay the offer price, all-in. |
| consultant | card processing (2.9% + $0.30) and a 10% platform fee on the part above $10 (5% during launch), both deducted from the payout |

we'll give at least 30 days' notice before raising a fee or ending the launch rate.

## payment states

every bid carries a `payment_status`:

| state | meaning |
|---|---|
| `unpaid` | offer submitted, not accepted yet |
| `authorizing` | business is in the payment form |
| `held` | card charged, grassroots is holding the payment |
| `released` | transferred to the consultant. final. |
| `refunded` | returned to the business's card |
| `failed` | card declined or stripe error |

## refunds

this is the same policy as [section 7 of the terms](/terms.html#refunds). if anything here differs, the terms win.

1. **within 24 hours (one-time jobs):** cancel from the engagement page for a full refund. this only works while the payment is still held.
2. **after 24 hours, before release:** report a problem from the engagement page during your 14-day review, or email [moiz@grassroots-marketplace.com](mailto:moiz@grassroots-marketplace.com) with the bid id. this is also the only route for proposal fees, service fees, and retainer periods. the payment locks while we review. we then decide one of three things:
   - **the work meets scope:** it's released to the consultant.
   - **it falls short but can be fixed:** the consultant has 5 days to redo it once, or give the money back. a give-back refunds you minus card-processing fees. no answer in 5 days counts as a give-back.
   - **scope was breached:** you get a full refund. the consultant gets nothing.
3. **after release:** no refund through grassroots. the payment is final. any return is between you and the consultant.
4. **retainers:** a period that's already been charged isn't refunded when either side ends the retainer. there's no proration.
5. **14-day review window:** once the consultant marks the work delivered, you have 14 days to release it, request changes, or report a problem. after that it releases to the consultant automatically. you get a heads-up on day 7. for retainers, each period's 14 days start when the period ends.

refunds land on your original card, usually within 5–10 business days.

## chargebacks

contact us before disputing a charge with your bank. while a card dispute is open, we don't release that payment. if a dispute is lost after the payment was released, grassroots recovers the amount from the consultant's connected account or future payouts.

## taxes & 1099s

grassroots, through stripe, issues tax forms to consultants when the law requires it. stripe doesn't do this on its own. see [stripe onboarding](./stripe-onboarding.md#taxes--1099s).

## faq

- **can i pay in installments?** use a phased listing or a retainer. a one-time job is charged in full at acceptance.
- **what cards work?** anything stripe accepts: visa, mastercard, amex, discover, plus apple pay and google pay on supported devices.
- **does grassroots take a cut?** yes, 10% of the part of each payment above $10, 5% during launch. it comes out of the consultant's payout, so businesses pay only the offer price.
- **is there a minimum?** yes. payments through grassroots are at least $10.
- **is this escrow?** no. grassroots holds the payment in its own stripe balance and releases it under the terms. no licensed escrow agent is involved.
