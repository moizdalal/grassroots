// Builds the images transactional emails use: the sprout mark, one glyph
// per event family, and the progress stem's track (its labels are live
// text in lib/email-template.js, so no font is baked into an image). Each is written as an SVG (the
// source) and a 2x PNG (what emails load, since Gmail drops SVG images).
//
// Run after changing a shape or color here, then commit public/email/.
//   node scripts/build-email-assets.js
// Needs Google Chrome installed; puppeteer-core drives it headless.

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const OUT = path.join(__dirname, "..", "public", "email");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Mirrors the light and dark-forest tokens in public/field-office.css.
const THEMES = {
  light: { disc: "#e6f0ea", stroke: "#2f7a5a", mark: "#2f7a5a", mutedDisc: "#efe9d8", mutedStroke: "#4a5650", done: "#2f7a5a", current: "#2f7a5a", ground: "#ffffff", track: "#e4ded0", next: "#cfc7b5" },
  dark: { disc: "#1f3a2e", stroke: "#6dbf8a", mark: "#6dbf8a", mutedDisc: "#20342b", mutedStroke: "#a8b8ad", done: "#2f7a5a", current: "#6dbf8a", ground: "#14201a", track: "#284036", next: "#3d5a4c" },
};

// The sprout from public/favicon.svg (viewBox 0 0 163 275).
const SPROUT = [
  `<path transform="translate(72 130)" d="M19 10.15C19 4.54431 14.7467 0 9.5 0C4.25329 0 0 4.54431 0 10.15C7.91804 91.2467 8.44249 120.691 0 134.85C0 140.456 4.25329 145 9.5 145C14.7467 145 19 140.456 19 134.85C16.2169 71.2734 12.3479 23.288 19 10.15Z"/>`,
  `<path transform="translate(0 65)" d="M84 87C21 71.5333 -6.5625 42.5333 1.3125 0C56.4375 3.86667 84 32.8667 84 87Z"/>`,
  `<path transform="translate(82 0)" d="M0 147C48.6 116.053 75.6 67.0526 81 0C27 5.1579 0 54.1579 0 147Z"/>`,
].join("");

// 24px stroke icons. The accepted glyph is the sprout itself, outlined.
const GLYPHS = {
  offer: `<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>`,
  counter: `<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/>`,
  accepted: `<g transform="translate(6.3 2.4) scale(0.07)" stroke-width="25">${SPROUT}</g>`,
  delivered: `<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>`,
  changes: `<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>`,
  payment: `<circle cx="12" cy="14.5" r="6.5"/><path d="M12 8c0-2.6 1.6-4.6 4.5-5 0 2.8-1.6 4.6-4.5 5z"/><path d="M12 12v5"/>`,
  review: `<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>`,
  declined: `<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>`,
};

const STEP_X = [12, 182, 353, 524];
// Stem name → index of the current step (4 = every step done).
const STEMS = { kickoff: 1, delivered: 2, paid: 4 };

function glyphSvg(name, t) {
  const muted = name === "declined";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
<circle cx="22" cy="22" r="22" fill="${muted ? t.mutedDisc : t.disc}"/>
<g transform="translate(11 11)" fill="none" stroke="${muted ? t.mutedStroke : t.stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</g>
</svg>`;
}

function markSvg(t) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="26" viewBox="0 0 163 275" fill="${t.mark}">${SPROUT}</svg>`;
}

function stemSvg(current, t) {
  const check = (x) => `<path d="m${x - 3.5} 14 2.5 2.5 4.5-5" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`;
  const reach = STEP_X[Math.min(current, 3)];
  let out = `<line x1="12" y1="14" x2="${reach}" y2="14" stroke="${t.done}" stroke-width="2"/>`;
  if (current < 3) out += `<line x1="${reach}" y1="14" x2="524" y2="14" stroke="${t.track}" stroke-width="2"/>`;
  STEP_X.forEach((x, i) => {
    const done = i < current;
    const isCurrent = i === current || (current === 4 && i === 3);
    if (done) out += `<circle cx="${x}" cy="14" r="8" fill="${t.done}"/>${check(x)}`;
    else if (isCurrent) out += `<circle cx="${x}" cy="14" r="8" fill="${t.ground}" stroke="${t.current}" stroke-width="2"/><circle cx="${x}" cy="14" r="3" fill="${t.current}"/>`;
    else out += `<circle cx="${x}" cy="14" r="5" fill="${t.ground}" stroke="${t.next}" stroke-width="1.5"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="536" height="28" viewBox="0 0 536 28">${out}</svg>`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = [];
  for (const [theme, t] of Object.entries(THEMES)) {
    files.push([`mark-${theme}`, markSvg(t)]);
    for (const name of Object.keys(GLYPHS)) files.push([`glyph-${name}-${theme}`, glyphSvg(name, t)]);
    for (const [name, current] of Object.entries(STEMS)) files.push([`stem-${name}-${theme}`, stemSvg(current, t)]);
  }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  for (const [name, svg] of files) {
    fs.writeFileSync(path.join(OUT, `${name}.svg`), svg + "\n");
    const [, w, h] = svg.match(/width="(\d+)" height="(\d+)"/);
    await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: 2 });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: true });
  }
  await browser.close();
  console.log(`Wrote ${files.length} SVG + PNG pairs to public/email/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
