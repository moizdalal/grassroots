# stage progression

> grassroots ranks consultants on a four-stage ladder. your stage shows on your public profile and affects search ranking on the marketplace. it's driven entirely by **completed engagements + average rating**.

## the four stages

| stage | name | what it takes |
|---|---|---|
| 0 | **seedling** | starting stage — no bar |
| 1 | **sprout** | 1 completed engagement with a 4.0+ average rating |
| 2 | **small tree** | 2 completed engagements at 4.0+ |
| 3 | **giant sequoia** | 10 completed engagements at >4.0 |

new consultants start at seedling.

## how the gates work

both conditions need to be true at the same time. rating is the hard gate — without an average of 4.0+, you stay at seedling no matter how many engagements you complete.

```
                            avg ≥ 4.0   AND   1+ engagement  →  sprout
                            avg ≥ 4.0   AND   2+ engagements →  small tree
                            avg > 4.0   AND  10+ engagements →  giant sequoia
```

sequoia uses **strictly greater than 4.0** — a clean 4.0 isn't enough.

## what counts as "completed"

an engagement counts when the owner has submitted their review and the bid is `released`. canceled or paused engagements don't count.

## what counts as "average rating"

it's the average of all your dimension scores across all reviewed engagements. see [reviews & ratings](./reviews-and-ratings.md) for how it's computed.

if you have zero ratings, your "average" doesn't exist yet — so you sit at seedling regardless of engagement count.

## what changing stages does

- your public profile shows the new stage immediately
- search ranking shifts (higher stage → better placement in marketplace results)
- no automatic feedback to past clients or notifications go out — it's a silent badge

## viewing your progress

your **profile page** (`/profile.html`) shows:
- current stage (with a small visual)
- your average rating (if any)
- engagements completed
- progress bar toward the next stage

the progress bar is **the lowest-bound metric** — whichever requirement you're furthest from. so if you need 2 engagements and an average of 4.0, and you've done 1 engagement with a 5.0 average, the bar shows 50% (the engagement-count side is the binding constraint).

## what stages don't do (today)

- no automatic price floor changes
- no badge on bids submitted to listings — the owner sees your stage on your profile, not in the bid card
- no demotion — once you reach a stage, you stay there even if a later review drops your average

we may add maintenance/decay later (so the badge means current trust, not just historical), but it's not in today.

## faq

- **does grassroots reward higher stages with lower fees?** the 10% business platform fee is waived during launch, across all stages. when the waiver ends, stage-based discounts are an obvious lever.
- **can i see other consultants' stages?** yes — every public profile shows the stage.
- **does the stage decay if i drop below 4.0 later?** not today.
