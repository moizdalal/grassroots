# your profile

> your profile is what business owners see before they consider your bid. it's the same surface whether you're a consultant or a business owner — the fields just shift based on role.

## edit it from

**settings → personal** (`/settings.html#personal`) for your photo, name, and contact links.
**settings → professional** (`/settings.html#professional`) for your role-specific fields (education, resume, past work, or business + social profiles).

every field saves through stripe-free supabase storage. file uploads (photo, resume, portfolio) are scoped to your account — no one else can read them unless you flip them public.

## profile photo

square crop. jpeg / png / webp / gif, up to 2 mb.

- click **change photo** to swap; the new image auto-uploads (no "save" needed)
- click **remove** to clear; you'll fall back to initials on a moss circle
- shown next to your name on bids, in the marketplace, and in chat

## personal details

- **full name** (required)
- **email** (read-only — comes from your account)
- **phone number** (read-only — set at registration)
- **linkedin** (optional, public)

## education (consultants only)

- school
- major + minor

shown on your public profile.

## resume (consultants only)

upload a single pdf, max 5 mb. once uploaded:
- click the filename to **preview** in-page
- click the download icon to **download**
- click **remove** to clear (you can upload a different one)
- toggle **public** to make it visible to business owners

if you turn off public, the resume is private — even your own bids won't surface it to owners.

## past experience / portfolio (consultants only)

upload work samples: pdfs, docs, slides, images, videos. up to 25 mb each, no fixed limit on count.

each item gets:
- the filename (click to preview)
- a small download icon
- an optional description (up to 300 chars)
- a **public** toggle (defaults to off — you decide what to show)

samples toggled public appear on your profile under "past experience."

## business profile (business owners only)

- business name (required)
- business address
- website
- about (paragraph describing what you do)
- social profiles (instagram, facebook, linkedin)

each social platform is opt-in — toggle it on and paste the link.

## what's public vs private

| field | default visibility |
|---|---|
| name, photo, role | public |
| linkedin url | public if set |
| education | public if set |
| resume | private — flip toggle to share |
| portfolio items | private per-item — toggle each |
| business name, website, about | public |
| email, phone | private (account use only) |

## preview as business (consultants only)

a link at the top of the settings → professional tab lets you see your own profile from a business owner's perspective. open it to confirm what you're sharing reads cleanly before bidding.

## faq

- **why is my photo a green circle?** you haven't uploaded one — that's the placeholder. it shows your initials in your role's accent color.
- **can i make individual portfolio items public/private?** yes, each item has its own toggle.
- **does removing the resume affect past bids?** the bid record stays. owners who already received your resume keep their access; new viewers don't see it.
