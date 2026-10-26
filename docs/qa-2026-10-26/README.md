# End-to-end QA report — 2026-10-26

A full engagement run on the live site (www.grassroots-marketplace.com) with real browser sessions for both roles. Stripe in sandbox.

- **Business:** `testbiz@gmail.com`
- **Consultant:** `test@gmail.com`
- **Listing:** "QA test – delete me: weekend flyer design for cafe" (`5187739a-…`), now `completed`
- **Bid:** `7d82f719-…`

## What was run

| Step | Who | Result |
|---|---|---|
| Sign in | Both | Works. Business lands on dashboard in ~8 s. |
| Create listing (3 steps, validation, min > max budget, confirm modal) | Business | Works, but category search is broken (see H3). |
| Listing with an attachment | Business | **Fails every time** (C2). |
| Browse marketplace, open listing | Consultant | Works. |
| Offer $100 with pitch + 5-day timeline, fee preview | Consultant | Works. Fee breakdown layout breaks. |
| Counter (tried $5, then $150) | Business | $5 rejected. $150 accepted, though it's above the ask and the listing max (M4). |
| Accept counter with a note | Consultant | Works. The note is never shown to the business. |
| Accept + pay $150 with test card 4242 | Business | Works. Modal took ~8 s to open and ~9.5 s to confirm. |
| Share kickoff availability, pick a slot, .ics invite | Both | Works, but times have no timezone (H5). |
| Mark delivered (bad link, then good link) | Consultant | Works. |
| Request changes, then re-deliver | Both | Works. |
| Review consultant, which releases payment | Business | Works. Transfer created and listing auto-completed. Page shows stale state (H6). |
| $138.35 pending in Stripe balance | Consultant | Matches the fee preview exactly. |
| Review business | Consultant | Works. |
| Notifications, inbox, engagements list, dashboards | Both | Several gaps (below). |
| Mobile (390 px), dark-forest and dark themes | Both | Mobile is broken everywhere (C1). Dark themes mostly fine. |

Not exercised live: refunds, report-a-problem/support outcomes, phased and retainer contracts, free ($0) offers, the 14-day auto-release.

---

## Critical — fix before real users

**C1. Every page is unusable on a phone.**
At 390 px wide, the side nav never collapses. It takes ~255 px and squeezes the content into a ~100 px column. Marketplace cards are clipped and text wraps one word per line. Every page measured scrolls sideways (scroll width 439–620 px on a 390 px screen): marketplace, listing, engagement, both dashboards, create listing. Students will mostly be on phones.
Screenshots: `mobile-marketplace.jpg`, `mobile-engagement.jpg`.

**C2. Posting a listing with any attachment fails and deletes the listing.**
The `listing_attachments` storage bucket doesn't exist, so the upload returns `Bucket not found`. `create-listing.js` then rolls the listing back and shows the raw text "Bucket not found" three times. Even with the bucket in place, the follow-up `update({ attachments })` would fail: `listings.attachments` isn't a column in production. That missing column is also why every listing page load fires two failing 400 queries before its fallback (28 failed requests in this run).

**C3. The auto-release and every Stripe webhook are still off in production.**
- `GET /api/cron/auto-release` returns `CRON_SECRET not configured`.
- `/api/webhooks/stripe` returns `Webhook secret not configured`.

The UI tells both sides "Review it by Nov 9. After that, Grassroots releases it", but nothing will release it. The day-7 "review closes" reminder won't send either. This is known in CLAUDE.md, but it's now user-visible copy promising behavior that doesn't exist.

**C4. A business can refund after receiving the work.**
"Request refund" stays visible after the consultant marks the work delivered. `/api/stripe/refund-payment` only checks the 24 h window from `paid_at`, never `delivered_at`. A fast consultant who delivers in a few hours can be refunded to $0 with no recourse. The button even stays on screen after the payment was released, until reload.

**C5. The business is never told a new offer came in.**
There's no notification type for a new offer anywhere in the code. `listing.js` inserts the bid and notifies no one. The business only finds out by opening the dashboard. There is also **no email for any engagement event**: `sendEmail` is only wired to account deletion/export. So nobody learns about offers, counters, acceptance, delivery, change requests or payment unless they're already on the site.

## High

**H1. The notifications page takes ~22 s to load, every time.**
`notifications.html` sets `data-loading="true"` on `#gate`, and `notifications.js` only clears its text. It never flips `data-loading` or hides the gate, so the loader overlay waits for its 20 s safety timeout. One-line fix: `gate.hidden = true` after load.

