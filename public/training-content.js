// training-content.js — consultant onboarding lessons.
// This file is the source of truth for the lesson text. The first draft
// (docs/consultant-training-draft.md) records the decisions behind it.
//
// Quiz questions and answers are NOT here: they live in the database
// (supabase/migrations/seed_training_questions.sql) so the answer key never
// reaches the browser. Grading happens in submit_training_quiz(). If you
// cut a fact from a lesson, check the quiz doesn't still test it.
//
// Wording rule: money is "held in Stripe", never "escrow" (the Terms say
// Grassroots isn't an escrow company; pending a lawyer's review).
// Free ($0) offers are mentioned here because this page is consultant-only.
//
// Lesson shape: { title, intro?, points[], example?: { label, text },
// key?: true, visual? }. `key` marks a lesson as a must-know habit and
// gives it a highlighted card. `visual` adds a graphic, rendered by
// training.js: either "fee-calculator" | "payment-timeline", or an object
// with a `type` and its data:
//   { type: "flow", label, steps: [{ title, note }] }
//   { type: "compare", label, do: { title, items[] }, dont: { title, items[] } }
//   { type: "pairs", label, titles: [dont, do], rows: [[dont, do]] }
//   { type: "scope", label, inside: { title, items[] }, outside: { title, items[] } }
//   { type: "tags", label, do: { title, items[] }, dont: { title, items[] } }
//   { type: "table", label, columns: [a, b], rows: [{ label, values: [bool, bool] }] }
//   { type: "agenda", label, segments: [{ title, share, note }] }  (share: % of the call)
//   { type: "cards", label, cards: [{ title, text, tone?: "good" | "warn" }] }
//   { type: "chips", label, items[] }

// Display copy only. The database enforces both (add_consultant_training.sql).
export const PASS_SCORE = 8;
export const QUIZ_LENGTH = 10;

