# Project Code Map

This file is a quick-reference map for the marketplace app so future edits can point to the right files and line ranges without rereading the whole repo.

## How The Frontend Is Wired

- Shared visual system: `public/grassroots.css`
- Shared Supabase client loader: `public/supabase-loader.js`
- Shared nav notification helper: `public/nav-notify.js`
- Each page is mostly:
  - one HTML shell
  - one page JS module
  - `grassroots.css`
  - optionally one page-specific CSS file

## Page Relationships

| Page | HTML | JS | CSS |
| --- | --- | --- | --- |
| Marketplace home | `public/index.html` | `public/marketplace.js` | `public/grassroots.css` |
| Sign in | `public/signin.html` | `public/signin.js` | `public/grassroots.css` |
| Register | `public/register.html` | `public/register-flow.js` | `public/grassroots.css`, `public/register-flow.css` |
| Create opportunity | `public/create-listing.html` | `public/create-listing.js` | `public/grassroots.css`, `public/create-listing.css` |
| Listing detail | `public/listing.html` | `public/listing.js` | `public/grassroots.css`, `public/listing.css` |
| Profile | `public/profile.html` | `public/profile.js` | `public/grassroots.css`, `public/profile-seedling.css` |
| Notifications | `public/notifications.html` | `public/notifications.js` | `public/grassroots.css` |

## Shared Files

### `public/supabase-loader.js`

- `1-23`: Lazily fetches `/api/public-config` and creates a singleton browser Supabase client with session persistence. Every page-level JS module that needs Supabase imports this.

### `public/nav-notify.js`

- `1-4`: Comment header explains usage.
- `6-24`: Inserts a bell link into the shared nav if the user is signed in.
- `25-40`: Counts unread notifications and attaches the badge.

### `public/grassroots.css`

This is the shared marketplace design system.

- `1-24`: Root tokens for colors, borders, focus states, and easing.
- `25-109`: Global body and nav shell styling.
- `110-146`: Shared layout shell and typography.
- `147-212`: Core card, field grid, label, and input styles.
- `213-492`: Shared wizard/opportunity UI pieces:
  - opportunity-type selector
  - info tooltip styles
  - category preview/icon treatment
  - money range inputs
- `494-556`: Shared button styles.
- `557-598`: Shared status and session slot styles.
- `599-687`: Marketplace listing-card grid styles.
- `688-900`: Shared bid/listing card styles used across listing detail and notifications.
- `901-1087`: Shared profile form layout and business social input system.
- `1088-1827`: Shared listing-detail and notification utility styles:
  - listing text blocks
  - bid cards
  - messaging bubbles
  - notification bell and unread state
  - generic multiselect dropdown
- `1828-1900`: `.hidden` utility and main mobile responsive overrides.

## Marketplace Home

### `public/index.html`

- `16-28`: Shared top nav.
- `30-39`: Page header with title/subtitle and `#page-cta-slot` for business-owner CTA injection.
- `41-46`: `#session-slot`, `#listing-grid`, and `#listings-status` placeholders used by `marketplace.js`.
- `49`: Loads `marketplace.js`.

### `public/marketplace.js`

- `1-9`: Imports shared modules and defines the Supabase `select(...)` shape for listings.
- `11-17`: Escaping helper for safe HTML rendering.
- `19-51`: `renderSession(...)`
  - shows guest vs signed-in state
  - adds logout button
  - fetches profile role
  - injects the business-owner CTA into `#page-cta-slot`
  - note: current CTA text is still `"create listing"` at `40-42`
- `53-60`: `fetchOpenListings(...)` reads `listings` where `status = open`.
- `63-95`: `renderListings(...)` turns listing rows into marketplace cards.
- `97-111`: `refreshListings(...)` handles loading/error state around the query.
- `113-136`: `init()` bootstraps Supabase, session state, notification bell, auth-change refresh, and listing load.

## Sign In

### `public/signin.html`

- `16-28`: Shared nav.
- `30-34`: Sign-in title/subtitle.
- `36-61`: Sign-in form shell and `#status`.
- `63-76`: Register link block.
- `80`: Loads `signin.js`.

### `public/signin.js`

- `3-4`: DOM hooks for form and status.
- `6-29`: Submit handler:
  - reads email/password
  - signs in via Supabase
  - redirects to `next` query param if valid, else `/`
  - shows success/error text

## Register

### `public/register.html`

- `13-14`: Loads shared and page-specific registration CSS.
- `31-46`: Page heading and progress header.
- `48-49`: Form root and hidden role field.
- `51-81`: Slide 0, role selection cards.
- `83-122`: Slide 1, account details fields.
- `125-140`: Back / continue / submit navigation.
- `147`: Loads `register-flow.js`.

