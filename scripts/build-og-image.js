// Builds public/og-image.png, the 1200x630 link preview every marketing
// page points og:image and twitter:image at (iMessage, Slack, LinkedIn, X).
// Same visual language as the LinkedIn banners: green sky over dark soil,
// one white sprout standing on the soil line.
//
// Run after changing copy or shapes here, then commit public/og-image.png.
//   node scripts/build-og-image.js
// Needs Google Chrome installed; puppeteer-core drives it headless.
// Crawlers cache previews hard, so bump the ?v= query on og:image after a rebuild.

const path = require("path");
const puppeteer = require("puppeteer-core");

const OUT = path.join(__dirname, "..", "public", "og-image.png");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// dark-forest tokens from public/field-office.css.
const C = {
  sky: "#2f7a5a",     // --fo-accent
  soil: "#14201a",    // --fo-bg
  text: "#f0ebdf",    // --fo-text
  text2: "#a8b8ad",   // --fo-text-2
  white: "#ffffff",
};

// The sprout from public/favicon.svg (viewBox 0 0 163 275).
const SPROUT = `<symbol id="s" viewBox="0 0 163 275"><path transform="translate(72 130)" d="M19 10.15C19 4.54431 14.7467 0 9.5 0C4.25329 0 0 4.54431 0 10.15C7.91804 91.2467 8.44249 120.691 0 134.85C0 140.456 4.25329 145 9.5 145C14.7467 145 19 140.456 19 134.85C16.2169 71.2734 12.3479 23.288 19 10.15Z"/><path transform="translate(0 65)" d="M84 87C21 71.5333 -6.5625 42.5333 1.3125 0C56.4375 3.86667 84 32.8667 84 87Z"/><path transform="translate(82 0)" d="M0 147C48.6 116.053 75.6 67.0526 81 0C27 5.1579 0 54.1579 0 147Z"/></symbol>`;

const W = 1200, H = 630, SOIL = 418;   // soil line
const BX = 960;                          // sprout base x


const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>${SPROUT}</defs>
  <rect width="${W}" height="${SOIL}" fill="${C.sky}"/>
  <rect y="${SOIL}" width="${W}" height="${H - SOIL}" fill="${C.soil}"/>
  <use href="#s" x="${BX - 0.47 * 150}" y="${SOIL - 254}" width="150" height="254" fill="${C.white}"/>
</svg>`;

const html = `<!doctype html>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Figtree:wght@500;600&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${C.soil}; }
  .wrap { position: relative; width: ${W}px; height: ${H}px; }
  svg { position: absolute; inset: 0; display: block; }
  .brand { position: absolute; left: 72px; top: 60px; display: flex; align-items: center; gap: 12px;
    font-family: "Fraunces", serif; font-weight: 600; font-size: 34px; letter-spacing: -0.01em; color: ${C.white}; }
  .brand svg { position: static; width: 22px; height: 37px; fill: ${C.white}; }
  h1 { position: absolute; left: 72px; top: 152px; margin: 0; width: 760px;
    font-family: "Fraunces", serif; font-weight: 600; font-style: normal; font-size: 84px;
    line-height: 1.02; letter-spacing: -0.028em; color: ${C.white}; }
  h1 span { display: block; color: ${C.soil}; }
  p { position: absolute; left: 72px; top: ${SOIL + 44}px; margin: 0; width: 520px;
    font-family: "Figtree", sans-serif; font-weight: 500; font-size: 26px; line-height: 1.4; color: ${C.text2}; }
  .url { position: absolute; left: 72px; bottom: 40px;
    font-family: "Figtree", sans-serif; font-weight: 600; font-size: 22px; letter-spacing: 0.02em; color: ${C.text}; }
</style>
<div class="wrap">
  ${svg}
  <div class="brand"><svg viewBox="0 0 163 275">${SPROUT.replace(/<\/?symbol[^>]*>/g, "")}</svg>grassroots</div>
  <h1>Local business meets <span>campus talent</span></h1>
  <p>Real projects for local businesses, real paid work for students.</p>
  <div class="url">grassroots-marketplace.com</div>
</div>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, type: "png" });
  await browser.close();
  console.log("wrote", path.relative(process.cwd(), OUT));
})();