export const MODULES = [
  {
    id: "before",
    title: "Before the engagement",
    goal: "Show up prepared, price honestly and take on work you can do well.",
    lessons: [
      {
        title: "How Grassroots works",
        visual: {
          type: "flow",
          label: "How an offer turns into a payout",
          steps: [
            { title: "Business posts a listing", note: "What they need help with" },
            { title: "You send an offer", note: "Price, message, files" },
            { title: "They respond", note: "Accept, decline or counter" },
            { title: "Paid and held", note: "Held in Stripe while you work" },
            { title: "You deliver", note: "Then it's paid out to you" },
          ],
        },
        points: [
          "Your offer is a price, and you can add a short note (up to 250 characters) and files.",
          "You need to finish Stripe payout setup first, because the submit button stays off until you do.",
          "You get one offer per listing, and you can't edit it after you send it.",
          "A business can counter your offer up to three times per listing.",
          "When a business accepts, they pay right away, but the money is held in Stripe until you deliver.",
        ],
      },
      {
        title: "Research the business and its industry",
        intro: "Spending ten minutes on homework puts you ahead of most people who apply.",
        points: [
          "Before the first call, look through their website, social media, reviews and competitors.",
          "Learn how their industry markets itself, since a bakery, a law office and a gym all reach customers differently.",
          "Read their customer reviews closely to see what people love and what bothers them.",
          "Write down two or three things you learned and one open question, and bring them to the call.",
          "The owner shouldn't have to explain what their business does, because you should already know.",
        ],
      },
      {
        title: "Show your preparation in the proposal",
        points: [
          "Attach files, examples or early research so the business can see your preparation, not just hear about it.",
          "Start with their problem in their own words, and save your background for later.",
          "Say what you'll deliver, when you'll deliver it and why you're a good fit, and keep it short.",
          "When they finish reading, they should feel like you understand what they need.",
          "Proofread before you send, because a typo in your pitch makes people expect typos in your work.",
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
          "The business pays exactly your offer, with nothing added on their side.",
          "Fees come out of your payout: card processing (2.9% + $0.30) and the platform fee.",
          "The platform fee is 10% of the part of your offer above $10, or 5% during launch.",
          "The offer screen shows how much you'll take home before you send it.",
          "Paid offers start at $10, and you can also send a $0 offer if you want to do the work for free.",
          "You can price the work as a one-time job, in phases (a proposal fee, then a service fee) or as a retainer.",
          "Charge what the work is worth, because underbidding to win teaches clients to undervalue you.",
        ],
      },
      {
        title: "Show up professionally",
        intro: "Clients form an opinion of you in the first minute, so make it easy for them to trust you.",
        visual: {
          type: "compare",
          label: "What to wear on every client call",
          do: { title: "Wear", items: ["Collared shirt", "Blouse", "Plain sweater", "One step above the client"] },
          dont: { title: "Skip", items: ["Hats", "Gym clothes", "Pajamas", "Graphic tees"] },
        },
        points: [
          "Dress business casual on video calls too, and dress a level up if you're meeting a more formal business like a law office.",
          "Pick a quiet, tidy, well-lit spot, and blur your background if it's busy.",
          "Keep your camera on and at eye level, and test your link, camera and mic five minutes before the call.",
          "Join video calls a minute early, and arrive 5 to 10 minutes early for in-person meetings.",
          "Silence your phone and close other tabs so the client has your full attention.",
          "Your profile photo should be clear, friendly and professional too.",
        ],
      },
      {
        title: "Running the discovery call",
        intro: "Before the call, reread the listing, decide what you want to leave with and write down your questions.",
        visual: {
          type: "agenda",
          label: "A simple call agenda",
          segments: [
            { title: "Intros", share: 10, note: "A few minutes" },
            { title: "Their goals", share: 60, note: "Most of the call" },
            { title: "Constraints", share: 18, note: "Budget, timing, approvals" },
            { title: "Next steps", share: 12, note: "Who does what, by when" },
          ],
        },
        points: [
          "Ask open questions, like “What does success look like in three months?” or “What have you already tried?”",
          "Listen more than you pitch, and take notes while they talk.",
          "End the call with a shared picture of the goal and clear next steps.",
          "Within a day, send them a summary in messages so you both have a written record.",
          "To schedule the kickoff, the business picks a length and marks the times they're free, then you choose one and you both get an invite.",
        ],
        example: {
          label: "Example follow-up message",
          text: "Thanks for the call. To confirm, the goal is more weekday lunch orders, and I'll deliver a two-week Instagram plan by Friday. You'll send me your logo files by Wednesday.",
        },
      },
      {
        title: "Asking clarifying questions",
        intro: "Guessing is how projects go wrong, so stop and ask when any of these happen:",
        points: [
          "The goal is fuzzy, like “more customers” or “make it pop.”",
          "You don't know who signs off on the work.",
          "The timeline or budget doesn't fit what they're asking for.",
          "You'd be guessing about their customers, brand or past attempts.",
          "You need logins, assets or data you don't have yet.",
        ],
      },
      {
        title: "Don't promise outcomes",
        visual: {
          type: "pairs",
          label: "Swap the result for the work",
          titles: ["Don't promise", "Promise this instead"],
          rows: [
            ["1,000 new followers", "Four weeks of posts, 3 a week"],
            ["Double the sales", "A redesigned menu and launch post"],
            ["Page one on Google", "Fixed page titles by Friday"],
          ],
        },
        points: [
          "You control the work you do, not how customers react to it, so only promise what you can deliver.",
        ],
      },
      {
        title: "Knowing when to say no, and saying it kindly",
        points: [
          "Some jobs won't be a good fit because they're outside your skills, the timeline is impossible or it's just a bad match.",
          "When that happens, pass politely and leave the door open for future work.",
          "A quick no is always better than saying yes and then going silent.",
        ],
        example: {
          label: "Try saying",
          text: "Thanks for thinking of me. This needs video editing skills I don't have yet, so I'll pass. I'd love to help with your social posts down the line.",
        },
      },
      {
        title: "NDAs and confidentiality",
        points: [
          "You've already agreed to keep a business's private information confidential (Terms section 13), and module 4 covers this in more detail.",
          "If a business wants you to sign its own NDA, read it carefully first and contact support if anything seems odd.",
          "Never sign anything that moves the work or the payment off Grassroots.",
        ],
      },
    ],
  },
  {
    id: "during",
    title: "During the engagement",
    goal: "Keep the client in the loop, keep the scope clear and keep things moving.",
    lessons: [
      {
        title: "Respond on time, every time",
        key: true,
        intro: "Clients notice how fast you reply more than almost anything else, and slow replies lose more work than weak skills do.",
        visual: {
          type: "cards",
          label: "The one-day rule",
          cards: [
            { title: "1 business day", text: "This is the longest you should take to reply to any client message, offer, counter or kickoff.", tone: "good" },
            { title: "Daily", text: "Check your inbox and notifications every day, including during exams and breaks.", tone: "good" },
            { title: "Never silent", text: "To a client, silence looks like you've walked away from the job.", tone: "warn" },
          ],
        },
        points: [
          "If you don't have a full answer yet, reply anyway and say when you'll have one.",
          "Once the business shares its free times, the kickoff is waiting on you to pick one.",
          "If you're going to be hard to reach, tell the client ahead of time, with the dates and when you'll be back.",
          "Going quiet is a common reason clients report a problem.",
          "Communication and timeliness are two of your five ratings, and slow replies hurt both.",
          "If you reply late, apologize briefly and answer the question without a long explanation.",
        ],
        example: {
          label: "A quick reply beats a perfect late one",
          text: "Got it, thanks. I'm checking the numbers and will send a full answer by Thursday at noon.",
        },
      },
      {
        title: "Agree on a communication cadence",
        points: [
          "At kickoff, agree on how often you'll send updates, how fast you'll reply and who you should contact.",
          "Send updates on schedule even when there isn't much to report, since “On track for Friday” still counts.",
          "Keep your conversations in the engagement's message thread so there's a record.",
        ],
        example: {
          label: "Try saying at kickoff",
          text: "I'll send a short update every Monday and Thursday, and I reply to messages within a day. Who should I send questions to?",
        },
      },
      {
        title: "Handling scope creep",
        intro: "A simple “Could you also…” is how a two-week job turns into two months.",
        visual: {
          type: "scope",
          label: "Is it part of the job?",
          inside: { title: "The agreed job", items: ["Revisions to the agreed work", "Questions about what you delivered", "Small fixes inside the plan"] },
          outside: { title: "Goes in a new listing", items: ["A whole new deliverable", "A different channel or platform", "Work after you've delivered"] },
        },
        points: [
          "Learn to spot when a request falls outside what you agreed to.",
          "Calmly explain how the request changes the offer, and ask them to post new work as a new listing.",
          "Don't quietly do extra work for free, because it sets an expectation you can't keep up.",
          "If it keeps happening, contact support and they'll step in to help sort it out.",
        ],
        example: {
          label: "Try saying",
          text: "I'm happy to help with the website too. It's outside what we agreed on, so if you post it as a new listing, I'll send you an offer.",
        },
      },
      {
        title: "Managing your schedule and deadlines",
        points: [
          "If exams, breaks or a packed week will slow you down, tell your clients early.",
          "If you're going to miss a deadline, tell the client the day you know, not the day it's due.",
          "Timeliness is one of the five ratings a business gives you.",
        ],
      },
      {
        title: "Explaining things in plain language",
        points: [
          "Most business owners aren't marketers, so leave out the jargon.",
          "Explain your thinking in a way they can act on.",
          "Start with what it means for their business, and add detail if they ask for it.",
        ],
        example: {
          label: "Instead of “your CTR is low,” try",
          text: "Most people who see your ads aren't clicking. A clearer headline should fix that.",
        },
      },
      {
        title: "Keep asking when you're unsure",
        points: [
          "Clarifying questions don't stop after kickoff, so keep asking whenever you're unsure.",
          "The client is your best source of answers, and asking questions isn't bothering them.",
        ],
      },
      {
        title: "Using AI responsibly",
        visual: {
          type: "tags",
          label: "AI at work",
          do: { title: "Fine", items: ["First drafts", "Brainstorming", "Research you double-check"] },
          dont: { title: "Not okay", items: ["Client data without their OK", "Facts you didn't verify", "Unreviewed output"] },
        },
        points: [
          "Even if AI wrote the first draft, you're responsible for the facts, the tone and making sure it's original.",
          "Be ready to tell the client how you used AI if they ask.",
        ],
      },
    ],
  },
  {
    id: "after",
    title: "Delivering and getting paid",
    goal: "Finish cleanly, get paid on time and earn a review you're proud of.",
    lessons: [
      {
        title: "Feedback isn't the same as marking work done",
        points: [
          "Share the work, ask what they think and make revisions where the job calls for them.",
          "Only mark the work delivered once the client has everything they need.",
          "Marking work done too early wears down trust, and clients notice when it happens.",
        ],
      },
      {
        title: "How the payment hold and release work",
        visual: "payment-timeline",
        points: [
          "Once you mark the work delivered, the business has 14 days to release the payment, request changes or report a problem, and they get a reminder on day 7.",
          "If they do nothing, the payment releases to you automatically on day 14.",
          "If they request changes, update the work and mark it delivered again, which restarts the 14 days.",
          "For retainers, each period's 14 days start when the period ends, but you can mark it delivered early to start sooner.",
          "Proposal fees are released once the business decides whether to move forward.",
          "Anything still held 90 days after the charge goes to the Grassroots team for review and won't release on its own.",
          "After release, the money goes to your Stripe balance and then to your bank, usually within about 2 business days.",
        ],
      },
      {
        title: "When a business reports a problem",
        intro: "The payment is locked while Grassroots looks into it, and it ends in one of three ways:",
        visual: {
          type: "cards",
          label: "Possible outcomes",
          cards: [
            { title: "Meets scope", text: "The payment is released to you.", tone: "good" },
            { title: "Fixable", text: "You can redo the work once within 5 days or give the money back, and not answering within 5 days counts as giving it back." },
            { title: "Scope breached", text: "The business gets a full refund.", tone: "warn" },
          ],
        },
        points: [
          "A one-time job can also be cancelled for a full refund within 24 hours of payment.",
          "Once a payment is released, it's final.",
        ],
      },
      {
        title: "Hold a closing meeting when you can",
        points: [
          "Walk the client through the final work live and answer their questions.",
          "Hand over everything, including final files, any how-to notes and suggested next steps.",
          "Return or delete any logins and private data they shared with you.",
          "Mark the work done together during the meeting, since it's the smoothest way to wrap up.",
        ],
      },
      {
        title: "Reviews",
        visual: {
          type: "chips",
          label: "The five things a business rates you on",
          items: ["Work quality", "Communication", "Timeliness", "Professionalism", "Cost value"],
        },
        points: [
          "Reviews can't be edited, and a negative review isn't removed just because it's negative.",
          "Your rating and the number of engagements you complete move you up the stage ladder, from seedling to sequoia.",
          "Ask for a review every time you finish an engagement.",
        ],
      },
      {
        title: "Taxes and 1099s",
        points: [
          "You're an independent contractor, not an employee.",
          "If you pass the IRS reporting thresholds, Grassroots sends you a tax form through Stripe, like a 1099-K or 1099-NEC.",
          "The form uses the tax info you gave Stripe during payout setup, so there's no W-9 to upload.",
          "You owe income and self-employment tax on what you earn, whether or not you get a form. This isn't tax advice.",
          "You can update your bank or tax info any time on the payouts page.",
        ],
      },
    ],
  },
  {
    id: "trust",
    title: "Professionalism and trust",
    goal: "These rules apply before, during and after every engagement.",
    lessons: [
      {
        title: "Keep everything on Grassroots",
        visual: {
          type: "table",
          label: "Why it stays on the platform",
          columns: ["On Grassroots", "Off-platform"],
          rows: [
            { label: "Payment held until you deliver", values: [true, false] },
            { label: "Refunds and support if things go wrong", values: [true, false] },
            { label: "Tax reporting handled", values: [true, false] },
            { label: "Keeps your account in good standing", values: [true, false] },
          ],
        },
        points: [
          "Keep your messages and payments on the platform.",
          "For 12 months after you meet a client here, don't move paid work with them off the platform.",
          "Doing so breaks Terms section 11 and can get your account suspended or closed.",
        ],
      },
      {
        title: "Confidentiality",
        points: [
          "Treat client data, logins, numbers and customer lists as private.",
          "Only use them for the engagement, and return or delete them when it ends or when the client asks (Terms section 13).",
          "This lasts for 2 years after the engagement, and forever for trade secrets and customer data.",
          "Ask the client before you put their work in your portfolio.",
        ],
      },
      {
        title: "Represent yourself honestly",
        points: [
          "Be upfront that you're a student, and don't oversell your experience.",
          "Using fake credentials or pretending to be someone else can get you banned.",
        ],
      },
      {
        title: "Escalate when needed",
        points: [
          "If a client goes quiet, seems unhappy or asks for something that feels off, contact support early.",
          "For disagreements, try to work it out in the inbox first, and if you can't agree after 7 days, email support with the bid ID.",
          "Support replies within 2 business days.",
        ],
      },
    ],
  },
];
