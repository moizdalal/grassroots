# Payments & payouts

> Grassroots charges the business, holds the money, and pays the consultant when the business releases it. Stripe processes every card and payout. Our servers never see card or bank numbers.

This page summarizes [sections 6–10 of the terms](/terms.html#payments). If anything here differs, the terms win.

## The flow at a glance

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

Grassroots is the merchant of record. The charge appears on your card statement from Grassroots, not from the consultant or Stripe. The consultant appoints Grassroots as their agent to collect payment, so paying Grassroots counts as paying the consultant.

Grassroots is not an escrow company or a bank. Held money sits in Grassroots' own Stripe balance until it's released or refunded.

## What business owners pay

1. You accept a consultant's offer.
2. A Stripe payment form opens. You pay the offer price. No fees are added on top.
3. Grassroots holds the payment while the work happens.
4. The consultant marks the work delivered.
5. You mark the work complete and submit your review. That releases the payment. If you do nothing for 14 days after delivery, it releases automatically.

Your rating doesn't change what the consultant is paid. The review is required, the score isn't.

Your card is saved with Stripe so retainer periods and future payments you approve can be charged without re-entering it. You can remove it any time.

## Pricing models

| Model | When you're charged | When it's released |
|---|---|---|
| **One-time** | Full offer at acceptance | When you mark it complete and review, or 14 days after delivery |
| **Phased: proposal fee** | At acceptance, for one or more consultants at once | Once you've met and decided whether to move forward, either way |
| **Phased: service fee** | When you move forward with a consultant | When you mark it complete and review, or 14 days after delivery |
| **Retainer** | At the start of each period, to your saved card | When you release it, right away if auto-release is on, or 14 days after the period ends |

The consultant marks the work delivered when it's done. From then you have 14 days to review before it releases automatically. Proposal fees only release when you decide. Anything still held 90 days after the charge goes to our team for a manual review instead.

Retainers stop billing after the number of periods in the offer. You can change the length, but not below the periods already paid. Either side can end it after the current period.

## What consultants receive

1. You finish Stripe payout setup before you can submit offers. See [Stripe onboarding](./stripe-onboarding.md).
2. When the business pays, the money is held by Grassroots. It isn't in your Stripe balance yet.
3. When the work is done, mark it delivered on the engagement page. The business has 14 days to review. Retainer periods don't need marking: the 14 days start when the period ends.
4. When it's released, Grassroots transfers your payout to your connected account.
5. Stripe pays out to your bank on your payout schedule, usually about 2 business days.

Your payout is the offer minus card processing (**2.9% + $0.30** per payment) and the platform fee: **10% of the part above $10**, **5% during launch**. There's no platform fee on the first $10. The offer screen shows your take-home before you send it. If Stripe charges more on a card (international, amex), Grassroots absorbs the difference.

## Fees

| Who | Fee |
|---|---|
| Business | None. You pay the offer price, all-in. |
| Consultant | Card processing (2.9% + $0.30) and a 10% platform fee on the part above $10 (5% during launch), both deducted from the payout |

We'll give at least 30 days' notice before raising a fee or ending the launch rate.

## Payment states

Every bid carries a `payment_status`:

| State | Meaning |
|---|---|
| `unpaid` | Offer submitted, not accepted yet |
| `authorizing` | Business is in the payment form |
| `held` | Card charged, Grassroots is holding the payment |
| `released` | Transferred to the consultant. Final. |
| `refunded` | Returned to the business's card |
| `failed` | Card declined or Stripe error |

## Refunds

This is the same policy as [section 7 of the terms](/terms.html#refunds). If anything here differs, the terms win.

1. **Within 24 hours (one-time jobs):** cancel from the engagement page for a full refund. This only works while the payment is still held.
2. **After 24 hours, before release:** report a problem from the engagement page during your 14-day review, or email [moiz@grassroots-marketplace.com](mailto:moiz@grassroots-marketplace.com) with the bid ID. This is also the only route for proposal fees, service fees, and retainer periods. The payment locks while we review. We then decide one of three things:
   - **The work meets scope:** it's released to the consultant.
   - **It falls short but can be fixed:** the consultant has 5 days to redo it once, or give the money back. A give-back refunds you minus card-processing fees. No answer in 5 days counts as a give-back.
   - **Scope was breached:** you get a full refund. The consultant gets nothing.
3. **After release:** no refund through Grassroots. The payment is final. Any return is between you and the consultant.
4. **Retainers:** a period that's already been charged isn't refunded when either side ends the retainer. There's no proration.
5. **14-day review window:** once the consultant marks the work delivered, you have 14 days to release it, request changes, or report a problem. After that it releases to the consultant automatically. You get a heads-up on day 7. For retainers, each period's 14 days start when the period ends.

Refunds land on your original card, usually within 5–10 business days.

## Chargebacks

Contact us before disputing a charge with your bank. While a card dispute is open, we don't release that payment. If a dispute is lost after the payment was released, Grassroots recovers the amount from the consultant's connected account or future payouts.

## Taxes & 1099s

Grassroots, through Stripe, issues tax forms to consultants when the law requires it. Stripe doesn't do this on its own. See [Stripe onboarding](./stripe-onboarding.md#taxes--1099s).

## FAQ

- **Can I pay in installments?** Use a phased listing or a retainer. A one-time job is charged in full at acceptance.
- **What cards work?** Anything Stripe accepts: visa, mastercard, amex, discover, plus apple pay and Google pay on supported devices.
- **Does Grassroots take a cut?** Yes, 10% of the part of each payment above $10, 5% during launch. It comes out of the consultant's payout, so businesses pay only the offer price.
- **Is there a minimum?** Yes. Payments through Grassroots are at least $10.
- **Is this escrow?** No. Grassroots holds the payment in its own Stripe balance and releases it under the terms. No licensed escrow agent is involved.
