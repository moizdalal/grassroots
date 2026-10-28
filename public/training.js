// training.js — consultant onboarding: four modules, then a quiz.
//
// mountTraining(root, deps) renders everything inside `root`. It takes its
// data access as deps so the page (training.html) owns auth and Supabase:
//   deps.userId        — used to key module progress in localStorage
//   deps.loadLatest()  → Promise<{ score, total, passed, created_at } | null>
//   deps.startQuiz()   → Promise<{ attempt_id, questions: [{ id, module, prompt, options }] }>
//   deps.submitQuiz(attemptId, answers) → Promise<{ score, total, passed, results? }>
//     (rejects on failure; results carry answers + reasons, on a pass only)
//
// Module progress is a per-browser convenience (localStorage). Quiz
// questions, grading and attempts live in the database
// (supabase/migrations/add_consultant_training.sql).

import { MODULES, PASS_SCORE, QUIZ_LENGTH } from "/training-content.js";
import { confirmDialog } from "/confirm-modal.js";
import { computeFees, formatUsd, LAUNCH_PLATFORM_FEE_BPS, PLATFORM_FEE_BPS } from "/fees.js";

const QUIZ_STEP = "quiz";
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ---- lesson visuals (training-content.js `visual`) ----

const TIMELINE_STEPS = [
  { title: "Offer accepted", note: "The business pays the full offer" },
  { title: "Held in Stripe", note: "Safe while you do the work" },
  { title: "You mark it delivered", note: "Once they have everything" },
  { title: "14-day review", note: "Reminder on day 7" },
  { title: "Released to you", note: "Or automatically on day 14" },
  { title: "In your bank", note: "Usually about 2 business days" },
];

function renderPaymentTimeline() {
  return `
    <figure class="tr-visual tr-timeline" aria-label="How a payment moves from the business to your bank">
      <ol class="tr-timeline__list">
        ${TIMELINE_STEPS.map(
          (s, i) => `
          <li class="tr-timeline__step" style="--i:${i}">
            <span class="tr-timeline__dot" aria-hidden="true">${i + 1}</span>
            <span class="tr-timeline__title">${escape(s.title)}</span>
            <span class="tr-timeline__note">${escape(s.note)}</span>
          </li>`
        ).join("")}
      </ol>
    </figure>`;
}

function renderFeeCalculator() {
  const launch = LAUNCH_PLATFORM_FEE_BPS != null && LAUNCH_PLATFORM_FEE_BPS < PLATFORM_FEE_BPS;
  return `
    <figure class="tr-visual tr-fees">
      <figcaption class="tr-fees__head">
        <label class="tr-fees__label" for="tr-fee-range">Try an offer amount</label>
        <output class="tr-fees__amount" id="tr-fee-amount" for="tr-fee-range"></output>
      </figcaption>
      <input class="tr-fees__range" id="tr-fee-range" type="range" min="10" max="1000" step="5" value="100" />
      <div class="tr-fees__bar" aria-hidden="true">
        <span class="tr-fees__seg tr-fees__seg--keep" data-seg="keep"></span>
        <span class="tr-fees__seg tr-fees__seg--card" data-seg="card"></span>
        <span class="tr-fees__seg tr-fees__seg--platform" data-seg="platform"></span>
      </div>
      <dl class="tr-fees__legend">
        <div><dt><span class="tr-fees__swatch tr-fees__seg--keep"></span>You take home</dt><dd data-val="keep"></dd></div>
        <div><dt><span class="tr-fees__swatch tr-fees__seg--card"></span>Card processing</dt><dd data-val="card"></dd></div>
        <div><dt><span class="tr-fees__swatch tr-fees__seg--platform"></span>Platform fee${launch ? " (launch rate)" : ""}</dt><dd data-val="platform"></dd></div>
      </dl>
      <p class="tr-fees__note">The business pays exactly the offer. Fees come out of your payout.</p>
    </figure>`;
}

