# Consultant training: draft outline and question bank

Draft for review, 2026-10-27.

> **Built.** The live text now lives in `public/training-content.js`, and that file wins over this draft. Changes since this draft:
> - New lesson 1.5 "Show up professionally" (dress, setting, punctuality).
> - New must-know lesson 2.1 "Respond on time, every time" (reply within one business day).
> - Example scripts on several lessons, plus more detail throughout.
> - Questions q26–q28 added, so the bank is 28.

Sources: moiz's "Consultant training: core topics" (Oct 27), plus the site's help pages (`public/help/`), Terms and `stripe.md` for the platform mechanics. Where the help pages and the Terms differ, the Terms win.

**How it works**

- Signed-in consultants only.
- Four modules in order: before, during, after, then misc.
- Each module ends with a short "check yourself" recap that isn't graded.
- The final quiz draws 10 questions from a bank of 25. You pass with 8 of 10 (80%). Below that, a pop-up asks you to actually complete the course.
- Every attempt is saved.

---

## Decisions (2026-10-27)

1. **Where the money sits:** in Stripe until it's released. The training says the payment is held in Stripe. It doesn't use the word "escrow" until the open wording question below is settled.
2. **Reviews:** consultants can't review businesses today, so lesson 3.5 says "ask the business for a review".
3. **NDAs:** read the NDA, ask support if it's unusual, and never sign anything that takes the work off-platform. Whether a business can attach its own NDA is still a `[counsel]` question.
4. **1099s:** no dollar thresholds until the accountant confirms them.
5. **Fees:** the quiz tests the fee rule, not dollar amounts.
6. **Quiz mix:** each quiz draws at least 2 questions from every module.
7. **Portfolio:** ask the client before showing their work.

**Escrow wording (decided 2026-10-27):** say "held in Stripe", never "escrow". Brady is raising it with the lawyer. Background: the Terms (§6) and the payments help page say Grassroots "is not an escrow company" and that "no licensed escrow agent is involved". Stripe doesn't act as an escrow agent here either: the funds sit in Grassroots' platform balance at Stripe. Calling it escrow in training would contradict the Terms. "Escrow" is also a licensed term in many states. Worth adding to the lawyer review this week.

---

## Module 1: Before the engagement

**Goal:** you show up prepared, price honestly and only take work you can do well.

### 1.1 How Grassroots works (mechanics)
- Businesses post listings. You send an offer: a price plus an optional message of up to 250 characters, with optional files.
- You must finish Stripe payout setup before you can send offers. The submit button stays disabled until then.
- Offers can't be edited after you send them. You get one offer per listing.
- A business can accept, decline or counter. Each business gets up to three counters per listing.
- When a business accepts, they pay the full offer right away and the payment is held in Stripe. You don't have it yet. It's paid out after delivery (module 3).

### 1.2 Research the business and its industry
- Before the first call, look at their website, socials, reviews and competitors, and learn the norms of their industry.
- Show up already knowing the basics.

### 1.3 Show your preparation in the proposal
- Attach relevant files, examples or early research to your offer.
- The client should see you've done your homework.

### 1.4 How pricing works
- The business pays exactly your offer, all-in. Nothing is added on top.
- Your payout is the offer minus card processing (2.9% + $0.30) and the platform fee: 10% of the part above $10, or 5% during launch.
- The offer screen shows your take-home before you send.
- Paid offers are at least $10. A $0 offer is allowed for free work. *(consultant-only; never mention it to businesses)*
- Price honestly. Don't underbid just to win the work.
- Pricing models: one-time, phased (proposal fee, then service fee) and retainer.

### 1.5 Running the discovery call
- Prepare: re-read the listing, list your questions and know what you want to leave with.
- Ask open questions, and listen more than you pitch.
- End with a clear, shared picture of the goal, then write it back to them in messages.
- Mechanics: for the kickoff, the business picks a meeting length and marks their availability. You choose a time inside it, and both of you get a calendar invite.

