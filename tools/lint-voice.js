#!/usr/bin/env node
// Voice lint — scans HTML for visible text starting with an uppercase
// letter outside an exception list. Brandkit rule: lowercase always,
// proper nouns and user-generated content excepted.
//
// Usage:
//   node tools/lint-voice.js              # scan public/*.html
//   node tools/lint-voice.js path1 ...    # scan specific files
//
// Exits 0 on clean; 1 with findings list when violations exist.

const fs = require("fs");
const path = require("path");

// Words that legitimately start with a capital letter. Brand names,
// company names, school names, founder name, mock-card placeholders.
// Expand as the codebase grows; missed words show up as false-positive
// hits and the right move is usually to add them here, not to lowercase
// the name.
const PROPER = new Set([
  "Stripe", "LinkedIn", "Reddit", "Snapchat", "Spotify", "Google",
  "Apple", "Microsoft", "Amazon", "Meta", "Facebook", "Instagram",
  "Twitter", "X", "YouTube", "TikTok",
  "UF", "FAQ", "CEO", "CTO", "USA", "ROI", "LLC", "NDA", "IRS",
  "API", "HQ", "NYC", "SF", "PR", "AI", "ML", "UI", "UX",
  "DM", "PM", "AM", "JS", "CSS", "HTML", "PDF", "PNG", "JPG", "MP4",
  "DoorDash", "Manrope", "Fraunces", "Caveat", "JetBrains",
  "Sundays", "Gainesville", "Florida", "FL",
  "Rho", "Epsilon", "Mu", "REM", "Moiz", "Dalal", "Wes", "Cherie",
  "August", "October", "January", "February", "March", "April",
  "May", "June", "July", "September", "November", "December",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "I", "Dear", "Mr", "Mrs", "Ms", "Dr",
  "Grassroots", // proper noun for the founder letter & legal contexts
  "Phase", "Standard", "Phased", "Retainer", "Tentative", // contract type proper-noun-ish (acceptable as labels)
]);

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/&#x?[0-9a-fA-F]+;/g, " ");
}

function* iterChunks(text) {
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    for (const chunk of line.split(/(?<=[.!?])\s+/)) {
      yield chunk.trim();
    }
  }
}

function lintFile(file) {
  const html = fs.readFileSync(file, "utf8");
  const text = visibleText(html);
  const violations = [];
  for (const chunk of iterChunks(text)) {
    const m = chunk.match(/[A-Za-z]/);
    if (!m) continue;
    if (!m[0].match(/[A-Z]/)) continue;
    const word = chunk.slice(m.index).match(/[A-Za-z][\w']*/);
    if (!word) continue;
    if (PROPER.has(word[0])) continue;
    // Allow all-caps acronyms up to 5 chars (covers FAQ, NASA, etc.)
    if (word[0].length <= 5 && word[0] === word[0].toUpperCase()) continue;
    violations.push(chunk.slice(0, 140));
  }
  return violations;
}

function main() {
  const args = process.argv.slice(2);
  let files = args.length ? args : null;
  if (!files) {
    const publicDir = path.join(__dirname, "..", "public");
    files = fs.readdirSync(publicDir)
      .filter((f) => f.endsWith(".html"))
      .map((f) => path.join(publicDir, f));
    const homeDir = path.join(publicDir, "home");
    if (fs.existsSync(homeDir)) {
      for (const f of fs.readdirSync(homeDir)) {
        if (f.endsWith(".html")) files.push(path.join(homeDir, f));
      }
    }
  }

  let totalViolations = 0;
  for (const file of files) {
    const v = lintFile(file);
    if (v.length) {
      console.log(`\n${path.relative(process.cwd(), file)} (${v.length})`);
      for (const chunk of v.slice(0, 25)) console.log(`  · ${chunk}`);
      if (v.length > 25) console.log(`  · …and ${v.length - 25} more`);
      totalViolations += v.length;
    }
  }

  if (totalViolations === 0) {
    console.log("voice lint clean.");
    process.exit(0);
  }
  console.log(`\nvoice lint: ${totalViolations} violation${totalViolations === 1 ? "" : "s"}.`);
  console.log("(add a real proper noun to tools/lint-voice.js PROPER set, otherwise lowercase the copy.)");
  process.exit(1);
}

main();