function wireFeeCalculator(scope) {
  const range = scope.querySelector("#tr-fee-range");
  if (!range) return;
  const update = () => {
    const f = computeFees(Number(range.value) * 100);
    const total = f.amountCents || 1;
    const parts = { keep: f.consultantPayoutCents, card: f.stripeFeeCents, platform: f.platformFeeCents };
    scope.querySelector("#tr-fee-amount").textContent = formatUsd(f.amountCents);
    for (const [k, v] of Object.entries(parts)) {
      scope.querySelector(`[data-seg="${k}"]`).style.width = `${(v / total) * 100}%`;
      scope.querySelector(`[data-val="${k}"]`).textContent = formatUsd(v);
    }
    range.setAttribute("aria-valuetext", `${formatUsd(f.amountCents)} offer, you take home ${formatUsd(f.consultantPayoutCents)}`);
  };
  range.addEventListener("input", update);
  update();
}

const VISUALS = { "payment-timeline": renderPaymentTimeline, "fee-calculator": renderFeeCalculator };

// Fades lessons in as they scroll into view. Lessons start visible: the
// hide-until-seen style only applies once `scope` has .tr-armed, which is
// set on the observer's first callback. If the observer never runs
// (background tab, old browser), nothing is ever hidden.
function revealOnScroll(scope) {
  const els = [...scope.querySelectorAll(".tr-reveal")];
  scope.classList.remove("tr-armed");
  if (reduceMotion() || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      scope.classList.add("tr-armed");
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
  );
  els.forEach((el) => io.observe(el));
}

const escape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