### `public/register-flow.js`

- `3-19`: DOM wiring, step labels, state.
- `21-44`: `showSlide(...)` switches visible slide and progress UI.
- `46-79`: Password policy regexes and `validatePassword()`.
- `81-109`: `validateCurrentStep()`:
  - step 0 validates role
  - step 1 validates required account fields and password rules
- `111-131`: Back/next step navigation.
- `133-185`: Submit flow:
  - posts `FormData` to `/api/register`
  - removes local-only fields
  - auto-signs user in via Supabase on success
  - redirects to `/profile.html?welcome=1`
- `187`: Initializes the first slide.

### `public/register-flow.css`

- `1-8`: Password hint text.
- `10-44`: Progress bar styling.
- `46-70`: Slide animation system.
- `72-131`: Role card styling and checked state.
- `133-146`: Field-grid and nav layout.
- `148-163`: Small-screen and reduced-motion overrides.

## Create Opportunity

### `public/create-listing.html`

- `13-14`: Loads shared `grassroots.css` plus page-specific `create-listing.css`.
- `27-32`: Page title, subtitle, and gate status.
- `34-35`: `#cl-split` wrapper stays hidden until boot completes.
- `37-44`: Step progress track and label.
- `46-104`: Slide 1:
  - title field
  - opportunity type selector
  - inline icon buttons
  - tooltip panel
  - `"other"` free-text field
- `106-129`: Slide 2:
  - opportunity description
  - additional details
- `131-172`: Slide 3:
  - category selector
  - budget range
  - turnaround days
  - qualifications repeater
- `175-180`: Wizard nav buttons.
- `186-236`: Sticky live preview card:
  - business bio preview
  - opportunity header
  - chips
  - summary/details/qualifications/budget preview sections
- `240`: Loads `create-listing.js`.

### `public/create-listing.js`

- `3-30`: Main DOM references, slide state, category state, qualification repeater hooks, and preview hooks.
- `58-74`: Category option registry with inline SVG icons.
- `76-86`: Escaping helper and category lookup helper.
- `88-117`: `renderCategoryDropdown()` builds the searchable icon dropdown.
- `119-150`: `toggleCategory()` and `renderCategoryTags()` manage multi-select categories and removable chips.
- `152-163`: `setOpportunityType(...)` updates selected state and reveals the `"other"` input.
- `165-182`: `updateWizardUI()` swaps slides, progress, and nav button visibility.
- `184-215`: `validateSlide(...)` enforces required fields per step.
- `217-258`: `boot()`:
  - initializes Supabase
  - requires signed-in business owner
  - loads owner/business profile info
  - reveals the split form+preview layout
- `260-308`: `populatePreviewBiz()` fills the right-side preview bio from `profiles` and `business_profiles`.
- `310-317`: `typeTagSvg(...)` supplies preview tag icons.
- `319-388`: `updatePreview()` keeps the preview in sync:
  - title
  - type/category chips
  - turnaround
  - summary/details
  - qualification bullets
  - budget formatting
- `390-442`: Live listeners for preview updates, slide navigation, tooltip toggling, qualifications repeater, and category dropdown behavior.
- `444-505`: Submit handler:
  - validates all slides
  - assembles the payload for `listings`
  - stores opportunity type and budget range inside `details`
  - stores qualifications as newline-separated text
  - redirects to the created listing detail page
- `507-575`: Inline SVG icon factory functions used by the category system.

### `public/create-listing.css`

This file styles the current slide-based create flow and preview panel. It is active because `create-listing.html` links it directly.

- `1-22`: Wide-shell and form/preview split layout.
- `23-240`: Right-side live preview card styling.
- `242-276`: Step progress bar styling.
- `278-312`: Slide animation and bottom nav layout.
- `314-368`: Selected category chip styling.
- `370-447`: Qualification repeater row styling.
- `449-465`: Responsive behavior for collapsing preview above the form on smaller screens.

## Listing Detail

### `public/listing.html`

- `31-36`: Gate/loading state and hidden detail container.
- `39-58`: Collapsible business bio block.
- `61-165`: Main two-column listing layout:
  - left: opportunity content
  - right: owner bid list or consultant offer panel
- `89-100`: Consultant banners for accepted or countered bids.
- `102-112`: Consultant “have a question?” button and guest prompt.
- `117-162`: Right sidebar sections:
  - owner proposals list
  - consultant offer form
- `167-200`: Chat drawer UI for consultant-to-owner messaging.
- `205`: Loads `listing.js`.

### `public/listing.js`

- `7-55`: Utility helpers:
  - escaping
  - USD formatting
  - relative dates
  - deadline formatting
  - missing-table/schema detection
  - avatar URL helper
  - listing ID parsing