**H2. Every consultant sees "Set up payouts before your first offer comes in", even when fully set up.**
`.bza__banner { display: flex }` in `field-office.css` beats the `hidden` attribute. The JS logic is correct, but the banner is always visible. Seen on every consultant dashboard load, including right after a payout landed.
Screenshot: `consultant-dashboard-payouts-banner.jpg`.

**H3. Category search on create-listing never matches.**
`renderCategoryDropdown` lowercases the query and compares it to capitalized labels (`"Marketing".includes("marketing")` is false). Typing "marketing" or "Marketing" gives "No matches". Only mid-word fragments like "arketing" work. This likely broke when labels moved to sentence case. Also, there's no design category, so a flyer job had to go under Branding.

**H4. "Open the conversation" is a dead end until someone has already messaged.**
`inbox.js` `maybeOpenFromHash` only selects a thread that already exists. From a fresh engagement, the business lands on "No conversations yet" with no way to write to the consultant they just paid. Only consultants can start threads, via "Have a question?" on the listing.
Screenshot: `open-conversation-dead-end.jpg`.

**H5. Kickoff times have no timezone.**
Availability is stored as grid indices (`{"slots":["2-4",…]}`), and each viewer converts them to their own local time. A business in New York marking 10:00 and a consultant in LA picking "10:00" are three hours apart. The page and notification never show a timezone. The .ics also has no location or meeting link.

**H6. The engagement page goes stale after release.**
After "Submit review", the toast says "Payment released". The panel still says "In review", "Review it by Nov 9" and "Request refund", and shows "Request changes / Report a problem" buttons. The header still says "Listing status: Open" and "No ratings yet". On reload, the payment panel disappears entirely for both sides. Neither side gets a "released $150 / you received $138.35 on Oct 26" record on the engagement.
Screenshot: `stale-state-after-release.jpg`.

**H7. Releasing $150 has no confirmation.**
The irreversible release is a side effect of "Submit review", with no "this pays the consultant" step. The delivery panel also has no "Approve and release" action, only Request changes / Report a problem / Contact support. The business has to discover that the review is how you pay.

**H8. The engagements list misclassifies work.**
The consultant's foot-traffic job was paid out in May (`payment_status = released`, listing `completed`). It still shows under "Current" with "Your move: pick a kickoff time". `engagements.js` treats only `schedule.status = completed` as past. The just-finished QA job isn't listed at all. Businesses get "Engagements is a consultant-only view for now" and have no list of their active hires.
Screenshot: `engagements-misclassified.jpg`.

**H9. Bank (ACH) is offered in the payment modal, but the flow assumes instant success.**
The Payment Element shows a "Bank — $5 back" tab. ACH payment intents sit in `processing` for days. `confirmStandardBidPayment` needs `succeeded`, and the webhook that would finish it later is off (C3). So a bank payment leaves the bid in `authorizing`, with the owner told "a payment is already processing". Either restrict `payment_method_types` to card, or handle `processing`. Not paid live, so this is from the code path.

## Medium

- **M1. No success feedback after posting a listing.** Confirm to listing page took ~12 s with no toast.
- **M2. Validation toasts stack and outlive the fix.** Example: "Please add a title" is still on screen on step 3 after a title was entered. There are no inline field errors. The same pattern shows up elsewhere: three identical "Your review has been saved" toasts, and a stale "link needs https://" toast after a successful delivery.
- **M3. The listing stays "Live/Open" after you hire.** Other consultants keep bidding with no signal. The owner sees "You can keep the listing open…" but no prompt to close it or decline the others.
- **M4. A business can counter above the consultant's ask and above its own budget max.** Example: $150 on a $100 offer with a $120 max. This is probably a typo in practice. Warn when the counter is above the ask or the range. Counters are one-shot, so a typo can't be undone.
- **M5. After a counter is accepted, the business card shows "Counter" again.** `counter_attempted` is already true, so clicking it can only fail. The consultant's reply note ("Thanks, happy to do it at that rate") is saved but never shown to the business.
- **M6. The consultant's offer summary drops context after submit.** It loses the timeline, status ("waiting on the business"), what happens next and the payout breakdown. After the counter is accepted, it reads "Offer submitted: $150.00" with no history.
- **M7. Unlimited change requests pause release indefinitely.** Each "Request changes" clears `delivered_at`, and only the 90-day admin flag catches it. Consider a cap, or a "redo" limit like the support flow.
- **M8. The payment modal copy contradicts the release rules.** It says "holds your payment until you mark the work complete and submit your review". Terms §6.4 says 14 days after delivery. It also hardcodes "Test card: 4242 4242 4242 4242", which will ship to live mode unless gated. The Stripe account's display name reads "grassroots sandbox" (lowercase) in the mandate text.
- **M9. Consultant dashboard stats are wrong.** "Avg payout $150.00" is the offer amount, not the $138.35 actually paid. "Avg response time 5m — Owner accepts within" is mislabeled. "Active bids" appears twice. The profile-health and notifications cards collapse into thin bars at the bottom (light and dark). The released "weekend foot…" tulip stops at "work delivered", and a clipped circle pokes out above the card.
  Screenshot: `consultant-dashboard-final.jpg`.