export function mountTraining(root, deps) {
  const progressKey = `grassroots_training_progress_${deps.userId || "anon"}`;

  const readDone = () => {
    try {
      const v = JSON.parse(localStorage.getItem(progressKey) || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const writeDone = (ids) => {
    try {
      localStorage.setItem(progressKey, JSON.stringify(ids));
    } catch {
      /* private mode — progress just won't persist */
    }
  };

  const state = {
    done: readDone().filter((id) => MODULES.some((m) => m.id === id)),
    step: null,
    latest: null,
    quiz: null, // { questions: [{ q, order }], answers: {} }
    result: null, // { score, total, passed, results? } from submit_training_quiz
    justDone: null, // module id whose step check should pop on next render
  };
  state.step = MODULES.find((m) => !state.done.includes(m.id))?.id || QUIZ_STEP;

  const allModulesDone = () => MODULES.every((m) => state.done.includes(m.id));

  root.innerHTML = `
    <div class="gr-page-intro tr-intro">
      <p class="tr-eyebrow">Consultant training</p>
      <h1 class="gr-title">Get ready for your first engagement</h1>
      <p class="gr-subtitle">Four short modules, then a ${QUIZ_LENGTH}-question quiz. You need ${PASS_SCORE} of ${QUIZ_LENGTH} to pass.</p>
      <p class="tr-latest" id="tr-latest" hidden></p>
    </div>
    <div class="tr-progress" id="tr-progress">
      <div class="tr-progress__track" role="progressbar" aria-label="Training progress" aria-valuemin="0" aria-valuemax="${MODULES.length + 1}">
        <span class="tr-progress__fill" id="tr-progress-fill"></span>
      </div>
      <span class="tr-progress__label" id="tr-progress-label"></span>
    </div>
    <ol class="tr-steps" id="tr-steps" aria-label="Training steps"></ol>
    <section class="tr-panel" id="tr-panel" tabindex="-1" aria-live="polite"></section>
  `;
  const stepsEl = root.querySelector("#tr-steps");
  const panelEl = root.querySelector("#tr-panel");
  const latestEl = root.querySelector("#tr-latest");

  function renderLatest() {
    const l = state.latest;
    if (!l) {
      latestEl.hidden = true;
      return;
    }
    latestEl.hidden = false;
    latestEl.innerHTML = l.passed
      ? `<span class="gr-pill gr-pill--accepted">Passed</span> You scored ${l.score} of ${l.total} on ${escape(fmtDate(l.created_at))}.`
      : `<span class="gr-pill gr-pill--pending">Not passed yet</span> Your last score was ${l.score} of ${l.total}.`;
  }

  function renderProgress() {
    const steps = MODULES.length + 1;
    const done = state.done.length + (state.latest?.passed ? 1 : 0);
    const track = root.querySelector(".tr-progress__track");
    track.setAttribute("aria-valuenow", String(done));
    root.querySelector("#tr-progress-fill").style.width = `${(done / steps) * 100}%`;
    root.querySelector("#tr-progress-label").textContent = state.latest?.passed
      ? "Training complete"
      : `${state.done.length} of ${MODULES.length} modules complete`;
  }

  function renderSteps() {
    const items = MODULES.map((m, i) => {
      const done = state.done.includes(m.id);
      const current = state.step === m.id;
      return `
        <li>
          <button type="button" class="tr-step${current ? " is-current" : ""}${done ? " is-done" : ""}${state.justDone === m.id ? " just-done" : ""}"
            data-step="${m.id}" ${current ? 'aria-current="step"' : ""}>
            <span class="tr-step__num" aria-hidden="true">${done ? "✓" : i + 1}</span>
            <span class="tr-step__label">${escape(m.title)}${done ? '<span class="tr-sr"> (complete)</span>' : ""}</span>
          </button>
        </li>`;
    });
    const locked = !allModulesDone();
    const current = state.step === QUIZ_STEP;
    items.push(`
      <li>
        <button type="button" class="tr-step tr-step--quiz${current ? " is-current" : ""}${state.latest?.passed ? " is-done" : ""}"
          data-step="${QUIZ_STEP}" ${locked ? 'aria-disabled="true"' : ""} ${current ? 'aria-current="step"' : ""}
          title="${locked ? "Finish all four modules to unlock the quiz" : "Take the quiz"}">
          <span class="tr-step__num" aria-hidden="true">${state.latest?.passed ? "✓" : "?"}</span>
          <span class="tr-step__label">Quiz${locked ? '<span class="tr-sr"> (locked)</span>' : ""}</span>
        </button>
      </li>`);
    stepsEl.innerHTML = items.join("");
  }

  function renderModule(m) {
    const idx = MODULES.indexOf(m);
    const done = state.done.includes(m.id);
    const isLast = idx === MODULES.length - 1;
    panelEl.innerHTML = `
      <p class="tr-eyebrow">Module ${idx + 1} of ${MODULES.length}</p>
      <h2 class="tr-panel__title">${escape(m.title)}</h2>
      <p class="tr-panel__goal">${escape(m.goal)}</p>
      ${m.lessons
        .map(
          (l, li) => `
        <section class="tr-lesson tr-reveal${l.key ? " tr-lesson--key" : ""}">
          ${l.key ? '<p class="tr-eyebrow">Must-know habit</p>' : ""}
          <h3 class="tr-lesson__title"><span class="tr-lesson__num">${idx + 1}.${li + 1}</span> ${escape(l.title)}</h3>
          ${l.intro ? `<p class="tr-lesson__intro">${escape(l.intro)}</p>` : ""}
          <ul class="tr-lesson__points">${l.points.map((p) => `<li>${escape(p)}</li>`).join("")}</ul>
          ${l.visual && VISUALS[l.visual] ? VISUALS[l.visual]() : ""}
          ${
            l.example
              ? `<figure class="tr-example">
                  <figcaption class="tr-example__label">${escape(l.example.label)}</figcaption>
                  <blockquote class="tr-example__text">“${escape(l.example.text)}”</blockquote>
                </figure>`
              : ""
          }
        </section>`
        )
        .join("")}
      <div class="tr-actions">
        ${idx > 0 ? `<button type="button" class="gr-btn gr-btn--ghost" data-go="${MODULES[idx - 1].id}">Previous module</button>` : "<span></span>"}
        <button type="button" class="gr-btn gr-btn--primary" data-complete="${m.id}">
          ${done ? (isLast ? "Go to the quiz" : "Next module") : isLast ? "Mark complete and go to the quiz" : "Mark complete and continue"}
        </button>
      </div>
    `;
  }

  // The database draws the questions and opens an attempt. Answers aren't
  // in the payload; option order is shuffled here for display only.
  async function startQuiz(btn) {
    btn?.classList.add("is-loading");
    try {
      const { attempt_id, questions } = await deps.startQuiz();
      state.quiz = {
        attemptId: attempt_id,
        questions: questions.map((q) => ({ q, order: shuffledIndexes(q.options.length) })),
        answers: {},
      };
      state.result = null;
      render();
    } catch (err) {
      console.warn("[training] could not start quiz", err);
      btn?.classList.remove("is-loading");
      showPanelError("We couldn't start the quiz. Check your connection and try again.");
    }
  }

  function showPanelError(msg) {
    let el = panelEl.querySelector(".tr-panel__error");
    if (!el) {
      el = document.createElement("p");
      el.className = "gr-status error tr-panel__error";
      el.setAttribute("role", "alert");
      panelEl.querySelector(".tr-actions")?.before(el);
    }
    el.textContent = msg;
  }

  function shuffledIndexes(n) {
    const a = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function renderQuizLocked() {
    const left = MODULES.filter((m) => !state.done.includes(m.id));
    panelEl.innerHTML = `
      <p class="tr-eyebrow">Quiz</p>
      <h2 class="tr-panel__title">Finish the modules first</h2>
      <p class="tr-panel__goal">The quiz unlocks once you've completed all four modules.</p>
      <ul class="tr-lesson__points">${left.map((m) => `<li>${escape(m.title)}</li>`).join("")}</ul>
      <div class="tr-actions"><span></span>
        <button type="button" class="gr-btn gr-btn--primary" data-go="${left[0].id}">Go to ${escape(left[0].title.toLowerCase())}</button>
      </div>`;
  }

  function renderQuiz() {
    if (state.result) return renderResult();
    if (!allModulesDone()) return renderQuizLocked();
    if (!state.quiz) {
      panelEl.innerHTML = `
        <p class="tr-eyebrow">Quiz</p>
        <h2 class="tr-panel__title">Check what you've learned</h2>
        <p class="tr-panel__goal">${QUIZ_LENGTH} questions drawn from all four modules. You need ${PASS_SCORE} correct to pass. Your result is saved.</p>
        <div class="tr-actions"><span></span>
          <button type="button" class="gr-btn gr-btn--primary" data-start-quiz>Start the quiz</button>
        </div>`;
      return;
    }
    const { questions, answers } = state.quiz;
    const answered = Object.keys(answers).length;
    panelEl.innerHTML = `
      <p class="tr-eyebrow">Quiz</p>
      <h2 class="tr-panel__title">Check what you've learned</h2>
      <form class="tr-quiz" id="tr-quiz" novalidate>
        ${questions
          .map(
            ({ q, order }, i) => `
          <fieldset class="tr-q">
            <legend class="tr-q__prompt"><span class="tr-q__num">${i + 1}.</span> ${escape(q.prompt)}</legend>
            ${order
              .map(
                (oi) => `
              <label class="tr-q__option">
                <input type="radio" name="${q.id}" value="${oi}" ${answers[q.id] === oi ? "checked" : ""} />
                <span>${escape(q.options[oi])}</span>
              </label>`
              )
              .join("")}
          </fieldset>`
          )
          .join("")}
        <div class="tr-actions">
          <span class="tr-quiz__count" id="tr-count">${answered} of ${questions.length} answered</span>
          <button type="submit" class="gr-btn gr-btn--primary" id="tr-submit" ${answered < questions.length ? "disabled" : ""}>Submit answers</button>
        </div>
      </form>`;
  }

  function renderResult() {
    const { score, total, passed, results } = state.result;
    if (passed) {
      // results (answers + reasons) only come back from the database on a pass.
      const byId = new Map((results || []).map((r) => [r.id, r]));
      panelEl.innerHTML = `
        <p class="tr-eyebrow">Quiz result</p>
        <h2 class="tr-panel__title">You passed with ${score} of ${total}</h2>
        <p class="tr-panel__goal">You're ready to send your first offer. Here's how you did.</p>
        <ol class="tr-review">
          ${state.quiz.questions
            .map(({ q }) => {
              const r = byId.get(q.id) || {};
              const right = !!r.correct;
              const picked = state.quiz.answers[q.id];
              return `
              <li class="tr-review__item ${right ? "is-right" : "is-wrong"}">
                <p class="tr-review__prompt">${escape(q.prompt)}</p>
                <p class="tr-review__line">${right ? "Correct" : "Your answer"}: ${escape(q.options[picked])}</p>
                ${right || r.answer == null ? "" : `<p class="tr-review__line">Correct answer: ${escape(q.options[r.answer])}</p>`}
                ${r.why ? `<p class="tr-review__why">${escape(r.why)}</p>` : ""}
              </li>`;
            })
            .join("")}
        </ol>
        <div class="tr-actions"><span></span>
          <a class="gr-btn gr-btn--primary" href="/marketplace.html">Browse the marketplace</a>
        </div>`;
    } else {
      panelEl.innerHTML = `
        <p class="tr-eyebrow">Quiz result</p>
        <h2 class="tr-panel__title">You scored ${score} of ${total}</h2>
        <p class="tr-panel__goal">You need ${PASS_SCORE} to pass. Go back through the modules, then take a new quiz.</p>
        <div class="tr-actions"><span></span>
          <button type="button" class="gr-btn gr-btn--primary" data-go="${MODULES[0].id}">Back to module 1</button>
        </div>`;
    }
  }

  function render() {
    renderSteps();
    renderProgress();
    renderLatest();
    if (state.step === QUIZ_STEP) renderQuiz();
    else renderModule(MODULES.find((m) => m.id === state.step));
    wireFeeCalculator(panelEl);
    revealOnScroll(panelEl);
    state.justDone = null; // the check-mark pop plays once
  }

  function goTo(step) {
    state.step = step;
    render();
    panelEl.focus({ preventScroll: true });
    root.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  }

  async function submitQuiz() {
    const btn = panelEl.querySelector("#tr-submit");
    btn?.classList.add("is-loading");
    let result;
    try {
      result = await deps.submitQuiz(state.quiz.attemptId, state.quiz.answers);
    } catch (err) {
      console.warn("[training] could not submit quiz", err);
      btn?.classList.remove("is-loading");
      showPanelError("We couldn't submit your answers. Check your connection and try again.");
      return;
    }
    const { score, total, passed } = result;
    state.latest = { score, total, passed, created_at: new Date().toISOString() };
    state.result = result;
    if (!passed) {
      // Failing sends you back through the course: the quiz re-locks.
      state.done = [];
      writeDone(state.done);
    }
    render();
    panelEl.scrollIntoView({ behavior: "smooth", block: "start" });

    if (!passed) {
      const review = await confirmDialog({
        title: "Please actually complete the course",
        body: `You scored ${score} of ${total}, and you need ${PASS_SCORE} to pass. Work through each module again, then retake the quiz.`,
        confirmLabel: "Back to module 1",
        cancelLabel: "Close",
      });
      state.quiz = null;
      state.result = null;
      if (review) goTo(MODULES[0].id);
      else render();
    }
  }

  root.addEventListener("click", (e) => {
    const stepBtn = e.target.closest("[data-step]");
    if (stepBtn) {
      if (stepBtn.getAttribute("aria-disabled") === "true") {
        goTo(QUIZ_STEP); // shows which modules are left
        return;
      }
      goTo(stepBtn.dataset.step);
      return;
    }
    const go = e.target.closest("[data-go]");
    if (go) {
      state.quiz = state.result ? null : state.quiz;
      state.result = null;
      goTo(go.dataset.go);
      return;
    }
    const complete = e.target.closest("[data-complete]");
    if (complete) {
      const id = complete.dataset.complete;
      if (!state.done.includes(id)) {
        state.done.push(id);
        writeDone(state.done);
        state.justDone = id;
      }
      const next = MODULES.find((m) => !state.done.includes(m.id));
      const idx = MODULES.findIndex((m) => m.id === id);
      goTo(MODULES[idx + 1]?.id || (next ? next.id : QUIZ_STEP));
      return;
    }
    const startBtn = e.target.closest("[data-start-quiz]");
    if (startBtn && !startBtn.classList.contains("is-loading")) startQuiz(startBtn);
  });

  root.addEventListener("change", (e) => {
    const input = e.target;
    if (!state.quiz || input.type !== "radio") return;
    state.quiz.answers[input.name] = Number(input.value);
    const answered = Object.keys(state.quiz.answers).length;
    const total = state.quiz.questions.length;
    root.querySelector("#tr-count").textContent = `${answered} of ${total} answered`;
    root.querySelector("#tr-submit").disabled = answered < total;
  });

  root.addEventListener("submit", (e) => {
    if (e.target.id !== "tr-quiz") return;
    e.preventDefault();
    if (Object.keys(state.quiz.answers).length < state.quiz.questions.length) return;
    if (e.target.querySelector("#tr-submit")?.classList.contains("is-loading")) return;
    submitQuiz();
  });

  render();
  Promise.resolve(deps.loadLatest?.())
    .then((latest) => {
      state.latest = latest || null;
      renderSteps();
      renderProgress();
      renderLatest();
    })
    .catch((err) => console.warn("[training] could not load past attempts", err));
}
