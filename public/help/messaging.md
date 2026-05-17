# messaging

> grassroots has two distinct messaging surfaces — a quick "ask a question" drawer on a listing, and a full inbox once a bid is accepted. they share the same underlying thread but show up in different places.

## the two surfaces

### "have a question?" drawer

shown to consultants on a listing they haven't bid on (or whose bid hasn't been accepted yet). a slim panel slides up from the bottom of the listing page. first message is **capped at 200 characters** and locks the listing title as context — so the business owner always knows which listing the question is about.

after the first message, the limit lifts to 2000 characters and the conversation flows freely.

### inbox

once a bid is accepted (status `held`+), the conversation moves to the **inbox** on both sides:

- owner: `/dashboard.html#inbox`
- consultant: `/dashboard.html#inbox`

the inbox shows every active thread, with the listing title as the subject line and the other party's avatar. unread counts surface on the side nav.

## threading

threads are keyed by `(listing_id, owner_id, consultant_id)`. so:

- one listing + one consultant = one thread
- the thread persists from "ask a question" all the way through "engagement complete"
- if the same consultant bids on a different listing from the same owner, that's a separate thread

## read receipts

each user can toggle read receipts in **settings → general → messaging**. when on, the other side sees a small "seen" indicator on messages you've read.

read state is per-user — turning yours on doesn't force theirs on.

## what doesn't work today

- no file attachments in messages (the listing has attachments separately)
- no message editing or deletion — sends are final
- no group chats — strictly two-party threads
- no emoji reactions

these may be added later but aren't planned for the current cycle.

## notifications

new messages trigger:
- a count badge on the inbox icon in the side nav
- a notification entry in `/notifications.html`
- (planned) email notifications when you've been offline for a while

email notifications are off by default and configurable per-category in settings.

## faq

- **why is my first message limited to 200 characters?** it forces a tight, scoped question so the owner can scan quickly. once you're in conversation, the limit lifts.
- **can i message a consultant before they bid?** no. only consultants can initiate the "have a question?" thread, and only on an active listing.
- **what if someone is abusive?** report via [help@grassroots.com](mailto:help@grassroots.com). we keep message history for moderation; it isn't deleted by the platform automatically.