- **M10. The business dashboard shows the completed listing as "In progress".** Drafts say "5 months open". The "My listings" badge (3–4) doesn't match any visible count.
- **M11. Slow pages.** Measured from navigation to loader gone plus about 0.8 s settle:

  | Page | Median | Max |
  |---|---|---|
  | `engagement.html` | 7.9 s | 18 s |
  | `listing.html` | 6.5 s | 10.8 s |
  | `dashboard.html` | 5.6 s | — |
  | `notifications.html` | 22 s | — |

  Opening the payment modal took ~8 s. Contributing causes:
  - supabase-js is fetched from esm.sh as about 10 chained module requests on every page.
  - Queries run serially.
  - The listing page's two failing 400 queries.
  - The consultant dashboard hides its loader before data arrives, so panels sit blank for 3–5 s.
- **M12. Unread notification badges only appear on dashboards.** The injected side nav (marketplace, listing, notifications…) never shows the count.
- **M13. The CSP report-only policy doesn't allow Google Fonts.** It's missing `fonts.googleapis.com` and `fonts.gstatic.com`, so every page fires about 7 CSP violation reports. Fonts would break the day it's enforced.

## Visual / copy (low)

- **Fee breakdown on the offer form wraps badly.** The struck-through "−$10.00" and "−$4.50" break onto two lines. The pitch textarea shows a bare "906" counter with an unexplained ×.
  Screenshot: `offer-fee-breakdown.jpg`.
- **Rating widgets render 10 stars per row instead of 5.** The background and fill tracks sit side by side. Dimension labels are mixed case ("Work product quality" vs "communication", "timeliness", "professionalism").
  Screenshot: `review-stars-and-actions.jpg`.
- **Off-theme orange/peach.** The counter panel background with an orange eyebrow, the "held", "In review", "Changes requested" and "Awaiting availability" pills, and the "Stale" chip and action-items left rule all read orange-red, not `--fo-accent-warm` or `--fo-plan`.
  Screenshot: `counter-panel-colors.jpg`.
- **The "New" pill overlaps the dismiss × on notification cards.**
  Screenshot: `notification-pill-overlap.jpg`.
- **Terminology drifts: offer / bid / proposal / student / consultant.** Examples:
  - The listing sidebar says "Proposals received".
  - Notification copy includes "Your bid was accepted." (with a period), "Your $150.00 proposal…" and "A student rated your business".
  - The notifications page subtitle says "bids, meetings".
  - The consultant gets two "accepted" notifications ("Your bid was accepted" plus "Pick a kickoff time… was accepted").
  - The changes-requested body starts lowercase ("…" update "…").
- **Notification bodies are passed through `escapeHtml` before insert.** A listing title containing `&` or `"` would display as `&amp;` / `&quot;`.
- **Missing notifications:** the consultant gets nothing when paid manually or reviewed, and the business gets no payment receipt.
- **Stray placeholders.** The business avatar is a flat green square on the listing page but "BT" initials in the marketplace. There's an empty grey pill next to "Posted today" in the create preview. The preview shows a "Website" link even with none set. The performance card says "1 day since listed" on day 0.
- **The kickoff grid dominates the engagement page.** It's a 24-row grid, even for the consultant while they wait, when it's non-interactive. Dragging past the grid selects the time labels as text.
- **Marketplace repeats multi-category listings.** "Weekend farmers market sales push" appears under both Sales and Marketing. Cards use a third of the width on desktop. The "Today" pill floats above the card.
- **The cookie banner covers dashboard content until dismissed.**

## Data left behind

- The QA listing (`completed`) is still in the database, along with its bid, schedule, both reviews and notifications.
- The sandbox transfer of $138.35 sits in the consultant's Stripe balance.
- The test consultant's rating is now 4.9 (1) and the test business has one review.
- The attachment-test listing was rolled back automatically.
