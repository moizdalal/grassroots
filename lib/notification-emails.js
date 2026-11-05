// Subject and body for each engagement email. The server always builds
// these from the event and the bid; clients only name the event.
//
// Voice (brandkit.md): sentence case, second person, short sentences, no
// exclamation points. Business-facing emails never mention free offers.
//
// Subjects start with one emoji for good news or a call to act. Declines
// and withdrawals get none. Inside the email the glyph does that job.
//
// consultantName / businessName come from emailUser's lookup in app.js and
// may be missing, so every use has a fallback.

const { renderEmail } = require("./email-template");

function usd(cents) {
  const n = Number(cents || 0) / 100;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

// Always two decimals, for line items that must align.
function usdExact(cents) {
  return `$${(Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function day(ms) {
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function hourAndDay(ms) {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

const listingPath = (d) => `/listing.html?id=${d.listingId}`;
const engagementPath = (d) => d.link || `/engagement.html?bid=${d.bidId}`;
const paid = (d) => Number(d.amountCents) > 0;

const REASON = {
  owner: "You're getting this because you posted a listing on Grassroots.",
  hired: "You're getting this because you hired a consultant on Grassroots.",
  offered: "You're getting this because you made an offer on Grassroots.",
  working: "You're getting this because you're working on a Grassroots engagement.",
  paid: "You're getting this because you were paid on Grassroots.",
  joined: "You're getting this because you just created a Grassroots account.",
};

const welcomeHeading = (d) => (firstName(d.fullName) ? `Welcome to Grassroots, ${firstName(d.fullName)}` : "Welcome to Grassroots");

// Each builder takes the event data and returns the message parts.
const BUILDERS = {
  // Sent once, right after signup.
  welcome_business: (d) => ({
    subject: "🌱 Welcome to Grassroots",
    preheader: "Post a listing and student consultants will send offers.",
    glyph: "accepted",
    heading: welcomeHeading(d),
    intro: "Your account is ready. Post a listing and student consultants will send you offers. You pay when you hire, and we hold the money until you approve the delivered work.",
    cta: { label: "Post a listing", path: "/create-listing.html" },
    secondary: { label: "Finish your profile", path: "/profile.html" },
    reason: REASON.joined,
  }),

  welcome_consultant: (d) => ({
    subject: "🌱 Welcome to Grassroots",
    preheader: "Finish your profile, then send offers on listings that fit.",
    glyph: "accepted",
    heading: welcomeHeading(d),
    intro: "Your account is ready. Local businesses post projects, and you send offers on the ones that fit. Finish your profile first, since businesses read it before they accept.",
    cta: { label: "Browse listings", path: "/marketplace.html" },
    secondary: { label: "Finish your profile", path: "/profile.html" },
    reason: REASON.joined,
  }),

  // To the business.
  offer_received: (d) => {
    const who = d.consultantName || "A consultant";
    return {
      subject: `📬 New offer on "${d.title}"`,
      preheader: paid(d) ? `${who} offered ${usd(d.amountCents)}. Accept, counter or decline.` : `${who} sent an offer. Accept, counter or decline.`,
      glyph: "offer",
      heading: "You have a new offer",
      intro: `${who} sent an offer on your listing.`,
      facts: [
        ...(paid(d) ? [{ label: "Offer", value: usd(d.amountCents) }] : []),
        ...(d.consultantName ? [{ label: "From", value: d.consultantName }] : []),
      ],
      outro: "Accept, counter or decline from your listing.",
      cta: { label: "Review the offer", path: listingPath(d) },
      reason: REASON.owner,
    };
  },

  // To the consultant.
  counter_received: (d) => {
    const biz = d.businessName || "The business";
    return {
      subject: `⏳ Counter offer on "${d.title}"`,
      preheader: d.expiresAt
        ? `${biz} countered at ${usd(d.counterCents)}. Respond by ${hourAndDay(Date.parse(d.expiresAt))}.`
        : `${biz} countered at ${usd(d.counterCents)}.`,
      glyph: "counter",
      heading: `${biz} countered at ${usd(d.counterCents)}`,
      intro: "Accept it, decline it, or let it lapse.",
      facts: [
        ...(d.amountCents != null ? [{ label: "Your offer", value: usd(d.amountCents), struck: true, plain: true }] : []),
        { label: "Counter", value: usd(d.counterCents) },
        ...(d.expiresAt ? [{ label: "Respond by", value: hourAndDay(Date.parse(d.expiresAt)) }] : []),
      ],
      note: d.note ? { name: d.businessName, text: d.note } : null,
      outro: d.expiresAt
        ? `If you don't respond, it reverts to ${d.amountCents != null ? `your ${usd(d.amountCents)}` : "your price"}.`
        : "You have 24 hours to respond.",
      cta: { label: "Respond to the counter", path: listingPath(d) },
      reason: REASON.offered,
    };
  },

  // To the business.
  counter_accepted: (d) => ({
    subject: "🤝 Your counter was accepted",
    preheader: `${d.consultantName || "The consultant"} agreed to ${usd(d.amountCents)}. Pay to start the work.`,
    glyph: "counter",
    heading: "Your counter was accepted",
    intro: `${d.consultantName || "The consultant"} agreed to your price.`,
    facts: [{ label: "Agreed price", value: usd(d.amountCents) }],
    note: d.note ? { name: d.consultantName, text: d.note } : null,
    outro: "Accept the offer and pay to start the work.",
    cta: { label: "Finish the deal", path: listingPath(d) },
    reason: REASON.owner,
  }),

  counter_declined: (d) => ({
    subject: "Your counter was declined",
    preheader: `${firstName(d.consultantName) || "The consultant"} kept the ${usd(d.amountCents)} offer. It's still open.`,
    glyph: "declined",
    heading: "Your counter was declined",
    intro: `${d.consultantName || "The consultant"} kept their original offer.`,
    facts: [{ label: "Offer, still open", value: usd(d.amountCents) }],
    note: d.note ? { name: d.consultantName, text: d.note } : null,
    cta: { label: "See the offer", path: listingPath(d) },
    reason: REASON.owner,
  }),

  counter_rescinded: (d) => ({
    subject: `An offer on "${d.title}" was withdrawn`,
    preheader: "The consultant withdrew after your counter. Your other offers are still open.",
    glyph: "declined",
    heading: `${d.consultantName || "The consultant"} withdrew their offer`,
    intro: "They withdrew after your counter. Your other offers are still open.",
    note: d.note ? { name: d.consultantName, text: d.note } : null,
    cta: { label: "See your offers", path: listingPath(d) },
    reason: REASON.owner,
  }),

  // To the consultant.
  offer_accepted: (d) => {
    const biz = d.businessName || "The business";
    return {
      subject: `🌱 Your offer on "${d.title}" was accepted`,
      preheader: paid(d)
        ? `${biz} paid ${usd(d.amountCents)}. Next, pick a kickoff time.`
        : `${biz} accepted. Next, pick a kickoff time.`,
      glyph: "accepted",
      heading: "Your offer was accepted",
      intro: paid(d) ? `${biz} accepted and paid. The work is yours.` : `${biz} accepted your free offer.`,
      stem: "kickoff",
      facts: paid(d)
        ? [{ label: "Paid", value: usd(d.amountCents) }, { label: "Held by", value: "Grassroots, until delivery" }]
        : [],
      outro: "Next, pick a kickoff time once they share availability.",
      cta: { label: "Open the engagement", path: engagementPath(d) },
      reason: REASON.offered,
    };
  },

  // To the business.
  work_delivered: (d) => {
    const who = d.consultantName || "Your consultant";
    const whoFirst = firstName(d.consultantName) || "your consultant";
    const heading = d.label && d.label !== "Payment"
      ? `${d.label} marked delivered`
      : `${firstName(d.consultantName) || "Your consultant"} marked the work delivered`;
    return {
      subject: `📦 "${d.title}" was delivered`,
      preheader: d.free
        ? `Review it by ${day(d.reviewByMs)}.`
        : `Review it by ${day(d.reviewByMs)}. Then Grassroots releases ${usd(d.amountCents)} to ${whoFirst}.`,
      glyph: "delivered",
      heading,
      intro: "Take a look, then approve it or ask for changes.",
      stem: "delivered",
      facts: [
        { label: "Review by", value: day(d.reviewByMs) },
        d.free
          ? { label: "Then", value: "Marked complete" }
          : { label: `Then released to ${whoFirst}`, value: paid(d) ? usd(d.amountCents) : "Your payment" },
      ],
      note: d.note ? { name: who, text: d.note } : null,
      cta: { label: "Review the work", path: engagementPath(d) },
      secondary: { label: "Ask for changes", path: engagementPath(d) },
      reason: REASON.hired,
    };
  },

  // To the consultant.
  changes_requested: (d) => ({
    subject: `✏️ Changes requested on "${d.title}"`,
    preheader: "Update the work, then mark it delivered again.",
    glyph: "changes",
    heading: `${d.businessName || "The business"} asked for changes`,
    intro: "Update the work, then mark it delivered again.",
    stem: "delivered",
    note: d.note ? { name: d.businessName, text: d.note } : null,
    outro: "That restarts the 14-day review.",
    cta: { label: "See the request", path: engagementPath(d) },
    reason: REASON.working,
  }),

  // To the business.
  payment_released_business: (d) => ({
    subject: `✅ Payment released for "${d.title}"`,
    preheader: `Grassroots sent ${usd(d.amountCents)} to ${d.consultantName || "your consultant"}.`,
    glyph: "payment",
    heading: "Payment released",
    intro: d.auto ? "Your 14-day review ended, so Grassroots released it." : "You released the payment.",
    stem: "paid",
    facts: [{ label: `Sent to ${d.consultantName || "your consultant"}`, value: usd(d.amountCents) }],
    cta: { label: "Open the engagement", path: engagementPath(d) },
    reason: REASON.hired,
  }),

  // To the consultant.
  payment_released_consultant: (d) => {
    const biz = d.businessName || "The business";
    const fees = Number(d.amountCents) - Number(d.payoutCents);
    return {
      subject: `💸 ${usd(d.payoutCents)} is on its way`,
      preheader: `${biz} released your payment for "${d.title}".`,
      glyph: "payment",
      hero: usd(d.payoutCents),
      heading: "is on its way to you",
      intro: d.auto ? `${biz}'s review window ended, so it was released.` : `${biz} released your payment.`,
      stem: "paid",
      facts: fees > 0
        ? [
            { label: "Engagement", value: usdExact(d.amountCents), plain: true },
            { label: "Fees", value: `−${usdExact(fees)}`, plain: true },
            { label: "You receive", value: usdExact(d.payoutCents), total: true },
          ]
        : [{ label: "You receive", value: usdExact(d.payoutCents), total: true }],
      outro: "It lands in your Stripe balance first. Stripe then pays it out to your bank.",
      cta: { label: "Open the engagement", path: engagementPath(d) },
      reason: REASON.paid,
    };
  },

  // To the consultant (the business reviewed them).
  consultant_review: (d) => ({
    subject: "⭐ You have a new review",
    preheader: `${d.businessName || "The business"} reviewed your work on "${d.title}".`,
    glyph: "review",
    heading: `${d.businessName || "The business"} reviewed your work`,
    intro: "Strong reviews help more businesses choose you.",
    cta: { label: "See your review", path: engagementPath(d) },
    reason: REASON.working,
  }),

  // To the business (the consultant reviewed them).
  business_review: (d) => ({
    subject: `⭐ ${d.consultantName || "A consultant"} reviewed your business`,
    preheader: `Your consultant reviewed you on "${d.title}".`,
    glyph: "review",
    heading: "You have a new review",
    intro: `${d.consultantName || "Your consultant"} left a review. Reviews help strong consultants find you.`,
    cta: { label: "See the engagement", path: engagementPath(d) },
    reason: REASON.hired,
  }),
};

/**
 * Build { subject, html, text } for an event, or null if unknown.
 * @param {string} event  Key of BUILDERS.
 * @param {object} data   Event fields (title, amounts, ids, link, names…).
 * @param {string} baseUrl  Absolute origin, no trailing slash.
 */
function buildNotificationEmail(event, data, baseUrl) {
  const build = BUILDERS[event];
  if (!build) return null;
  const m = build(data);
  const link = (l) => (l ? { label: l.label, url: `${baseUrl}${l.path}` } : null);
  const { html, text } = renderEmail({
    ...m,
    preheader: m.preheader || m.intro,
    eyebrow: data.title,
    cta: link(m.cta),
    secondary: link(m.secondary),
    baseUrl,
  });
  return { subject: m.subject, html, text, tag: event };
}

module.exports = { buildNotificationEmail, EMAIL_EVENTS: Object.keys(BUILDERS) };
