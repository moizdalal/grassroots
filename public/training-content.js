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
          "Your offer is a price, plus an optional note (250 characters max) and files.",
          "Finish Stripe payout setup first. The submit button stays off until you do.",
          "Offers are final. You can't edit one, and you get one per listing.",
          "A business can counter up to three times per listing.",
          "Accepted means paid, not yours yet. The money waits in Stripe until you deliver.",
        ],
      },
      {
        title: "Research the business and its industry",
        intro: "Ten minutes of homework puts you ahead of most people who apply.",
        points: [
          "Look through their website, socials, reviews and competitors before the first call.",
          "Learn how their industry markets itself. A bakery isn't a law office, and neither is a gym.",
          "Read their customer reviews closely. You'll see what people love and what bugs them.",
          "Write down two or three things you learned and one open question. Bring them to the call.",
          "Never make the owner explain what their business does. You should already know.",
        ],
      },
      {
        title: "Show your preparation in the proposal",
        points: [
          "Attach files, examples or early research. Show, don't just tell.",
          "Start with their problem in their words. Your résumé can wait.",
          "Say what you'll deliver, when, and why you're the right fit. Keep it tight.",
          "They should finish reading and think, this person gets it.",
          "Proofread before you send. A typo in the pitch hints at typos in the work.",
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
          "The business pays exactly your offer. Nothing gets added on their side.",
          "Fees come out of your payout: card processing (2.9% + $0.30) and the platform fee.",
          "The platform fee is 10% of the part above $10. During launch it's 5%.",
          "You'll see your take-home on the offer screen before you send.",
          "Paid offers start at $10. You can also send a $0 offer for free work.",
          "You can price one-time, phased (a proposal fee, then a service fee) or as a retainer.",
          "Price what the work is worth. Underbidding to win teaches clients to undervalue you.",
        ],
      },
      {
        title: "Show up professionally",
        intro: "Clients size you up in the first minute. Make it easy for them to trust you.",
        visual: {
          type: "compare",
          label: "What to wear on every client call",
          do: { title: "Wear", items: ["Collared shirt", "Blouse", "Plain sweater", "One step above the client"] },
          dont: { title: "Skip", items: ["Hats", "Gym clothes", "Pajamas", "Graphic tees"] },
        },
        points: [
          "Business casual applies on video too. Meeting a law office? Dress a level up.",
          "Pick a quiet, tidy, well-lit spot. Blur the background if it's busy.",
          "Camera on, at eye level. Test your link, camera and mic five minutes before.",
          "Join video calls a minute early. Arrive 5 to 10 minutes early in person.",
          "Silence your phone and close the other tabs. They get your full attention.",
          "Same goes for your profile photo: clear, friendly and professional.",
        ],
      },
      {
        title: "Running the discovery call",
        intro: "Know what you want to leave with. Reread the listing and write your questions first.",
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
          "Ask open questions: “What does success look like in three months?” or “What have you tried?”",
          "Listen more than you pitch, and take notes while they talk.",
          "Wrap up with a shared picture of the goal and agreed next steps.",
          "Within a day, write it back to them in messages. Now you both have a record.",
          "For the kickoff, the business picks a length and marks free times. You choose one, and you both get an invite.",
        ],
        example: {
          label: "Example follow-up message",
          text: "Thanks for the call. To confirm: the goal is more weekday lunch orders. I'll deliver a two-week Instagram plan by Friday. You'll send logo files by Wednesday.",
        },
      },
      {
        title: "Asking clarifying questions",
        intro: "Guessing is how projects go sideways. Stop and ask when:",
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
          "You control the work, not how customers react to it. Commit to what you can deliver.",
        ],
      },
      {
        title: "Knowing when to say no, and saying it kindly",
        points: [
          "Some jobs won't fit: outside your skills, an impossible timeline or just a bad match.",
          "Pass politely and leave the door open for next time.",
          "A quick no beats a yes followed by silence. Every time.",
        ],
        example: {
          label: "Try saying",
          text: "Thanks for thinking of me. This needs video editing skills I don't have yet, so I'll pass. I'd love to help with your social posts down the line.",
        },
      },
      {
        title: "NDAs and confidentiality",
        points: [
          "You've already agreed to keep a business's private info confidential (Terms section 13). Module 4 has more.",
          "If a business wants you to sign its own NDA, read it first. Anything odd? Contact support.",
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
        intro: "Clients notice reply speed more than anything else. Slow replies lose more work than weak skills.",
        visual: {
          type: "cards",
          label: "The one-day rule",
          cards: [
            { title: "1 business day", text: "Your max reply time for any client message, offer, counter or kickoff.", tone: "good" },
            { title: "Daily", text: "Check your inbox and notifications, exams and breaks included.", tone: "good" },
            { title: "Never silent", text: "To a client, silence looks like you walked away.", tone: "warn" },
          ],
        },
        points: [
          "No full answer yet? Reply anyway and say when you'll have one.",
          "Once the business shares its free times, the kickoff is waiting on you to pick one.",
          "Going to be hard to reach? Tell the client ahead of time, with dates and when you'll be back.",
          "Going quiet is a common reason clients report a problem.",
          "Communication and timeliness are two of your five ratings. Slow replies hurt both.",
          "Replied late? Apologize briefly and answer the question. Skip the long explanation.",
        ],
        example: {
          label: "A quick reply beats a perfect late one",
          text: "Got it, thanks. I'm checking the numbers and will send a full answer by Thursday at noon.",
        },
      },
      {
        title: "Agree on a communication cadence",
        points: [
          "Settle it at kickoff: how often you'll update, how fast you'll reply and who to contact.",
          "Send updates on schedule, even quiet ones. “On track for Friday” counts.",
          "Keep it in the engagement's message thread so there's a record.",
        ],
        example: {
          label: "Try saying at kickoff",
          text: "I'll send a short update every Monday and Thursday, and I reply to messages within a day. Who should I send questions to?",
        },
      },
      {
        title: "Handling scope creep",
        intro: "“Could you also…” is how a two-week job turns into two months.",
        visual: {
          type: "scope",
          label: "Is it part of the job?",
          inside: { title: "The agreed job", items: ["Revisions to the agreed work", "Questions about what you delivered", "Small fixes inside the plan"] },
          outside: { title: "Goes in a new listing", items: ["A whole new deliverable", "A different channel or platform", "Work after you've delivered"] },
        },
        points: [
          "Learn to spot a request that falls outside what you agreed.",
          "Calmly explain how it changes the offer. New work goes in a new listing.",
          "Don't quietly do extra work for free. It sets an expectation you can't keep.",
          "If it keeps happening, contact support. They'll step in and mediate.",
        ],
        example: {
          label: "Try saying",
          text: "Happy to help with the website too. It's outside what we agreed, so post it as a new listing and I'll send an offer.",
        },
      },
      {
        title: "Managing your schedule and deadlines",
        points: [
          "Exams, breaks, a packed week: tell clients early.",
          "Going to miss a deadline? Say so the day you know, not the day it's due.",
          "Timeliness is one of the five ratings a business gives you.",
        ],
      },
      {
        title: "Explaining things in plain language",
        points: [
          "Most owners aren't marketers. Leave the jargon out.",
          "Explain your thinking in a way they can act on.",
          "Lead with what it means for their business. Add detail if they ask.",
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
          "The client is your best source. Asking isn't bothering them.",
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
          "You own the facts, the tone and the originality, whoever wrote the first draft.",
          "Be ready to tell the client how you used it.",
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
          "Share the work, ask what they think and revise where the job calls for it.",
          "Mark it delivered only when the client has everything they need.",
          "Marking it done too early chips away at trust, and clients notice.",
        ],
      },
      {
        title: "How the payment hold and release work",
        visual: "payment-timeline",
        points: [
          "Once you mark it delivered, the business has 14 days to release, request changes or report a problem. They're reminded on day 7.",
          "If they do nothing, the payment releases to you automatically on day 14.",
          "If they request changes, update the work and mark it delivered again. The 14 days restart.",
          "Retainers: each period's 14 days start when the period ends. Mark it delivered early to start sooner.",
          "Proposal fees release once the business decides whether to move forward.",
          "Anything still held 90 days after the charge goes to the Grassroots team for review. It won't release on its own.",
          "After release, the money lands in Stripe, then your bank, usually in about 2 business days.",
        ],
      },
      {
        title: "When a business reports a problem",
        intro: "The payment locks while Grassroots takes a look. It ends one of three ways:",
        visual: {
          type: "cards",
          label: "Possible outcomes",
          cards: [
            { title: "Meets scope", text: "The payment is released to you.", tone: "good" },
            { title: "Fixable", text: "Redo it once within 5 days, or give the money back. No answer in 5 days counts as giving it back." },
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
          "Hand over everything: final files, any how-to notes and suggested next steps.",
          "Return or delete any logins and private data they shared.",
          "Mark it done together in that meeting. It's the smoothest way to wrap up.",
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
          "Reviews can't be edited. A negative one isn't removed just for being negative.",
          "Your rating and engagement count move you up the stage ladder, from seedling to sequoia.",
          "Ask for a review every time you wrap up.",
        ],
      },
      {
        title: "Taxes and 1099s",
        points: [
          "You're an independent contractor, not an employee.",
          "If you cross the IRS reporting thresholds, Grassroots (through Stripe) sends you a tax form, like a 1099-K or 1099-NEC.",
          "It uses the tax info you gave Stripe during payout setup. There's no W-9 to upload.",
          "You owe income and self-employment tax on what you earn, form or no form. This isn't tax advice.",
          "Update your bank or tax info any time on the payouts page.",
        ],
      },
    ],
  },
  {
    id: "trust",
    title: "Professionalism and trust",
    goal: "These hold before, during and after every engagement.",
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
          "Messages and payments stay on the platform.",
          "For 12 months after you meet someone here, don't move paid work with them off-platform.",
          "Doing it anyway breaks Terms section 11 and can get your account suspended or closed.",
        ],
      },
      {
        title: "Confidentiality",
        points: [
          "Client data, logins, numbers and customer lists are private. Treat them that way.",
          "Use them only for the engagement. Return or delete them when it ends, or when asked (Terms section 13).",
          "This lasts 2 years after the engagement, and forever for trade secrets and customer data.",
          "Ask before you put their work in your portfolio.",
        ],
      },
      {
        title: "Represent yourself honestly",
        points: [
          "Be upfront that you're a student. Don't oversell your experience.",
          "Fake credentials or pretending to be someone else can get you banned.",
        ],
      },
      {
        title: "Escalate when needed",
        points: [
          "Client gone quiet, unhappy or asking for something that feels off? Contact support early.",
          "For disagreements, try the inbox first. No agreement after 7 days? Email support with the bid ID.",
          "Support replies within 2 business days.",
        ],
      },
    ],
  },
];
