// Subject and body for each engagement email. The server always builds
// these from the event and the bid; clients only name the event.
//
// Voice (brandkit.md): sentence case, second person, short sentences, no
// exclamation points. Business-facing emails never mention free offers.

const { renderEmail } = require("./email-template");

function usd(cents) {
  const n = Number(cents || 0) / 100;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function day(ms) {
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function hourAndDay(ms) {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
}

const listingPath = (d) => `/listing.html?id=${d.listingId}`;
const engagementPath = (d) => d.link || `/engagement.html?bid=${d.bidId}`;

// Each builder takes the event data and returns the message parts.
const BUILDERS = {
  // To the business.
  offer_received: (d) => ({
    subject: `New offer on "${d.title}"`,
    heading: "You have a new offer",
    paragraphs: [
      Number(d.amountCents) > 0
        ? `A consultant offered ${usd(d.amountCents)} for "${d.title}".`
        : `A consultant sent an offer on "${d.title}".`,
      "Review it, then accept, counter or decline.",
    ],
    cta: { label: "Review the offer", path: listingPath(d) },
  }),

  // To the consultant.
  counter_received: (d) => ({
    subject: `Counter offer on "${d.title}"`,
    heading: `The business countered with ${usd(d.counterCents)}`,
    paragraphs: [
      `Your offer on "${d.title}" has a counter of ${usd(d.counterCents)}.`,
      d.expiresAt
        ? `Respond by ${hourAndDay(Date.parse(d.expiresAt))}, or it reverts to your price.`
        : "You have 24 hours to respond.",
    ],
    quote: d.note || null,
    cta: { label: "Respond to the counter", path: listingPath(d) },
  }),

  // To the business.
  counter_accepted: (d) => ({
    subject: "Your counter was accepted",
    heading: "Your counter was accepted",
    paragraphs: [
      `The consultant accepted ${usd(d.amountCents)} for "${d.title}".`,
      "Accept the offer and pay to start the work.",
    ],
    quote: d.note || null,
    cta: { label: "Finish the deal", path: listingPath(d) },
  }),

  counter_declined: (d) => ({
    subject: "Your counter was declined",
    heading: "Your counter was declined",
    paragraphs: [
      `The consultant kept their offer on "${d.title}".`,
      `Their original ${usd(d.amountCents)} offer is still open.`,
    ],
    quote: d.note || null,
    cta: { label: "See the offer", path: listingPath(d) },
  }),

  counter_rescinded: (d) => ({
    subject: `An offer on "${d.title}" was withdrawn`,
    heading: "The consultant withdrew their offer",
    paragraphs: [
      `After your counter, the consultant withdrew their offer on "${d.title}".`,
      "Your other offers are still open.",
    ],
    quote: d.note || null,
    cta: { label: "See your offers", path: listingPath(d) },
  }),

  // To the consultant.
  offer_accepted: (d) => ({
    subject: `Your offer on "${d.title}" was accepted`,
    heading: "Your offer was accepted",
    paragraphs: Number(d.amountCents) > 0
      ? [
          `The business accepted and paid ${usd(d.amountCents)} for "${d.title}".`,
          "Grassroots holds the payment until the work is done.",
          "Next, pick a kickoff time once they share availability.",
        ]
      : [
          `The business accepted your free offer on "${d.title}".`,
          "Next, pick a kickoff time once they share availability.",
        ],
    cta: { label: "Open the engagement", path: engagementPath(d) },
  }),

  // To the business.
  work_delivered: (d) => ({
    subject: `"${d.title}" was marked delivered`,
    heading: `${d.label === "Payment" ? "Work" : d.label} marked delivered`,
    paragraphs: [
      `The consultant marked "${d.title}" delivered.`,
      `Review it by ${day(d.reviewByMs)}.`,
      d.free
        ? "After that, Grassroots marks it complete for you."
        : "After that, Grassroots releases the payment to them.",
    ],
    quote: d.note || null,
    cta: { label: "Review the work", path: engagementPath(d) },
  }),

  // To the consultant.
  changes_requested: (d) => ({
    subject: `Changes requested on "${d.title}"`,
    heading: "The business asked for changes",
    paragraphs: [
      `The business wants changes to "${d.title}".`,
      "Update the work, then mark it delivered again.",
      "That restarts the 14-day review.",
    ],
    quote: d.note || null,
    cta: { label: "See the request", path: engagementPath(d) },
  }),

  // To the business.
  payment_released_business: (d) => ({
    subject: `Payment released for "${d.title}"`,
    heading: "Payment released",
    paragraphs: [
      d.auto
        ? `Your 14-day review for "${d.title}" ended.`
        : `You released the payment for "${d.title}".`,
      `Grassroots sent ${usd(d.amountCents)} to your consultant.`,
    ],
    cta: { label: "Open the engagement", path: engagementPath(d) },
  }),

  // To the consultant.
  payment_released_consultant: (d) => ({
    subject: `You were paid for "${d.title}"`,
    heading: `${usd(d.payoutCents)} is on its way`,
    paragraphs: [
      d.auto
        ? `The business's review window for "${d.title}" ended.`
        : `The business released your payment for "${d.title}".`,
      `${usd(d.payoutCents)} is heading to your Stripe balance.`,
      "Stripe then pays it out to your bank.",
    ],
    cta: { label: "Open the engagement", path: engagementPath(d) },
  }),

  // To the consultant (the business reviewed them).
  consultant_review: (d) => ({
    subject: "You have a new review",
    heading: "The business reviewed your work",
    paragraphs: [
      `The business left a review on "${d.title}".`,
      "Strong reviews help more businesses choose you.",
    ],
    cta: { label: "See your review", path: engagementPath(d) },
  }),

  // To the business (the consultant reviewed them).
  business_review: (d) => ({
    subject: "A consultant reviewed your business",
    heading: "You have a new review",
    paragraphs: [
      `Your consultant left a review on "${d.title}".`,
      "Reviews help strong consultants find you.",
    ],
    cta: { label: "See the engagement", path: engagementPath(d) },
  }),
};

/**
 * Build { subject, html, text } for an event, or null if unknown.
 * @param {string} event  Key of BUILDERS.
 * @param {object} data   Event fields (title, amounts, ids, link…).
 * @param {string} baseUrl  Absolute origin, no trailing slash.
 */
function buildNotificationEmail(event, data, baseUrl) {
  const build = BUILDERS[event];
  if (!build) return null;
  const m = build(data);
  const cta = m.cta ? { label: m.cta.label, url: `${baseUrl}${m.cta.path}` } : null;
  const { html, text } = renderEmail({
    subject: m.subject,
    preheader: m.paragraphs[0],
    heading: m.heading,
    paragraphs: m.paragraphs,
    quote: m.quote,
    cta,
    baseUrl,
  });
  return { subject: m.subject, html, text, tag: event };
}

module.exports = { buildNotificationEmail, EMAIL_EVENTS: Object.keys(BUILDERS) };
