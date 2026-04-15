import { createRoot } from "react-dom/client";

type IconProps = {
  className?: string;
};

type ChoiceCard = {
  eyebrow: string;
  title: string;
  summary: string;
  points: string[];
  tone: "standard" | "advanced" | "retainer";
};

type CompareRow = {
  label: string;
  standard: string;
  advanced: string;
  retainer: string;
};

type StageSignal = {
  title: string;
  body: string;
};

type Scenario = {
  title: string;
  contract: "Standard" | "Advanced" | "Retainer";
  why: string;
};

type FlowStep = {
  title: string;
  note?: string;
};

type FaqItem = {
  question: string;
  answer: string;
};

function CheckIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LayersIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="m12 3 9 4.5-9 4.5L3 7.5 12 3Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m3 12 9 4.5 9-4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m3 16.5 9 4.5 9-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowPathIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M4 7h10a4 4 0 0 1 0 8H9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m9 11-4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const choiceCards: ChoiceCard[] = [
  {
    eyebrow: "use standard if...",
    title: "the work is already clear",
    summary: "Standard is the default. It is best for simple, gig-like projects with one clean scope and one clean payment path.",
    points: ["clear deliverable", "one approval decision", "no built-in support stage"],
    tone: "standard"
  },
  {
    eyebrow: "use advanced if...",
    title: "you want checkpoints",
    summary:
      "Open the Advanced builder when you want proposal or discovery, stage-based decisions, iterations, maintenance, or the option to stop early.",
    points: ["research before build", "pay by completed stage", "continue, revise, or stop"],
    tone: "advanced"
  },
  {
    eyebrow: "use retainer if...",
    title: "the work repeats every month",
    summary:
      "Use the retainer contract for recurring services like monthly social media content, ongoing website updates, or steady support work.",
    points: ["recurring services", "repeatable cadence", "ongoing relationship"],
    tone: "retainer"
  }
];

const compareRows: CompareRow[] = [
  {
    label: "scope",
    standard: "already defined",
    advanced: "may sharpen over time",
    retainer: "recurring and ongoing"
  },
  {
    label: "payment",
    standard: "straightforward",
    advanced: "can be phased",
    retainer: "regular recurring fee"
  },
  {
    label: "early stop",
    standard: "not the main use case",
    advanced: "built for checkpoints",
    retainer: "renew or end by term"
  },
  {
    label: "iterations",
    standard: "light revisions only",
    advanced: "planned review rounds",
    retainer: "part of ongoing service"
  },
  {
    label: "maintenance",
    standard: "usually not included",
    advanced: "easy to add",
    retainer: "often the core service"
  }
];

const stageSignals: StageSignal[] = [
  {
    title: "unknowns first",
    body: "Use stages when research or planning should happen before full execution."
  },
  {
    title: "go / no-go checkpoint",
    body: "Use stages when you want to review early work before committing to the next budget."
  },
  {
    title: "support after launch",
    body: "Use stages when the job may continue into iterations or maintenance."
  },
  {
    title: "steady monthly work",
    body: "Use a retainer when the same type of service should repeat on an ongoing cadence."
  }
];

const scenarios: Scenario[] = [
  {
    title: "website marketing copy",
    contract: "Standard",
    why: "The scope is easy to define and payment can stay simple."
  },
  {
    title: "inventory system overhaul with migration + dashboard work",
    contract: "Advanced",
    why: "This usually needs discovery, implementation, and likely post-launch support."
  },
  {
    title: "booking funnel redesign with concept review + two revision rounds",
    contract: "Advanced",
    why: "Medium-complexity work benefits from an early direction check before final execution."
  },
  {
    title: "monthly social media content + routine website updates",
    contract: "Retainer",
    why: "This is recurring work, so a retainer is clearer than posting a fresh one-time project every month."
  }
];

const advancedFlow: FlowStep[] = [
  { title: "listing" },
  { title: "private student offers" },
  { title: "review" },
  { title: "proposal / discovery" },
  { title: "continue or stop", note: "pay only for completed work" },
  { title: "implementation" },
  { title: "iterations / maintenance" }
];

const faqItems: FaqItem[] = [
  {
    question: "Which contract type should I choose?",
    answer: "Choose Standard for one clear project, Advanced for staged work, and Retainer for recurring services."
  },
  {
    question: "When should I use staged work?",
    answer: "Use staged work when the scope is still evolving or you want a decision point after early research."
  },
  {
    question: "What if I stop after proposal or discovery?",
    answer: "That is supported in Advanced. You can stop there and pay only for the completed phase."
  },
  {
    question: "When should I include iterations or maintenance?",
    answer: "Include them when review rounds or post-launch support should be clearly priced and expected."
  },
  {
    question: "When should I use a retainer contract?",
    answer: "Use a retainer when the business needs repeat work on a steady cadence, like monthly content, website updates, or ongoing support."
  }
];