### 1.6 Asking clarifying questions
Stop and ask when:
- The goal is vague ("more customers", "make it pop").
- It's unclear who approves the work.
- The timeline or budget doesn't match the ask.
- You'd be guessing about their customer, brand or past attempts.
- You need logins, assets or data you don't have yet.

### 1.7 Don't promise outcomes
- Commit to the work you'll deliver, not to results you can't control, like follower counts or sales numbers.

### 1.8 Knowing when to say no, and saying it kindly
- Turn down work that's outside your skills, on an unrealistic timeline or a poor fit.
- Do it respectfully and leave the door open.

### 1.9 NDAs and confidentiality before you start (mechanics)
- The Terms already commit you to keeping a business's private information confidential (§13). See module 4.
- If a business asks you to sign its own NDA, read it first. Contact support if it's unusual.
- Never sign anything that moves the work or payment off Grassroots.

---

## Module 2: During the engagement

**Goal:** keep the client informed, keep the scope clear and keep the work moving.

### 2.1 Agree on a communication cadence
- At kickoff, agree how often you'll send updates, how fast you'll reply and who the point of contact is.
- Use the engagement's message thread so there's a record.

### 2.2 Handling scope creep
- Learn to spot a new request that falls outside the agreed scope.
- Explain calmly how it changes the offer. New work goes in a new listing, not into the current engagement.
- If it keeps happening, contact support. They'll mediate.

### 2.3 Managing your schedule and deadlines
- Be upfront about exams, breaks and busy weeks.
- If you'll miss a deadline, say so the day you know.
- Timeliness is one of the five ratings the business gives you.

### 2.4 Explaining things in plain language
- Most owners aren't marketers. Skip the jargon.
- Explain your thinking in terms they can act on.

### 2.5 Keep asking when you're unsure
- Clarifying questions don't stop after kickoff.
- Treat the client as a resource, not someone to avoid bothering.

### 2.6 Using AI responsibly
- AI is fine for drafts, brainstorming and research you then check.
- Check its output carefully. You're responsible for the facts, the tone and the originality.
- Be ready to tell the client how you used it.
- Never put a client's private data into an AI tool without their OK.

---

## Module 3: After: delivering, getting paid and closing

**Goal:** finish cleanly, get paid on time and earn a strong review.

### 3.1 Asking for feedback is not the same as marking work done
- Share the work, ask for feedback and revise where the engagement calls for it.
- Only mark it delivered once the client has everything they need. Marking it too early hurts trust.

### 3.2 How the payment hold and release work (mechanics)
- When you mark the work delivered, the business has 14 days to release payment, request changes or report a problem. They get a reminder on day 7.
- If they do nothing, the payment releases to you automatically after 14 days.
- If they request changes, update the work and mark it delivered again.
- Retainers: each period's 14 days start when the period ends. You can mark a period delivered early to start them sooner.
- Proposal fees release once the business decides whether to move forward.
- Anything still held 90 days after the charge goes to the Grassroots team for review. It doesn't release automatically.
- Once released, the money goes to your Stripe account and then to your bank, usually in about 2 business days.

### 3.3 When a business reports a problem (mechanics)
- The payment locks while Grassroots reviews it. There are three possible outcomes:
  - **The work meets scope:** it's released to you.
  - **It falls short but can be fixed:** you have 5 days to redo it once, or give the money back. No answer in 5 days counts as giving it back.
  - **Scope was breached:** the business gets a full refund.
- A one-time job can be cancelled for a full refund within 24 hours of payment.
- Once a payment is released, it's final.

### 3.4 Hold a closing meeting when you can
- Walk the client through the final work live, answer their questions and mark it done together.

### 3.5 Reviews
- The business rates you on five things: work quality, communication, timeliness, professionalism and cost value.
- Reviews can't be edited, and negative ones aren't removed just for being negative.
- Your rating and number of engagements move you up the seedling → sequoia stage ladder.
- Ask for a review as part of every wrap-up. *(See open question 2.)*

