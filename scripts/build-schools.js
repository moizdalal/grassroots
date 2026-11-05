// Rebuild public/data/schools.json from the Hipo university domain list.
// Keeps schools that publish at least one .edu domain. Run:
//   node scripts/build-schools.js

const fs = require("fs");
const path = require("path");

const SOURCE =
  "https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json";

function cleanDomain(raw) {
  let domain = String(raw || "").trim().toLowerCase().replace(/\.+$/, "");
  domain = domain.replace(/^www\./, "");
  if (!domain || domain === "edu" || !domain.endsWith(".edu")) return "";
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.includes("..")) return "";
  return domain;
}

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`could not download school list (${res.status})`);
  const rows = await res.json();
  const byName = new Map();

  for (const row of rows) {
    const name = String(row.name || "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const domains = (row.domains || []).map(cleanDomain).filter(Boolean);
    if (!domains.length) continue;
    const key = name.toLowerCase();
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, { name, domains: new Set(domains) });
    } else {
      for (const domain of domains) prev.domains.add(domain);
    }
  }

  const schools = [...byName.values()]
    .map((school) => ({
      name: school.name,
      domains: [...school.domains].sort((a, b) => a.length - b.length || a.localeCompare(b)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const out = path.join(__dirname, "../public/data/schools.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(schools));

  const florida = schools.find((school) => school.name === "University of Florida");
  console.log(`wrote ${schools.length} schools to public/data/schools.json`);
  console.log(florida ? `University of Florida: ${florida.domains.join(", ")}` : "University of Florida missing");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
