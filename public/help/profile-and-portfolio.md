# Your profile

> Your profile is what business owners see before they consider your bid. It's the same surface whether you're a consultant or a business owner — the fields just shift based on role.

## Edit it from

**Settings → personal** (`/settings.html#personal`) for your photo, name, and contact links.
**Settings → professional** (`/settings.html#professional`) for your role-specific fields (education, resume, past work, or business + social profiles).

Every field saves through stripe-free Supabase storage. File uploads (photo, resume, portfolio) are scoped to your account — no one else can read them unless you flip them public.

## Profile photo

Square crop. JPEG / PNG / WebP / GIF, up to 2 MB.

- Click **Change photo** to swap; the new image auto-uploads (no "save" needed)
- Click **Remove** to clear; you'll fall back to initials on a moss circle
- Shown next to your name on bids, in the marketplace, and in chat

## Personal details

- **Full name** (required)
- **Email** (read-only — comes from your account)
- **Phone number** (read-only — set at registration)
- **Linkedin** (optional, public)

## Education (consultants only)

- School
- Major + minor

Shown on your public profile.

## Resume (consultants only)

Upload a single PDF, max 5 MB. Once uploaded:
- Click the filename to **preview** in-page
- Click the download icon to **download**
- Click **Remove** to clear (you can upload a different one)
- Toggle **Public** to make it visible to business owners

If you turn off public, the resume is private — even your own bids won't surface it to owners.

## Past experience / portfolio (consultants only)

Upload work samples: PDFs, docs, slides, images, videos. Up to 25 MB each, no fixed limit on count.

Each item gets:
- The filename (click to preview)
- A small download icon
- An optional description (up to 300 chars)
- A **public** toggle (defaults to off — you decide what to show)

Samples toggled public appear on your profile under "past experience."

## Business profile (business owners only)

- Business name (required)
- Business address
- Website
- About (paragraph describing what you do)
- Social profiles (Instagram, Facebook, LinkedIn)

Each social platform is opt-in — toggle it on and paste the link.

## What's public vs private

| Field | Default visibility |
|---|---|
| Name, photo, role | Public |
| LinkedIn URL | Public if set |
| Education | Public if set |
| Resume | Private — flip toggle to share |
| Portfolio items | Private per-item — toggle each |
| Business name, website, about | Public |
| Email, phone | Private (account use only) |

## Preview as business (consultants only)

A link at the top of the settings → professional tab lets you see your own profile from a business owner's perspective. Open it to confirm what you're sharing reads cleanly before bidding.

## FAQ

- **Why is my photo a green circle?** You haven't uploaded one — that's the placeholder. It shows your initials in your role's accent color.
- **Can I make individual portfolio items public/private?** Yes, each item has its own toggle.
- **Does removing the resume affect past bids?** The bid record stays. Owners who already received your resume keep their access; new viewers don't see it.
