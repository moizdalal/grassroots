# Messaging

> Grassroots has two distinct messaging surfaces — a quick "ask a question" drawer on a listing, and a full inbox once a bid is accepted. They share the same underlying thread but show up in different places.

## The two surfaces

### "Have a question?" Drawer

Shown to consultants on a listing they haven't bid on (or whose bid hasn't been accepted yet). A slim panel slides up from the bottom of the listing page. First message is **capped at 200 characters** and locks the listing title as context — so the business owner always knows which listing the question is about.

After the first message, the limit lifts to 2000 characters and the conversation flows freely.

### Inbox

Once a bid is accepted (status `held`+), the conversation moves to the **inbox** on both sides:

- Owner: `/dashboard.html#inbox`
- Consultant: `/dashboard.html#inbox`

The inbox shows every active thread, with the listing title as the subject line and the other party's avatar. Unread counts surface on the side nav.

## Threading

Threads are keyed by `(listing_id, owner_id, consultant_id)`. So:

- One listing + one consultant = one thread
- The thread persists from "ask a question" all the way through "engagement complete"
- If the same consultant bids on a different listing from the same owner, that's a separate thread

## Read receipts

Each user can toggle read receipts in **settings → general → messaging**. When on, the other side sees a small "seen" indicator on messages you've read.

Read state is per-user — turning yours on doesn't force theirs on.

## What doesn't work today

- No file attachments in messages (the listing has attachments separately)
- No message editing or deletion — sends are final
- No group chats — strictly two-party threads
- No emoji reactions

These may be added later but aren't planned for the current cycle.

## Notifications

New messages trigger:
- A count badge on the inbox icon in the side nav
- A notification entry in `/notifications.html`
- (Planned) email notifications when you've been offline for a while

Email notifications are off by default and configurable per-category in settings.

## FAQ

- **Why is my first message limited to 200 characters?** It forces a tight, scoped question so the owner can scan quickly. Once you're in conversation, the limit lifts.
- **Can I message a consultant before they bid?** No. only consultants can initiate the "have a question?" Thread, and only on an active listing.
- **What if someone is abusive?** Report via [moiz@grassroots-marketplace.com](mailto:moiz@grassroots-marketplace.com). We keep message history for moderation; it isn't deleted by the platform automatically.
