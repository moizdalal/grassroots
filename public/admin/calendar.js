// calendar.js — month-grid calendar with event dots. Renders into a
// host element; callers pass `events: [{ date, title, sub, color, payload }]`
// and an `onSelect(day, dayEvents)` callback.

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function mountCalendar(host, { events, today, onSelect }) {
  let cursor = startOfMonth(today);
  let selectedDay = null;

  function eventsOn(day) {
    return events.filter((e) => isSameDay(e.date, day));
  }

  function render() {
    const monthStart = cursor;
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());
    const monthLabel = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toLowerCase();

    let cells = "";
    const cursorDay = new Date(gridStart);
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 7; col++) {
        const day = new Date(cursorDay);
        const inMonth = day.getMonth() === monthStart.getMonth();
        const isToday = isSameDay(day, today);
        const isSelected = selectedDay && isSameDay(day, selectedDay);
        const dayEvents = eventsOn(day);
        const dotCount = Math.min(dayEvents.length, 4);
        let dots = "";
        for (let i = 0; i < dotCount; i++) {
          dots += `<span class="cal-dot" style="background:${dayEvents[i].color || "var(--fo-accent)"}"></span>`;
        }
        const extra = dayEvents.length > dotCount ? `<span class="cal-more">+${dayEvents.length - dotCount}</span>` : "";
        const cls = [
          "cal-cell",
          inMonth ? "" : "cal-cell--out",
          isToday ? "cal-cell--today" : "",
          isSelected ? "cal-cell--selected" : "",
          dayEvents.length ? "cal-cell--has" : "",
        ].filter(Boolean).join(" ");
        cells += `
          <button type="button" class="${cls}" data-iso="${day.toISOString()}">
            <span class="cal-cell-num">${day.getDate()}</span>
            ${dots ? `<span class="cal-cell-dots">${dots}${extra}</span>` : ""}
          </button>
        `;
        cursorDay.setDate(cursorDay.getDate() + 1);
      }
    }

    host.innerHTML = `
      <div class="cal">
        <header class="cal-head">
          <button type="button" class="cal-nav" data-act="prev" aria-label="previous month">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h3 class="cal-title">${esc(monthLabel)}</h3>
          <button type="button" class="cal-nav" data-act="next" aria-label="next month">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button type="button" class="cal-today" data-act="today">today</button>
        </header>
        <div class="cal-dow">
          ${DOW.map((d) => `<span>${d}</span>`).join("")}
        </div>
        <div class="cal-grid">
          ${cells}
        </div>
      </div>
    `;

    host.querySelectorAll(".cal-nav, .cal-today").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "prev") cursor = addMonths(cursor, -1);
        else if (act === "next") cursor = addMonths(cursor, 1);
        else if (act === "today") { cursor = startOfMonth(today); selectedDay = today; }
        render();
        if (act === "today") onSelect?.(today, eventsOn(today));
      });
    });

    host.querySelectorAll(".cal-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        const day = new Date(cell.dataset.iso);
        selectedDay = day;
        render();
        onSelect?.(day, eventsOn(day));
      });
    });
  }

  render();
}