### 3.6 Taxes and 1099s (mechanics)
- You're an independent contractor, not an employee.
- Grassroots, through Stripe, issues tax forms (like a 1099-K or 1099-NEC) to consultants who cross IRS reporting thresholds.
- The tax info you gave Stripe during payout setup is what's used. There's no separate W-9 to upload.
- You owe income tax and self-employment tax on what you earn, whether or not you get a form. This isn't tax advice.
- Update your bank account or tax info any time on the payouts page.

---

## Module 4: Misc: professionalism and trust (applies throughout)

### 4.1 Keep everything on Grassroots
- Communication and payment stay on the platform.
- For 12 months after you meet someone on Grassroots, don't move paid work with them off-platform (Terms §11, non-circumvention).
- Taking it off-platform skips the payment hold, refunds and tax reporting. It can get your account suspended or closed.

### 4.2 Confidentiality
- Treat client data, logins, numbers and customer lists as private.
- Use them only for the engagement. Return or delete them when it ends or when the client asks (Terms §13).
- The duty lasts 2 years after the engagement, and forever for trade secrets and the business's customer data.
- Ask before you show their work in your portfolio.

### 4.3 Represent yourself honestly
- Be clear that you're a student. Don't overstate your experience.
- Fake credentials or impersonation can get you banned.

### 4.4 Escalate when needed
- If a client goes silent, is unhappy or asks for something that feels wrong, contact support early.
- For disagreements, try the inbox first. After 7 days with no agreement, email support with the bid ID.
- Support replies within 2 business days.

---

## Question bank (25)

Each question has 4 options. ✅ marks the correct answer. Tags show the module.

### Module 1: Before (9)

**Q1** [1.1] What must you finish before you can send an offer?
- A. A completed quiz on every listing
- B. ✅ Stripe payout setup
- C. A kickoff call with the business
- D. Five reviews on your profile

*Why: the submit button stays disabled until your Stripe account is active.*

**Q2** [1.1] You sent an offer and spotted a typo in the price. What can you do?
- A. Edit the offer from the listing page
- B. Send a second offer on the same listing
- C. ✅ Nothing in place, because offers can't be edited after you send them
- D. Ask the business to edit it for you

*Why: offers are final, and you get one per listing.*

**Q3** [1.1] A business accepts your offer. Where is the money right away?
- A. In your bank account
- B. In your Stripe balance, ready to pay out
- C. ✅ Held in Stripe until it's released
- D. Still on the business's card, not charged yet

**Q4** [1.4] How does the platform fee work?
- A. A flat $10 on every offer
- B. 10% added on top of what the business pays
- C. ✅ A percentage of the part of the offer above $10, taken from your payout
- D. Nothing, because the business pays all fees

*Why: businesses pay exactly the offer. Your payout is the offer minus card processing and 10% of the part above $10 (5% during launch).*

**Q5** [1.4] Which pricing approach does the training recommend?
- A. Bid the lowest price to win the work
- B. ✅ Price honestly for the work, knowing your take-home first
- C. Start high and expect to be countered
- D. Always send a $0 offer first

**Q6** [1.5] What should a good discovery call end with?
- A. A signed contract outside Grassroots
- B. A promise of specific sales results
- C. ✅ A clear, shared picture of the goal
- D. A discount for paying early

**Q7** [1.6] The owner says they want the website to "pop". What should you do?
- A. Start designing, since you'll know it when you see it
- B. ✅ Stop and ask clarifying questions about what they mean and why
- C. Decline the work
- D. Raise your price

**Q8** [1.7] Which of these is a promise you *should* make?
- A. "You'll get 1,000 new followers"
- B. "Sales will rise 20% next month"
- C. ✅ "I'll deliver three social posts a week for four weeks"
- D. "You'll rank first on Google"

**Q9** [1.8] A listing asks for work outside your skills on a very tight timeline. What's the best move?
- A. Take it and learn as you go
- B. Ignore it with no reply
- C. ✅ Decline it respectfully and leave the door open
- D. Send an offer and ask for more time after they've paid

### Module 2: During (6)

