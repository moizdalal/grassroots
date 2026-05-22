# health tab — your runbook

Plain-English guide to the new **health** tab in the admin dashboard (`/admin/?tab=health`).

It shows two things in one place:
1. **business kpis** — are people signing up, posting, and paying? are conversion rates trending the right way?
2. **page performance** — are the pages actually loading fast for your real users?

---

## getting in

1. Sign in as your admin account (`moizdalal@ufl.edu` is the only allow-listed email today; add more in `public/admin/admin.js:36` *and* `app.js` `ADMIN_EMAILS` if you bring on a co-admin).
2. Open [`/admin/`](https://www.grassroots-marketplace.com/admin/) (or `/admin/` on whatever URL you're testing — `localhost:4001/admin/` in dev).
3. Click **health** in the left sidebar (newest tab, bottom of the list).
4. The time window selector in the top right defaults to **7d**. You can switch to **today**, **30d**, or **90d**. Clicking re-fetches.

If anything fails to load, an error message appears in red where the tiles would be.

---

## reading the **business kpis** section

### the four tiles up top

| tile | what it counts | why it matters |
|---|---|---|
| **new sign-ups** | users created in the window, split into consultants vs owners | the top of your funnel — if this stops growing, growth is dead |
| **new listings** | listings created in the window + currently open count | supply side health for owners |
| **new offers** | bids submitted in the window + how many engagements are mid-work | demand side health for consultants |
| **median time to first offer** | for listings posted in the window, the typical wait between posting and first offer | if this drifts above ~24h, listings are sitting unloved |

Tiles update when you change the time window. "Today" can read 0 if nothing's happened yet — that's not a bug, that's a quiet day.

### conversion funnel (left card)

Four percentages stacked, all measured against activity *inside* the window:

1. **owners who signed up & posted a listing** — your activation rate for businesses. If this is below ~30%, your post-signup experience has a leak.
2. **consultants who signed up & submitted a bid** — same idea on the consultant side. Below ~25% means consultants are signing up but not finding work they want to bid on.
3. **listings posted & got at least one bid** — supply-demand matching. Below ~70% means owners are posting work that no one wants.
4. **bids submitted & accepted** — quality of bids. Below ~10% is healthy (lots of competition); 0% is broken.

Tap any window button (today / 7d / 30d / 90d) to see the same funnel over different horizons. **30d is usually the best signal** — short enough to catch trends, long enough to smooth out a single bad day.

### money flow (right card)

Two numbers:

- **held in escrow right now** — total dollars you're holding on behalf of consultants who haven't been paid out yet. This is the "I'm responsible for this money" number. It grows when owners pay and shrinks when consultants get released payments.
- **released to consultants in window** — dollars moved out of escrow to consultants during the selected window. This is your "money successfully delivered" number.

Both are pulled from `bid_phase_payments`. If escrow keeps growing without releases climbing, something's stuck — consultants aren't getting their work approved.

---

## reading the **page performance** section

This is where the perf optimization work shows up. It's powered by a tiny script (`perf-beacon.js`) that runs in every visitor's browser, captures their actual load timing, and POSTs it back to your server.

> **Data lag note:** the beacon fires when the user *closes or backgrounds the page*, not when it loads. So a user who's currently reading your dashboard won't show up here until they navigate away or switch tabs. Expect a 1-2 minute delay between someone visiting and them showing up here.

### the four tiles up top

Each tile carries a **colored left border** showing how that metric scores against Google's Core Web Vitals thresholds:

- 🟢 **green border** = good
- 🟠 **orange border** = needs improvement
- 🔴 **red border** = poor
- ⚪ **gray border** = no data yet

The four metrics:

| tile | what it means | good | needs-work | poor |
|---|---|---|---|---|
| **p75 lcp** | how long before the largest visible thing appears on screen, for 75% of your users | ≤ 2.5s | ≤ 4s | > 4s |
| **p75 inp** | how long the page takes to respond after a click, for 75% of interactions | ≤ 200ms | ≤ 500ms | > 500ms |
| **p75 cls** | how much content jumps around during load, on a 0–1 scale | ≤ 0.10 | ≤ 0.25 | > 0.25 |
| **p75 ttfb** | how long the server took to start responding | shown for reference, no formal grade |

**Why "p75"?** It's the 75th-percentile — meaning "75% of your users got this number or better." Averages hide your slowest 25% of users; p75 forces you to face the slow tail. Google's SEO ranking uses p75 too.

### lcp trend by day (line chart)

X-axis = day, Y-axis = p75 LCP in milliseconds (lower = faster). If the line trends down over time, your perf work is paying off. If it spikes up after a deploy, something you shipped is slowing things down.

A flat line is fine — it means your speed is stable.

### per-page breakdown table

One row per page on your site, sorted by traffic (most-visited at the top). Columns:

- **samples** — how many page loads we measured. Be cautious of routes with < 10 samples; the percentiles get noisy.
- **p50 lcp** — typical load (50% of users got this or better)
- **p75 lcp** — slow-tail load (75% got this or better) — **this is the number that gets the color treatment**
- **p95 lcp** — your slowest 5% (worst case for most users)
- **p75 cls** — layout-shift score for the slow tail
- **p75 inp** — response time for the slow tail

**How to use it:** sort visually for the orange or red p75 LCP cells. That's where to focus the next round of perf work. A row with high samples + red p75 = your biggest problem.

### slowest individual loads (bottom table)

Top 20 worst individual page loads in the window. Useful for debugging:
- **when** — exact timestamp
- **page** — which URL
- **device** — mobile, tablet, or desktop
- **network** — `4g` (fast), `3g` (medium), `slow-2g` (terrible), `wifi`, or `unknown`
- **lcp** — how slow it was
- **cls** — how shifty

This is the "what page made one specific person mad" table. If you see a `consultant-dashboard.html` at 12.4s on a mobile/3g connection, that's a real user who had a bad time. Whether it's worth fixing depends on how often it happens (sample count per route).

---

## what to do with all of this

### weekly ritual (5 min)

Every Monday:
1. Open admin → health.
2. Set the window to **7d**.
3. Eyeball the four perf tiles. If any went red, something regressed last week. Cross-reference with what you deployed.
4. Eyeball the four business tiles. Are sign-ups, listings, offers in the right ballpark?

### investigating a regression (15 min)

If p75 LCP went up:
1. Look at the **per-page breakdown** table — which route(s) got worse?
2. Look at the **slowest loads** table — is it concentrated on one device/network class? (e.g., mobile/3g)
3. Open `git log` for the date the trend started worsening — what got shipped?

### before/after a perf change

Every time you deploy a perf improvement:
1. Note today's overall p75 LCP from the tile.
2. Wait 3-7 days for enough samples to accumulate.
3. Check the tile again. Did the number move?
4. Cross-check the per-page table — did the specific route you optimized actually improve?

If the number didn't move, the optimization wasn't on the critical path. Move on.

### setting goals

Reasonable starting targets given your stack:
- **p75 LCP < 2.5s on every page** (matches Google's "good" threshold; this is also a Search ranking factor)
- **p75 INP < 200ms** (interactivity feels snappy)
- **p75 CLS < 0.10** (no visible layout jumping)
- **bid_acceptance_pct in healthy 5-15% range** (lots of choice for owners, real chance for consultants)
- **listing_to_first_bid_pct > 70%** (most listings get matched)

If a number is far from its target, that's where to invest next.

---

## what's under the hood (in case you need to debug)

These files implement the tab. Useful to know when something goes wrong.

| file | role |
|---|---|
| `public/perf-beacon.js` | the client script on every page. Captures LCP/INP/CLS via `PerformanceObserver`, posts on `visibilitychange`/`pagehide`. Fire-and-forget; if it fails, the user never sees an error. |
| `app.js` `POST /api/metrics/page-load` | server endpoint that takes one beacon and writes one row to `page_metrics`. Validates + bounds the values to reject garbage. |
| `supabase/page_metrics.sql` | the SQL migration. Creates the `page_metrics` table + four aggregation functions (`page_metrics_overall`, `_by_route`, `_daily_trend`, `_slowest`). Already applied to production. |
| `app.js` `POST /api/admin/health-summary` | admin endpoint that runs the four SQL aggregations + computes business KPIs in one go. Gated by email allow-list. |
| `public/admin/index.html` (health section) | the markup for the tab. |
| `public/admin/admin.js` (`renderHealth`) | the JS that calls the endpoint and renders the tiles/tables/chart. |
| `public/admin/admin.css` (health styles) | the styling for the color-graded tiles, funnel rows, money block. |

### "the tab is empty / says no data"

The first time you open the health tab on a fresh deploy, you may see "no page-load data in this window yet" because real users haven't visited yet. **Browse a few pages yourself**, then wait ~30 seconds and refresh — your own visits will start showing up.

You can also seed test data via SQL if you want to test the layout:
```sql
INSERT INTO page_metrics (pathname, device_class, lcp_ms, inp_ms, cls_x1000, ttfb_ms, fcp_ms)
VALUES ('/dashboard.html', 'desktop', 2100, 80, 50, 120, 950);
```

### "admin required" / 403 error

The endpoint checks your email against `ADMIN_EMAILS` in `app.js` (around line 3070). If you sign in with a non-admin account, you'll get a 403. Add yourself to the set:
```js
const ADMIN_EMAILS = new Set([
  "moizdalal@ufl.edu",
  "yournewco-admin@example.com",
]);
```
…and also add to `public/admin/admin.js` so the front-end gate matches.

### "the table is getting huge"

The `page_metrics` table grows ~1 row per pageview. At 10k pageviews/day that's ~3.6M rows/year, still under Supabase's free-tier limits. If you ever want to thin it out, add a cron job to delete rows older than ~90 days:
```sql
DELETE FROM page_metrics WHERE recorded_at < NOW() - INTERVAL '90 days';
```

### "I want to track something else"

The schema is intentionally minimal. To add a metric (e.g., a `viewer_role` column to split owner vs consultant perf):
1. `ALTER TABLE page_metrics ADD COLUMN viewer_role TEXT;` in a new migration.
2. Update `public/perf-beacon.js` to send the new field.
3. Update the `asInt` validation block in `app.js` `POST /api/metrics/page-load` if needed.
4. Update the SQL functions in `supabase/page_metrics.sql` (and re-apply) if you want it in aggregates.
5. Update `public/admin/admin.js` `drawHealth()` to render it.

---

## privacy notes

The beacon collects:
- **path you visited** (`/dashboard.html`, `/listing.html`, etc.)
- **device class** (mobile / tablet / desktop — coarse, from viewport width)
- **connection type** (4g / 3g / etc. — from `navigator.connection`)
- **timing numbers** (LCP, INP, CLS, TTFB)

It does **not** collect:
- IP addresses
- User IDs (could be added later — see "I want to track something else")
- Anything from page content
- Full user-agent strings

Mention this on a privacy page if you're being thorough. It's anonymous by design.
