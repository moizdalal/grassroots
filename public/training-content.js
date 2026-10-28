// training-content.js — consultant onboarding lessons.
// This file is the source of truth for the lesson text. The first draft
// (docs/consultant-training-draft.md) records the decisions behind it.
//
// Quiz questions and answers are NOT here: they live in the database
// (supabase/migrations/seed_training_questions.sql) so the answer key never
// reaches the browser. Grading happens in submit_training_quiz().
//
// Wording rule: money is "held in Stripe", never "escrow" (the Terms say
// Grassroots isn't an escrow company; pending a lawyer's review).
// Free ($0) offers are mentioned here because this page is consultant-only.
//
// Lesson shape: { title, intro?, points[], example?: { label, text },
// key?: true, visual?: "fee-calculator" | "payment-timeline" }. `key`
// marks a lesson as a must-know habit and gives it a highlighted card.
// `visual` adds an interactive graphic, rendered by training.js.

// Display copy only. The database enforces both (add_consultant_training.sql).
export const PASS_SCORE = 8;
export const QUIZ_LENGTH = 10;

export const MODULES = [
  {
    id: "before",
    title: "Before the engagement",
    goal: "You show up prepared, price honestly and only take work you can do well.",
    lessons: [
      {
        title: "How Grassroots works",
        points: [
          "Businesses post listings. You send an offer: a price, an optional message of up to 250 characters, and optional files.",
          "You need to finish Stripe payout setup before you can send an offer. Until then, the submit button stays off.",
          "You can't edit an offer after you send it, and you get one offer per listing.",
          "A business can accept, decline or counter. Each business gets up to three counters per listing.",
          "When a business accepts, it pays the full offer right away and the payment is held in Stripe. You don't have it yet. It's paid out after you deliver.",
        ],
      },
      {
        title: "Research the business and its industry",
        points: [
          "Before the first call, look at their website, socials, reviews and competitors.",
          "Learn the norms of their industry. A bakery, a law office and a gym market themselves very differently.",
          "Read their customer reviews. They tell you what customers already love and what they complain about.",
          "Note two or three things you learned and one question you still have. Bring them to the first call.",
          "Show up already knowing the basics. Don't make the owner explain what their business does.",
        ],
      },
      {
        title: "Show your preparation in the proposal",
        points: [
          "Attach relevant files, examples or early research to your offer.",
          "Open with their problem in their words, not with your résumé.",
          "Say what you'll deliver, by when, and why you're a good fit. Keep it short.",
          "The client should see that you've done your homework and know what you're talking about.",
          "Proofread it. Typos in a proposal suggest typos in the work.",
        ],
        example: {
          label: "Example offer message",
          text: "Your reviews praise the coffee but rarely mention the pastries. I'll plan four weeks of posts that put them front and center, ready in 10 days.",
        },
      },
      {
        title: "How pricing works",
        visual: "fee-calculator",
        points: [
          "The business pays exactly your offer. Nothing is added on top.",
          "Your payout is the offer minus card processing (2.9% + $0.30) and the platform fee: 10% of the part above $10, or 5% during launch.",
          "The offer screen shows your take-home before you send it.",
          "Paid offers are at least $10. You can also send a $0 offer for free work.",
          "Pricing models are one-time, phased (a proposal fee, then a service fee) and retainer.",
          "Price honestly. Don't underbid just to win the work.",
        ],
      },
      {
        title: "Show up professionally",
        intro: "Clients judge you in the first minute of a call. Look and act like someone they'd trust with their business.",
        points: [
          "Dress business casual for every client call: a clean, plain top like a collared shirt, blouse or sweater.",
          "Skip hats, gym clothes, pajamas and graphic tees, even on video.",
          "When in doubt, dress one step above the client. Meeting a law office? Go a level up.",
          "On video, pick a quiet, tidy, well-lit spot. Use background blur if your space is busy.",
          "Keep your camera on and at eye level. Test your link, camera and mic five minutes before.",
          "Join a minute early. For in-person meetings, arrive 5 to 10 minutes early.",
          "Silence your phone and close other tabs. Give the client your full attention.",
          "Your profile photo follows the same rule: a clear, friendly, professional headshot.",
        ],
      },
      {
        title: "Running the discovery call",
        points: [
          "Prepare: reread the listing, write your questions and know what you want to leave with.",
          "Use a simple agenda. Take a few minutes for introductions, most of the call for their goals, then constraints and next steps.",
          "Ask open questions, like “What does success look like in three months?” or “What have you tried before?”",
          "Listen more than you pitch. Take notes as they talk.",
          "End with a clear, shared picture of the goal and agreed next steps.",
          "Within a day, write it back to them in messages so you both have a record.",
          "For the kickoff, the business picks a length and marks its free times. You choose a time inside those, and both of you get a calendar invite.",
        ],
        example: {
          label: "Example follow-up message",
          text: "Thanks for the call. To confirm: the goal is more weekday lunch orders. I'll deliver a two-week Instagram plan by Friday. You'll send logo files by Wednesday.",
        },
      },
      {
        title: "Asking clarifying questions",
        intro: "Stop and ask when:",
        points: [
          "The goal is vague (“more customers,” “make it pop”).",
          "It's unclear who approves the work.",
          "The timeline or budget doesn't match the ask.",
          "You'd be guessing about their customer, brand or past attempts.",
          "You need logins, assets or data you don't have yet.",
        ],
      },
      {
        title: "Don't promise outcomes",
        points: [
          "Commit to the work you'll deliver.",
          "Don't promise results you can't control, like follower counts or sales numbers.",
        ],
      },
      {
        title: "Knowing when to say no, and saying it kindly",
        points: [
          "Some work will be outside your skills, on an unrealistic timeline or a poor fit.",
          "Turn it down respectfully and leave the door open.",
          "Saying no quickly is kinder than saying yes and disappearing.",
        ],
        example: {
          label: "Try saying",
          text: "Thanks for thinking of me. This needs video editing skills I don't have yet, so I'll pass. I'd love to help with your social posts down the line.",
        },
      },
      {
        title: "NDAs and confidentiality",
        points: [
          "The Terms already commit you to keeping a business's private information confidential (section 13). Module 4 covers this.",
          "If a business asks you to sign its own NDA, read it first. Contact support if anything looks unusual.",
          "Never sign anything that moves the work or the payment off Grassroots.",
        ],
      },
    ],
  },
  {
    id: "during",
    title: "During the engagement",
    goal: "Keep the client informed, keep the scope clear and keep the work moving.",
    lessons: [
      {
        title: "Respond on time, every time",
        key: true,
        intro: "Fast, reliable replies are the habit clients notice most. Slow replies lose more work than weak skills do.",
        points: [
          "Reply to every client message within one business day, even if only to say when you'll have a full answer.",
          "Do the same for offers, counters and kickoff scheduling. After the business shares its free times, the kickoff waits on you to pick one.",
          "Check your Grassroots inbox and notifications at least once a day, including during exams and breaks.",
          "If you'll be hard to reach, tell the client ahead of time. Give the dates and when they'll hear from you next.",
          "Never go silent. To a client, silence looks like you've walked away, and it's a common reason they report a problem.",
          "Communication and timeliness are two of the five ratings a business gives you. Slow replies cost you on both.",
          "If you do reply late, apologize briefly and answer the question. Don't over-explain.",
        ],
        example: {
          label: "A quick reply beats a perfect late one",
          text: "Got it, thanks. I'm checking the numbers and will send a full answer by Thursday at noon.",
        },
      },
      {
        title: "Agree on a communication cadence",
        points: [
          "At kickoff, agree how often you'll send updates, how fast you'll reply and who the point of contact is.",
          "Send updates on schedule even when there's little news. “On track for Friday” is a useful update.",
          "Use the engagement's message thread so there's a record.",
        ],
        example: {
          label: "Try saying at kickoff",
          text: "I'll send a short update every Monday and Thursday, and I reply to messages within a day. Who should I send questions to?",
        },
      },
      {
        title: "Handling scope creep",
        points: [
          "Learn to spot a new request that falls outside the agreed scope.",
          "Explain calmly how it changes the offer. New work goes in a new listing, not the current engagement.",
          "Don't quietly do extra work for free. It sets an expectation you can't keep up.",
          "If it keeps happening, contact support. They'll mediate.",
        ],
        example: {
          label: "Try saying",
          text: "Happy to help with the website too. It's outside what we agreed, so post it as a new listing and I'll send an offer.",
        },
      },
      {
        title: "Managing your schedule and deadlines",
        points: [
          "Be upfront about exams, breaks and busy weeks.",
          "If you'll miss a deadline, say so the day you know.",
          "Timeliness is one of the five ratings the business gives you.",
        ],
      },
      {
        title: "Explaining things in plain language",
        points: [
          "Most owners aren't marketers. Skip the jargon.",
          "Explain your thinking in terms they can act on.",
          "Lead with what it means for their business, then add detail if they want it.",
        ],
        example: {
          label: "Instead of “your CTR is low,” try",
          text: "Most people who see your ads aren't clicking. A clearer headline should fix that.",
        },
      },
      {
        title: "Keep asking when you're unsure",
        points: [
          "Clarifying questions don't stop after kickoff.",
          "Treat the client as a resource, not someone to avoid bothering.",
        ],
      },
      {
        title: "Using AI responsibly",
        points: [
          "AI is fine for drafts, brainstorming and research that you check yourself.",
          "Check its output carefully. You're responsible for the facts, the tone and the originality.",
          "Be ready to tell the client how you used it.",
          "Never put a client's private data into an AI tool without their OK.",
        ],
      },
    ],
  },
  {
    id: "after",
    title: "Delivering and getting paid",
    goal: "Finish cleanly, get paid on time and earn a strong review.",
    lessons: [
      {
        title: "Feedback isn't the same as marking work done",
        points: [
          "Share the work, ask for feedback and revise where the engagement calls for it.",
          "Only mark it delivered once the client has everything they need.",
          "Marking it done too early hurts trust, and the client is less likely to respond well.",
        ],
      },
      {
        title: "How the payment hold and release work",
        visual: "payment-timeline",
        points: [
          "When you mark the work delivered, the business has 14 days to release payment, request changes or report a problem. They get a reminder on day 7.",
          "If they do nothing, the payment releases to you automatically after 14 days.",
          "If they request changes, update the work and mark it delivered again. The 14 days start over.",
          "Retainers: each period's 14 days start when the period ends. You can mark a period delivered early to start them sooner.",
          "Proposal fees release once the business decides whether to move forward.",
          "Anything still held 90 days after the charge goes to the Grassroots team for review. It doesn't release automatically.",
          "Once released, the money goes to your Stripe account and then to your bank, usually in about 2 business days.",
        ],
      },
      {
        title: "When a business reports a problem",
        intro: "The payment locks while Grassroots reviews it. There are three outcomes:",
        points: [
          "The work meets scope: the payment is released to you.",
          "It falls short but can be fixed: you have 5 days to redo it once, or give the money back. No answer in 5 days counts as giving it back.",
          "Scope was breached: the business gets a full refund.",
          "A one-time job can also be cancelled for a full refund within 24 hours of payment. Once a payment is released, it's final.",
        ],
      },
      {
        title: "Hold a closing meeting when you can",
        points: [
          "Walk the client through the final work live and answer their questions.",
          "Hand over everything they need: final files, any how-to notes and suggested next steps.",
          "Return or delete any logins and private data they shared with you.",
          "Mark it done together in the same meeting. It's the smoothest way to close out.",
        ],
      },
      {
        title: "Reviews",
        points: [
          "The business rates you on five things: work quality, communication, timeliness, professionalism and cost value.",
          "Reviews can't be edited, and negative ones aren't removed just for being negative.",
          "Your rating and engagement count move you up the stage ladder, from seedling to sequoia.",
          "Ask for a review as part of every wrap-up.",
        ],
      },
      {
        title: "Taxes and 1099s",
        points: [
          "You're an independent contractor, not an employee.",
          "Grassroots, through Stripe, issues tax forms (like a 1099-K or 1099-NEC) to consultants who cross the IRS reporting thresholds.",
          "The tax info you gave Stripe during payout setup is what's used. There's no separate W-9 to upload.",
          "You owe income tax and self-employment tax on what you earn, whether or not you get a form. This isn't tax advice.",
          "Update your bank or tax info any time on the payouts page.",
        ],
      },
    ],
  },
  {
    id: "trust",
    title: "Professionalism and trust",
    goal: "These apply before, during and after every engagement.",
    lessons: [
      {
        title: "Keep everything on Grassroots",
        points: [
          "Communication and payment stay on the platform.",
          "For 12 months after you meet someone on Grassroots, don't move paid work with them off-platform (Terms section 11).",
          "Going off-platform skips the payment hold, refunds and tax reporting. It can get your account suspended or closed.",
        ],
      },
      {
        title: "Confidentiality",
        points: [
          "Treat client data, logins, numbers and customer lists as private.",
          "Use them only for the engagement. Return or delete them when it ends, or when the client asks (Terms section 13).",
          "This duty lasts 2 years after the engagement, and forever for trade secrets and the business's customer data.",
          "Ask before you show their work in your portfolio.",
        ],
      },
      {
        title: "Represent yourself honestly",
        points: [
          "Be clear that you're a student. Don't overstate your experience.",
          "Fake credentials or impersonation can get you banned.",
        ],
      },
      {
        title: "Escalate when needed",
        points: [
          "If a client goes silent, is unhappy or asks for something that feels wrong, contact support early.",
          "For disagreements, try the inbox first. After 7 days with no agreement, email support with the bid ID.",
          "Support replies within 2 business days.",
        ],
      },
    ],
  },
];