function SectionIntro({
  eyebrow,
  title,
  subtitle
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="font-brand text-xs font-bold uppercase tracking-[0.22em] text-moss-600">{eyebrow}</p>
      <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h2>
      {subtitle ? <p className="mt-4 text-base leading-7 text-moss-700/80">{subtitle}</p> : null}
    </div>
  );
}

function ChoiceCard({ card }: { card: ChoiceCard }) {
  const isStandard = card.tone === "standard";
  const isRetainer = card.tone === "retainer";

  return (
    <article
      className={`relative overflow-hidden rounded-[30px] border p-6 shadow-soft sm:p-7 ${
        isStandard
          ? "border-moss-200 bg-white"
          : isRetainer
            ? "border-[#c9b78b] bg-[linear-gradient(145deg,#f4f1eb,#ebe3d3)] text-ink"
            : "border-moss-800 bg-[linear-gradient(145deg,#2d6a4f,#1b4332)] text-white shadow-lift"
      }`}
    >
      <div
        className={`absolute inset-x-0 top-0 h-1 ${isStandard ? "bg-moss-300" : isRetainer ? "bg-[#c59a52]" : "bg-[#95d5b2]"}`}
        aria-hidden="true"
      />
      <div className="flex items-center gap-3">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
            isStandard ? "bg-moss-100 text-moss-700" : isRetainer ? "bg-white text-[#7e5d42]" : "bg-white/14 text-white"
          }`}
        >
          {isStandard ? <CheckIcon /> : isRetainer ? <ArrowPathIcon /> : <LayersIcon />}
        </div>
        <p
          className={`font-brand text-xs font-bold uppercase tracking-[0.22em] ${
            isStandard ? "text-moss-600" : isRetainer ? "text-[#7e5d42]" : "text-white/80"
          }`}
        >
          {card.eyebrow}
        </p>
      </div>

      <h3 className={`mt-5 font-display text-2xl font-bold tracking-tight ${isStandard || isRetainer ? "text-ink" : "text-white"}`}>{card.title}</h3>
      <p className={`mt-4 text-sm leading-6 ${isStandard || isRetainer ? "text-moss-700/85" : "text-white/92"}`}>{card.summary}</p>

      <ul className="mt-6 grid gap-3">
        {card.points.map((point) => (
          <li key={point} className="flex items-center gap-3 rounded-2xl border border-black/0 bg-black/[0.02] px-3 py-3">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                isStandard ? "bg-moss-100 text-moss-700" : isRetainer ? "bg-white text-[#7e5d42]" : "bg-white/14 text-white"
              }`}
            >
              <CheckIcon className="h-3.5 w-3.5" />
            </span>
            <span className={`text-sm font-medium ${isStandard || isRetainer ? "text-ink" : "text-white"}`}>{point}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function CompareRowCard({ row }: { row: CompareRow }) {
  return (
    <div className="grid gap-3 rounded-[26px] border border-moss-200 bg-white p-4 shadow-soft sm:grid-cols-[0.68fr,1fr,1fr,1fr] sm:items-center sm:p-5">
      <div className="font-brand text-xs font-bold uppercase tracking-[0.2em] text-moss-600">{row.label}</div>
      <div className="rounded-2xl bg-moss-50 px-4 py-3 text-sm font-medium text-ink">{row.standard}</div>
      <div className="rounded-2xl bg-[rgba(45,106,79,0.08)] px-4 py-3 text-sm font-medium text-ink">{row.advanced}</div>
      <div className="rounded-2xl bg-[rgba(197,154,82,0.12)] px-4 py-3 text-sm font-medium text-ink">{row.retainer}</div>
    </div>
  );
}

function StageSignalCard({ item, index }: { item: StageSignal; index: number }) {
  const icons = [SparkIcon, LockIcon, ArrowPathIcon, LayersIcon] as const;
  const Icon = icons[index] || SparkIcon;

  return (
    <article className="rounded-[26px] border border-moss-200 bg-white p-5 shadow-soft">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-moss-100 text-moss-700">
        <Icon />
      </div>
      <h3 className="mt-4 font-display text-2xl font-bold tracking-tight text-ink">{item.title}</h3>
      <p className="mt-3 text-sm leading-6 text-moss-700/80">{item.body}</p>
    </article>
  );
}

function ScenarioCard({ item }: { item: Scenario }) {
  const advanced = item.contract === "Advanced";
  const retainer = item.contract === "Retainer";

  return (
    <article className="flex h-full flex-col rounded-[28px] border border-moss-200 bg-white p-6 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-2xl font-bold tracking-tight text-ink">{item.title}</h3>
        <span
          className={`shrink-0 rounded-full px-3 py-1 font-brand text-[11px] font-bold uppercase tracking-[0.18em] ${
            advanced ? "bg-moss-700 text-white" : retainer ? "bg-[rgba(197,154,82,0.16)] text-[#7e5d42]" : "bg-moss-100 text-moss-700"
          }`}
        >
          {item.contract}
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-moss-700/80">{item.why}</p>
    </article>
  );
}

