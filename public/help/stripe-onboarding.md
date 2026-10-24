# Stripe onboarding

> Consultants need a verified Stripe account before they can submit bids. Grassroots uses Stripe's **embedded onboarding** — you stay on Grassroots the whole time, you just fill out a few stripe-rendered forms.

## Who needs this

Every consultant. Business owners don't need Stripe onboarding (they just pay with a card).

## What Stripe collects

Stripe asks for the same information a w-9 would, plus a bank account:

- Legal name
- Date of birth
- Home address
- Social security number (or itin)
- (Optional, only if you're a registered business) EIN
- A us bank account (routing + account number)
- Acceptance of Stripe's terms of service

Grassroots **never sees this data** — it goes directly from your browser to Stripe.

## How to start

1. Sign in as a consultant
2. Open **settings → payout** (or visit `/payouts.html`)
3. Fill out the form — Stripe walks you through it step by step
4. Link a bank — Stripe uses financial connections (log in to your bank in-line) or accepts manual routing + account numbers
5. When Stripe accepts, your account flips to **active**

Once active, you can bid on listings.

## States you may see

| Status | Meaning | What to do |
|---|---|---|
| **Not started** | No Stripe account yet | Click "set up payouts" |
| **Finish setting up your account** | Started but missing info | Fill the listed items in the form |
| **Verification in progress** | Submitted, Stripe is reviewing | Wait — usually minutes, sometimes a day |
| **Payouts active** | Verified, ready to receive bids | Nothing — you're set |

If Stripe needs more info days later (e.g., a follow-up ID document), the status flips back to "finish setting up" and you'll get a notification.

## Taxes & 1099s

Grassroots, through Stripe, issues tax forms (like a 1099-k or 1099-nec) to consultants who cross the irs reporting thresholds. Stripe doesn't send these on its own. We'll confirm the form and thresholds with our accountant before live payments start.

You don't need to download a w-9 or upload anything. The tax info Stripe collects during onboarding is what's used.

You owe income tax and self-employment tax on what you earn here, whether or not you get a form. This isn't tax advice.

## Updating your info

Open `/payouts.html` any time after onboarding to:
- Change your bank account
- Update your address or tax ID
- See past payouts and a running balance

The **account-management** panel on that page is stripe-rendered and reflects whatever's currently on file.

## FAQ

- **I'm not a us resident — can I still bid?** Not yet. Stripe Connect on Grassroots is us-only for now.
- **Do I need an LLC / business entity?** No. Stripe treats most consultants as "individual / sole proprietor," which is fine.
- **Why did Stripe ask for my SSN?** Payment platforms must collect a tax ID to report payee earnings to the irs. Stripe collects it once at onboarding.
- **What if I forget to set up payouts and submit a bid?** You can't — the submit button is disabled until your Stripe account reads `active`.
