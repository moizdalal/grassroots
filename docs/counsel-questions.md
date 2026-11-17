# questions for counsel (not published)

Questions that belong in the legal review but shouldn't appear on a public page. The notes that used to sit inline on `/terms` as `[counsel: …]` markers were removed from the live page on 2026-11-10 and kept in a local counsel-review doc. Never put counsel notes back on a public page.

## free engagements (consultant-only feature)

Consultants can offer to do a one-time job, or a phased proposal, for $0. Accepting a $0 offer skips Stripe entirely: no charge, no payout, nothing reported for tax. The engagement otherwise runs normally (kickoff, delivery, 14-day review, reviews). Businesses are never told the option exists; it's only mentioned on the consultant's offer screen.

1. **Unpaid work for for-profit businesses.** Consultants are independent contractors doing defined projects, mostly college students. Does unpaid project work for a for-profit business create any FLSA or Florida wage-and-hour exposure (for grassroots or the business), given the "primary beneficiary" test used for unpaid internships? Is a disclaimer or eligibility rule needed?
2. **Non-circumvention.** Terms §11 now says it applies "to every engagement whatever its price," to stop a $0 engagement being paid off-platform. Is that enough, or should free engagements be called out explicitly?
3. **Refund policy.** Free engagements have no payment, so the refund and report-a-problem process (§7) doesn't apply. Does §7 need a sentence saying it applies only to payments, or is that implied?
4. **Consultants without US work authorization.** The US-person attestation (payout setup) is only required when money changes hands, so a consultant who isn't authorized to work in the US (for example, an F-1 student without CPT/OPT) can still make and complete free offers. Terms §4 now ties the authorization promise to being paid, not to submitting an offer. Is unpaid project work for a for-profit business by an F-1/J-1 student permissible, or could USCIS treat it as unauthorized employment (it isn't classic volunteering for a nonprofit)? Should we add a consultant-only notice on the free-offer option, or an eligibility rule?

## US-person payouts and 1099-K (PR #43)

Consultants confirm on `/payouts.html` that they're a US person for tax purposes before they can set up payouts or be paid. Free work needs no confirmation.

1. **Verification duty (Terms §4).** Confirm Grassroots has no duty to verify work authorization as a venue that does not itself obtain the labor (8 U.S.C. § 1324a(a)(4)). Review the payout attestation wording in `public/payouts.html`.
2. **1099-K vs 1099-NEC (Terms §10, for the CPA).** Confirm 1099-K fits the escrow flow, which filer type applies (PSE), whether the single-member LLC's EIN can be the filer, and that Stripe tax forms for Connect is turned on now that payments are live.
