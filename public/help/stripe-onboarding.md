# stripe onboarding

> consultants need a verified stripe account before they can submit bids. grassroots uses stripe's **embedded onboarding** — you stay on grassroots the whole time, you just fill out a few stripe-rendered forms.

## who needs this

every consultant. business owners don't need stripe onboarding (they just pay with a card).

## what stripe collects

stripe asks for the same information a w-9 would, plus a bank account:

- legal name
- date of birth
- home address
- social security number (or itin)
- (optional, only if you're a registered business) ein
- a us bank account (routing + account number)
- acceptance of stripe's terms of service

grassroots **never sees this data** — it goes directly from your browser to stripe.

## how to start

1. sign in as a consultant
2. open **settings → payout** (or visit `/payouts.html`)
3. fill out the form — stripe walks you through it step by step
4. link a bank — stripe uses financial connections (log in to your bank in-line) or accepts manual routing + account numbers
5. when stripe accepts, your account flips to **active**

once active, you can bid on listings.

## states you may see

| status | meaning | what to do |
|---|---|---|
| **not started** | no stripe account yet | click "set up payouts" |
| **finish setting up your account** | started but missing info | fill the listed items in the form |
| **verification in progress** | submitted, stripe is reviewing | wait — usually minutes, sometimes a day |
| **payouts active** | verified, ready to receive bids | nothing — you're set |

if stripe needs more info days later (e.g., a follow-up id document), the status flips back to "finish setting up" and you'll get a notification.

## taxes & 1099s

stripe issues a 1099-nec automatically each january for any consultant who earned **$600 or more** through grassroots in the prior year. it's emailed to the address on your stripe account and e-filed with the irs.

you don't need to download a w-9 or upload anything — the data stripe collected during onboarding is what they use to generate the 1099.

## updating your info

open `/payouts.html` any time after onboarding to:
- change your bank account
- update your address or tax id
- see past payouts and a running balance

the **account-management** panel on that page is stripe-rendered and reflects whatever's currently on file.

## faq

- **i'm not a us resident — can i still bid?** not yet. stripe connect on grassroots is us-only for now.
- **do i need an llc / business entity?** no. stripe treats most consultants as "individual / sole proprietor," which is fine.
- **why did stripe ask for my ssn?** the irs requires a tax id for any us payee receiving $600+ per year. stripe collects it once at onboarding so you don't get a 1099 mailed to the wrong address.
- **what if i forget to set up payouts and submit a bid?** you can't — the submit button is disabled until your stripe account reads `active`.
