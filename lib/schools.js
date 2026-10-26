const fs = require("fs");
const path = require("path");

// Keep the match rules in sync with public/school-autocomplete.js.
let schools = null;

function loadSchools() {
  if (schools) return schools;
  const file = path.join(__dirname, "../public/data/schools.json");
  schools = JSON.parse(fs.readFileSync(file, "utf8"));
  return schools;
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function emailHost(email) {
  const value = String(email || "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1) return "";
  return value.slice(at + 1).replace(/\.+$/, "");
}

function isEduHost(host) {
  return /^[a-z0-9.-]+\.edu$/.test(host) && !host.includes("..");
}

function hostMatchesDomain(host, domain) {
  const expected = String(domain || "").toLowerCase().replace(/\.+$/, "");
  if (!host || !expected) return false;
  return host === expected || host.endsWith(`.${expected}`);
}

function findSchool(name) {
  const key = normalizeName(name);
  if (!key) return null;
  return loadSchools().find((school) => normalizeName(school.name) === key) || null;
}

function primaryDomain(school) {
  const domains = school?.domains || [];
  return domains.find((domain) => domain.endsWith(".edu")) || domains[0] || "";
}

function schoolMatchesEmail(schoolName, email) {
  const host = emailHost(email);
  if (!isEduHost(host)) {
    return { ok: false, error: "Use a .edu email address." };
  }
  const school = findSchool(schoolName);
  if (!school) {
    return { ok: false, error: "Pick your school from the list." };
  }
  const matched = (school.domains || []).some((domain) => hostMatchesDomain(host, domain));
  if (!matched) {
    const domain = primaryDomain(school);
    return {
      ok: false,
      error: domain
        ? `That email doesn't match this school. Use an @${domain} address.`
        : "That email doesn't match this school.",
    };
  }
  return { ok: true, school, host };
}

module.exports = {
  findSchool,
  schoolMatchesEmail,
  emailHost,
  isEduHost,
};