- `57-132`: Data loaders:
  - listing row + business profile
  - session role
  - consultant’s current bid
  - owner-visible bids
  - messages
- `138-164`: Small SVG/icon helpers for socials and opportunity-type tags.
- `166-254`: `populateListing(...)`
  - fills business bio
  - builds social links
  - wires the bio collapse toggle
  - fills listing title/meta/details
  - extracts opportunity type from `details`
  - renders category/type chips
- `256-261`: Avatar population.
- `268-282`: `renderMsgThread(...)` for simple inline thread rendering.
- `288-397`: `showConsultantView(...)`
  - shows consultant offer panel
  - handles existing bid state
  - toggles optional message
  - handles accepted/countered bid banners
  - submits/upserts bids
  - enables question/chat drawer
- `399-535`: `setupChatDrawer(...)`, `renderChatThread(...)`, and `appendChatBubble(...)`
  - lazy-loads messages
  - sends first-message context with a delimiter
  - renders contextual chat bubbles
- `541+`: `showOwnerBids(...)` and later owner-side bid management logic for:
  - rendering consultant proposals
  - counter-offers
  - accept/reject actions
  - proposal/message handling

### `public/listing.css`

- `1-159`: Collapsible business bio card styling.
- `160-239`: Two-column layout and header tag styles.
- `228-404`: Sidebar panel and consultant offer form styles.
- `406-447`: Accepted/counter banners.
- `449-494`: “Have a question?” button and auth prompt.
- `496-764`: Chat drawer system:
  - backdrop
  - panel animation
  - thread
  - message bubbles
  - first-message context banner
  - compose area
- `765+`: Mobile responsive overrides.

## Profile

### `public/profile.html`

- `29-36`: Welcome overlay modal shown after registration.
- `38-46`: Page heading and gate status.
- `48-71`: Profile photo upload block.
- `73-102`: Shared account fields.
- `104-231`: Business-owner section:
  - business name
  - website
  - social profile toggles and inputs
  - about/current efforts
- `233-245`: Consultant resume upload section.
- `249-256`: Save button and status.
- `262`: Loads `profile.js`.

### `public/profile.js`

Use these function anchors when pointing at profile behavior:

- `33-39`: `buildBizSocialLinksArray(...)` composes social link arrays.
- `41-49`: `normalizeBusinessInstagramUrl(...)` normalizes instagram handles/URLs.
- `51-64`: `wireInstagramFieldAutoCheck()` auto-enables the Instagram field when text is entered.
- `66-88`: `wireBizSocialToggles()` shows/hides each business social input from its checkbox.
- `90-134`: `applyBizSocialFromRow(...)` hydrates the business social UI from DB data.
- `136-139`: `sanitizeFileName(...)`
- `140-152`: `setAvatarPreview(...)`
- `154-198`: `computeCompletion(...)` calculates profile completion.
- `200-216`: `maybeShowWelcome()` handles the post-registration welcome modal.
- `218-241`: Avatar input preview/change handling.
- `243-327`: `loadProfile()`:
  - requires session
  - loads `profiles`
  - loads `business_profiles` for owners
  - populates profile form
  - restores avatar and resume state
- `329-552`: Main submit handler:
  - uploads/replaces avatar
  - updates core profile row
  - updates business profile fields
  - optionally syncs Instagram avatar through `/api/profile/instagram-avatar`
  - uploads/replaces resume for consultants
- `553-566`: `boot()` wires the page and loads the current profile.

### `public/profile-seedling.css`

- `1-16`: Centered profile page layout.
- `18-68`: Welcome overlay and popup styling.
- `70-78`: Welcome modal keyframes.

Most profile form field styling still comes from `grassroots.css`.

## Notifications

### `public/notifications.html`

- `16-24`: Shared nav.
- `26-31`: Title, subtitle, gate, and list container.
- `34`: Loads `notifications.js`.

### `public/notifications.js`

- `3-8`: DOM refs and simple escape helper.
- `10-61`: `init()`:
  - requires session
  - loads up to 50 notifications
  - renders them using shared bid-card styles
  - marks unread notifications as read

## Quick Prompt Templates

Use these when directing future CLIs:

- "Update the create-opportunity step layout in `public/create-listing.html:46-180`, behavior in `public/create-listing.js:165-215` and `public/create-listing.js:444-505`, and styling in `public/create-listing.css:242-447`."
- "Change marketplace CTA behavior in `public/marketplace.js:19-51` and page header structure in `public/index.html:30-46`."
- "Adjust listing-detail bid/chat behavior in `public/listing.js:288-535` and matching styles in `public/listing.css:240-764`."
- "Edit business profile social-field behavior in `public/profile.js:51-134` and the matching HTML in `public/profile.html:121-209`."