**Q10** [2.1] When should you agree on how often you'll send updates?
- A. Only if the client complains
- B. ✅ At kickoff
- C. After you deliver
- D. Never, because updates aren't needed

**Q11** [2.2] Mid-project, the client asks for a whole new deliverable. What do you do?
- A. Quietly do it for free to keep them happy
- B. Refuse to talk about it
- C. ✅ Explain that it's outside the agreed scope and how it would change the offer, for example as a new listing
- D. Ask them to pay you directly for the extra work

**Q12** [2.3] You realise you'll miss a deadline because of exams. When should you tell the client?
- A. On the deadline day
- B. After the deadline passes
- C. ✅ The day you know
- D. Only if they ask

**Q13** [2.4] How should you explain your strategy to a business owner?
- A. Use industry terms so you sound expert
- B. ✅ In plain language they can act on
- C. Only in a written report with no discussion
- D. Don't explain it, just deliver

**Q14** [2.5] You're unsure what the client meant in a message halfway through the project. What should you do?
- A. Guess, so you don't bother them
- B. ✅ Ask them in the message thread
- C. Pause the work until they notice
- D. Ask another consultant to decide

**Q15** [2.6] Which use of AI is *not* okay?
- A. Brainstorming headline ideas, then editing them yourself
- B. Drafting a first version you then fact-check
- C. ✅ Pasting the client's customer list into an AI tool without asking
- D. Telling the client you used AI for early drafts

### Module 3: After (6)

**Q16** [3.1] The client says "looks good, let me think about it". What should you do?
- A. Mark it delivered right away to start the clock
- B. ✅ Collect their feedback, make agreed revisions, and mark it delivered once they have everything they need
- C. Close the engagement yourself
- D. Ask for payment outside Grassroots

**Q17** [3.2] After you mark the work delivered, what happens if the business does nothing?
- A. The payment is refunded to them after 14 days
- B. The payment stays held forever
- C. ✅ The payment releases to you automatically after 14 days
- D. You must email support to get paid

**Q18** [3.2] The business requests changes after you mark the work delivered. What's next?
- A. The engagement is cancelled
- B. ✅ You update the work and mark it delivered again
- C. The payment releases anyway
- D. You lose the payment

**Q19** [3.3] A business reports a problem. Grassroots decides the work falls short but can be fixed. What are your options?
- A. None, the business is refunded right away
- B. ✅ Redo it once within 5 days, or give the money back
- C. Keep the payment and move on
- D. Start a new listing

**Q20** [3.5] Which statement about reviews is true?
- A. You can edit a review after it's posted
- B. Negative reviews are removed on request
- C. ✅ Reviews are final, and your rating helps move you up the stage ladder
- D. Reviews are optional and don't affect anything

**Q21** [3.6] Which statement about taxes is true?
- A. Grassroots withholds income tax from your payout
- B. You only owe tax if you receive a 1099
- C. ✅ You owe income and self-employment tax on your earnings, whether or not you get a form
- D. You must upload a W-9 before every engagement

### Module 4: Misc (4)

**Q22** [4.1] A client you met on Grassroots offers to pay you directly next month to save fees. What do you do?
- A. Accept, since it's a different project
- B. Accept, but only after 30 days
- C. ✅ Decline. Paid work with them stays on Grassroots for 12 months, and going around it can close your account
- D. Accept, and pay Grassroots the fee yourself

**Q23** [4.2] The engagement has ended. What should you do with the client's login details and customer data?
- A. Keep them for future projects
- B. Use them as portfolio examples
- C. ✅ Return or delete them, and keep them private
- D. Share them with your team for practice

**Q24** [4.3] How should you describe yourself to a client?
- A. As a senior agency consultant
- B. ✅ Honestly, as a student, without overstating your experience
- C. Leave out that you're a student
- D. Use a friend's portfolio to look more experienced

**Q25** [4.4] A client has gone silent for two weeks during the engagement. What's the best step?
- A. Mark the work delivered so you get paid
- B. Stop working and say nothing
- C. ✅ Follow up in messages, then contact Grassroots support early
- D. Message them on personal social media