function FaqRow({ item }: { item: FaqItem }) {
  return (
    <details className="group rounded-[24px] border border-moss-200 bg-white p-5 shadow-soft">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <span className="text-left text-base font-semibold text-ink">{item.question}</span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-moss-100 text-moss-700 transition-transform duration-200 group-open:rotate-45">
          <SparkIcon className="h-4 w-4" />
        </span>
      </summary>
      <p className="mt-4 pr-10 text-sm leading-6 text-moss-700/80">{item.answer}</p>
    </details>
  );
}

function HeroGraphic() {
  return (
    <div className="relative mx-auto max-w-lg animate-float">
      <div className="absolute -left-6 top-12 h-20 w-20 rounded-full bg-moss-200/60 blur-2xl" aria-hidden="true" />
      <div className="absolute -right-8 bottom-8 h-24 w-24 rounded-full bg-white/70 blur-2xl" aria-hidden="true" />

      <div className="relative rounded-[30px] border border-white/70 bg-white/92 p-5 shadow-lift backdrop-blur">
        <div className="grid gap-4">
          <div className="rounded-[24px] border border-moss-200 bg-moss-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-brand text-[11px] font-bold uppercase tracking-[0.18em] text-moss-600">standard</p>
                <p className="mt-1 text-sm font-semibold text-ink">one clear project</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-moss-700 shadow-sm">
                <CheckIcon />
              </div>
            </div>
            <div className="mt-4 rounded-full bg-white p-2 shadow-inner">
              <div className="h-3 rounded-full bg-[linear-gradient(90deg,#95d5b2,#2d6a4f)]" />
            </div>
          </div>

          <div className="rounded-[24px] border border-moss-800 bg-[linear-gradient(145deg,#2d6a4f,#1b4332)] p-4 text-white">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-brand text-[11px] font-bold uppercase tracking-[0.18em] text-white/75">advanced</p>
                <p className="mt-1 text-sm font-semibold text-white">stage by stage</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/14 text-white">
                <LayersIcon />
              </div>
            </div>

            <div className="mt-5 flex items-center gap-2 overflow-hidden">
              {["proposal", "build", "iterate", "maintain"].map((step, index) => (
                <div key={step} className="flex min-w-0 flex-1 items-center gap-2">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/14 text-[11px] font-bold text-white animate-pulseSlow"
                    style={{ animationDelay: `${index * 0.35}s` }}
                  >
                    {index + 1}
                  </div>
                  {index < 3 ? <div className="h-px flex-1 bg-white/30" aria-hidden="true" /> : null}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              "standard is the default",
              "private student offers",
              "stop after discovery if needed",
              "add iterations or maintenance only when useful"
            ].map((chip) => (
              <div key={chip} className="rounded-2xl border border-moss-200 bg-[rgba(244,249,246,0.92)] px-3 py-3 text-sm font-medium text-ink">
                {chip}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdvancedFlow() {
  return (
    <ol className="grid gap-3">
      {advancedFlow.map((step, index) => (
        <li key={step.title} className="relative">
          <div className="flex items-center gap-3 rounded-[24px] border border-moss-200 bg-white px-4 py-4 shadow-soft">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-moss-100 font-brand text-sm font-bold text-moss-700">
              {index + 1}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{step.title}</p>
              {step.note ? <p className="mt-1 text-xs font-medium text-moss-600">{step.note}</p> : null}
            </div>
          </div>
          {index < advancedFlow.length - 1 ? <div className="ml-5 h-4 w-px bg-moss-300" aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}

function App() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-hero-grid bg-[size:100%_100%,34px_34px,34px_34px] opacity-70" aria-hidden="true" />
      <div className="absolute left-[-10rem] top-24 -z-10 h-72 w-72 rounded-full bg-moss-100/80 blur-3xl" aria-hidden="true" />
      <div className="absolute right-[-8rem] top-24 -z-10 h-80 w-80 rounded-full bg-white/90 blur-3xl" aria-hidden="true" />

      <nav className="gr-nav" aria-label="Primary">
        <div className="gr-nav__inner">
          <a className="gr-nav__brand" href="/home/">
            <img className="gr-nav__logo" src="/home/assets/grassroots-icon-syne.svg" width="20" height="34" alt="" />
            <span className="gr-nav__wordmark">grassroots</span>
          </a>
          <ul className="gr-nav__links">
            <li><a href="/">marketplace</a></li>
            <li><a href="/create-listing.html">create listing</a></li>
            <li><a href="/contract-help.html" aria-current="page">contract guide</a></li>
          </ul>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 pb-20 pt-10 sm:px-6 lg:px-8 lg:pb-24 lg:pt-14">
        <section className="grid gap-10 rounded-[36px] border border-white/70 bg-[rgba(255,255,255,0.74)] px-6 py-8 shadow-lift backdrop-blur sm:px-8 sm:py-10 lg:grid-cols-[1.02fr,0.98fr] lg:px-10 lg:py-12">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-moss-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-moss-700">
              <SparkIcon className="h-3.5 w-3.5" />
              contract type guide
            </div>
            <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl lg:text-6xl">
              pick the simple path unless your project needs stages.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-moss-700/85">
              Choose the contract type before you create the listing. Standard is the default. Use Advanced for staged work and
              Retainer for recurring services.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="/create-listing.html"
                className="inline-flex items-center justify-center rounded-full bg-[linear-gradient(145deg,#2d6a4f,#1b4332)] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(27,67,50,0.22)] transition hover:translate-y-[-1px]"
              >
                go to listing builder
              </a>
              <a
                href="#quick-choice"
                className="inline-flex items-center justify-center rounded-full border border-moss-200 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:border-moss-300 hover:bg-moss-50"
              >
                compare options
              </a>
            </div>
          </div>

          <HeroGraphic />
        </section>

        <section id="quick-choice" className="mt-16">
          <SectionIntro
            eyebrow="quick choice"
            title="use Standard for one project, Advanced for stages, Retainer for recurring work."
            subtitle="If the work happens once, keep it simple. If it unfolds in phases, use Advanced. If it repeats on a cadence, use Retainer."
          />
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {choiceCards.map((card) => (
              <ChoiceCard key={card.title} card={card} />
            ))}
          </div>
        </section>

        <section className="mt-16 grid gap-8 lg:grid-cols-[1.05fr,0.95fr]">
          <div>
            <SectionIntro eyebrow="side by side" title="Standard vs Advanced" />
            <div className="mt-8 grid gap-4">
              {compareRows.map((row) => (
                <CompareRowCard key={row.label} row={row} />
              ))}
            </div>
          </div>

          <div>
            <SectionIntro
              eyebrow="when staged work helps"
              title="use stages when you want room to learn before you commit."
            />
            <div className="mt-8 grid gap-4">
              {stageSignals.map((item, index) => (
                <StageSignalCard key={item.title} item={item} index={index} />
              ))}
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-8 lg:grid-cols-[1fr,0.96fr]">
          <div>
            <SectionIntro
              eyebrow="examples"
              title="examples for each option"
              subtitle="These are the fastest way to gut-check your choice."
            />
            <div className="mt-8 grid gap-5">
              {scenarios.map((item) => (
                <ScenarioCard key={item.title} item={item} />
              ))}
            </div>
          </div>

          <div>
            <SectionIntro
              eyebrow="advanced flow"
              title="how Advanced works"
              subtitle="Offers stay private to your business, and you can stop after an early stage if that is enough."
            />
            <div className="mt-8 rounded-[30px] border border-moss-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(244,249,246,0.96))] p-5 shadow-soft sm:p-6">
              <AdvancedFlow />
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-8 lg:grid-cols-[1fr,0.92fr]">
          <div>
            <SectionIntro eyebrow="faq" title="short answers" />
            <div className="mt-8 grid gap-4">
              {faqItems.map((item) => (
                <FaqRow key={item.question} item={item} />
              ))}
            </div>
          </div>

          <aside className="rounded-[32px] border border-moss-800 bg-[linear-gradient(145deg,#2d6a4f,#1b4332)] p-7 text-white shadow-lift sm:p-8">
            <p className="font-brand text-xs font-bold uppercase tracking-[0.22em] text-white/75">final call</p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-white">keep it simple unless the project needs decision points.</h2>
            <p className="mt-4 text-base leading-7 text-white/90">
              Choosing Advanced does not lock you into every later stage. It just gives you a cleaner structure if the work needs to unfold in steps.
            </p>

            <div className="mt-6 rounded-[26px] border border-white/15 bg-white/10 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/14 text-white">
                  <LockIcon />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">private offers</p>
                  <p className="mt-1 text-sm leading-6 text-white/84">Student offers and proposals are visible only to your business.</p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <a
                href="/create-listing.html"
                className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#0f1f1a] transition hover:bg-moss-50"
              >
                create a listing
              </a>
              <a
                href="/create-listing.html"
                className="inline-flex items-center justify-center rounded-full border border-white/18 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                default to Standard if unsure
              </a>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

const rootElement = document.getElementById("contract-help-root");

if (!rootElement) {
  throw new Error("contract-help-root was not found");
}

createRoot(rootElement).render(<App />);
