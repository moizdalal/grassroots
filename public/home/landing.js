function initRevealObserver() {
  const revealItems = Array.from(document.querySelectorAll("[data-reveal]"));
  if (!revealItems.length) return;

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.2, rootMargin: "0px 0px -10% 0px" }
  );

  revealItems.forEach((item) => revealObserver.observe(item));
}

function initScrollStory() {
  const steps = Array.from(document.querySelectorAll(".gs-step"));
  const display = document.getElementById("gs-display");
  if (!steps.length || !display) return;

  const fields = {
    eyebrow: document.getElementById("gs-display-eyebrow"),
    tag: document.getElementById("gs-display-tag"),
    title: document.getElementById("gs-display-title"),
    copy: document.getElementById("gs-display-copy"),
    statALabel: document.getElementById("gs-display-stat-a-label"),
    statAValue: document.getElementById("gs-display-stat-a-value"),
    statBLabel: document.getElementById("gs-display-stat-b-label"),
    statBValue: document.getElementById("gs-display-stat-b-value"),
    progressDots: Array.from(display.querySelectorAll(".gs-display__progress span")),
  };

  const activateStep = (step) => {
    steps.forEach((item) => item.classList.toggle("is-active", item === step));
    display.dataset.tone = step.dataset.tone || "brief";

    if (fields.eyebrow) fields.eyebrow.textContent = step.dataset.eyebrow || "";
    if (fields.tag) fields.tag.textContent = step.dataset.tag || "";
    if (fields.title) fields.title.textContent = step.dataset.title || "";
    if (fields.copy) fields.copy.textContent = step.dataset.copy || "";
    if (fields.statALabel) fields.statALabel.textContent = step.dataset.statALabel || "";
    if (fields.statAValue) fields.statAValue.textContent = step.dataset.statAValue || "";
    if (fields.statBLabel) fields.statBLabel.textContent = step.dataset.statBLabel || "";
    if (fields.statBValue) fields.statBValue.textContent = step.dataset.statBValue || "";

    const activeIndex = Number(step.dataset.stepIndex || 0);
    fields.progressDots.forEach((dot, index) => {
      dot.classList.toggle("is-active", index === activeIndex);
    });
  };

  activateStep(steps[0]);

  if (!("IntersectionObserver" in window)) return;

  const stepObserver = new IntersectionObserver(
    (entries) => {
      const visibleEntries = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (!visibleEntries.length) return;
      activateStep(visibleEntries[0].target);
    },
    {
      threshold: [0.35, 0.6, 0.85],
      rootMargin: "-18% 0px -30% 0px",
    }
  );

  steps.forEach((step) => stepObserver.observe(step));
}

function initSwitcher() {
  const switcher = document.querySelector("[data-switcher]");
  if (!switcher) return;

  const buttons = Array.from(switcher.querySelectorAll('[role="tab"]'));
  const panels = Array.from(switcher.querySelectorAll('[role="tabpanel"]'));

  const activatePanel = (button) => {
    const panelId = button.getAttribute("aria-controls");
    buttons.forEach((item) => {
      const isActive = item === button;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-selected", String(isActive));
    });

    panels.forEach((panel) => {
      const isActive = panel.id === panelId;
      panel.hidden = !isActive;
      panel.classList.toggle("is-active", isActive);
    });
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => activatePanel(button));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initRevealObserver();
  initScrollStory();
  initSwitcher();
});
