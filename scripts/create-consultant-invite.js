// Issue a single-use consultant invite bound to a school email.
//   node scripts/create-consultant-invite.js student@ufl.edu
//   node scripts/create-consultant-invite.js student@ufl.edu 14

const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { createInvite } = require("../lib/consultant-invites");

async function main() {
  const email = process.argv[2];
  const expiresInDays = process.argv[3];
  if (!email) {
    console.error("usage: node scripts/create-consultant-invite.js student@school.edu [days]");
    process.exit(1);
  }

  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env");
    process.exit(1);
  }

  const appUrl = String(process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).trim();
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const invite = await createInvite(supabase, { email, expiresInDays, appUrl });
  console.log(invite.url);
  console.log(`email ${invite.email}`);
  console.log(`expires ${invite.expiresAt}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
