# Stage progression

> Grassroots ranks consultants on a four-stage ladder. Your stage shows on your public profile and affects search ranking on the marketplace. It's driven entirely by **completed engagements + average rating**.

## The four stages

| Stage | Name | What it takes |
|---|---|---|
| 0 | **Seedling** | Starting stage — no bar |
| 1 | **Sprout** | 1 completed engagement with a 4.0+ average rating |
| 2 | **Small tree** | 2 completed engagements at 4.0+ |
| 3 | **Giant sequoia** | 10 completed engagements at >4.0 |

New consultants start at seedling.

## How the gates work

Both conditions need to be true at the same time. Rating is the hard gate — without an average of 4.0+, you stay at seedling no matter how many engagements you complete.

```
                            avg ≥ 4.0   AND   1+ engagement  →  sprout
                            avg ≥ 4.0   AND   2+ engagements →  small tree
                            avg > 4.0   AND  10+ engagements →  giant sequoia
```

Sequoia uses **strictly greater than 4.0** — a clean 4.0 isn't enough.

## What counts as "completed"

An engagement counts when the owner has submitted their review and the bid is `released`. Canceled or paused engagements don't count.

## What counts as "average rating"

It's the average of all your dimension scores across all reviewed engagements. See [reviews & ratings](./reviews-and-ratings.md) for how it's computed.

If you have zero ratings, your "average" doesn't exist yet — so you sit at seedling regardless of engagement count.

## What changing stages does

- Your public profile shows the new stage immediately
- Search ranking shifts (higher stage → better placement in marketplace results)
- No automatic feedback to past clients or notifications go out — it's a silent badge

## Viewing your progress

Your **profile page** (`/profile.html`) shows:
- Current stage (with a small visual)
- Your average rating (if any)
- Engagements completed
- Progress bar toward the next stage

The progress bar is **the lowest-bound metric** — whichever requirement you're furthest from. So if you need 2 engagements and an average of 4.0, and you've done 1 engagement with a 5.0 average, the bar shows 50% (the engagement-count side is the binding constraint).

## What stages don't do (today)

- No automatic price floor changes
- No badge on bids submitted to listings — the owner sees your stage on your profile, not in the bid card
- No demotion — once you reach a stage, you stay there even if a later review drops your average

We may add maintenance/decay later (so the badge means current trust, not just historical), but it's not in today.

## FAQ

- **Does Grassroots reward higher stages with lower fees?** Not yet. The platform fee is 5% during launch (10% after), across all stages. Stage-based discounts are an obvious lever later.
- **Can I see other consultants' stages?** Yes — every public profile shows the stage.
- **Does the stage decay if I drop below 4.0 later?** Not today.
