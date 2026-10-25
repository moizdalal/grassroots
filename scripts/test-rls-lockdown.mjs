// Applies supabase/migrations/rls_lockdown.sql to an in-memory Postgres
// (PGlite) seeded with a mirror of the pre-lockdown live schema, then
// replays the audit attacks and the legitimate negotiation flows as
// anon / authenticated / service_role.
//
// Usage:
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node scripts/test-rls-lockdown.mjs            # with the migration
//   node scripts/test-rls-lockdown.mjs /dev/null  # baseline: attacks succeed
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const migration = process.argv[2] || path.join(here, "..", "supabase", "migrations", "rls_lockdown.sql");
const db = new PGlite();
await db.exec(fs.readFileSync(path.join(here, "rls-fixtures", "pre-lockdown-schema.sql"), "utf8"));
await db.exec(fs.readFileSync(migration, "utf8"));
const U = { A: "00000000-0000-0000-0000-00000000000a", B: "00000000-0000-0000-0000-00000000000b", C: "00000000-0000-0000-0000-00000000000c", D: "00000000-0000-0000-0000-00000000000d" };
const BID = "20000000-0000-0000-0000-000000000001", PAID = "20000000-0000-0000-0000-000000000002";
const LA = "10000000-0000-0000-0000-00000000000a", LB = "10000000-0000-0000-0000-00000000000b";
async function as(who, stmts) {
  await db.exec("begin");
  try {
    if (who === "service") await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`), await db.exec("set local role service_role");
    else if (who === "anon") await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`), await db.exec("set local role anon");
    else await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "authenticated", sub: U[who] })]), await db.exec("set local role authenticated");
    let last;
    for (const s of [].concat(stmts)) last = await db.query(s);
    return { ok: true, rows: last.rows, n: last.rows.length || last.affectedRows || 0 };
  } catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("rollback"); }
}
let fails = 0;
async function t(name, who, sql, expect) {
  const r = await as(who, sql);
  const blocked = !r.ok || r.n === 0;
  const pass = expect === "allow" ? r.ok && r.n > 0 : expect === "block" ? blocked : expect(r);
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"}  [${who}] ${name}  ${r.ok ? `(rows ${r.n})` : `(${r.err})`}`);
}
const upd = (set, id = BID) => `update bids set ${set} where id='${id}' returning id`;
// S1 attacks
await t("owner sets payment_status=held", "A", upd("payment_status='held', paid_at=now()"), "block");
await t("owner marks bid accepted", "A", upd("status='accepted'"), "block");
await t("consultant sets released on paid bid", "C", upd("payment_status='released'", PAID), "block");
await t("consultant edits price", "C", upd("amount_cents=99999"), "block");
await t("consultant edits payout", "C", upd("consultant_payout_cents=1"), "block");
await t("consultant deletes bid", "C", `delete from bids where id='${PAID}' returning id`, "block");
await t("consultant counters own bid", "C", upd("status='countered', counter_offer_cents=90000, counter_attempted=true"), "block");
await t("owner changes consultant price", "A", upd("amount_cents=1"), "block");
await t("consultant revives on paid bid", "C", upd("status='pending'", PAID), "block");
// legit flows
await t("consultant submits offer", "C", `insert into bids(listing_id, consultant_id, message, amount_cents) values ('${LB}', '${U.C}', 'hi', 1000) on conflict do nothing returning id`, (r) => r.ok); // conflict w/ paid bid on LB -> 0 rows ok
await t("consultant D submits offer", "D", `insert into bids(listing_id, consultant_id, message, amount_cents, proposal_fee_cents, service_fee_cents) values ('${LA}', '${U.D}', 'hi', 1000, 0, 1000) returning id`, "allow");
await t("consultant inserts pre-paid bid", "D", `insert into bids(listing_id, consultant_id, amount_cents, payment_status) values ('${LA}', '${U.D}', 1000, 'held') returning id`, "block");
const counter = upd(`status='countered', counter_offer_cents=40000, counter_offer_message='m', counter_expires_at=now()+interval '24 hours', counter_attempted=true`);
await t("owner sends counter", "A", counter, "allow");
await t("owner counters with 30d expiry", "A", upd(`status='countered', counter_offer_cents=40000, counter_expires_at=now()+interval '30 days', counter_attempted=true`), "block");
await t("owner declines", "A", upd(`status='declined', declined_at=now()`), "allow");
await t("consultant withdraws", "C", upd(`status='declined', declined_at=now()`), "allow");
// sequential: owner counters, then consultant responds
await db.exec(`update bids set status='countered', counter_offer_cents=40000, counter_expires_at=now()+interval '24 hours', counter_attempted=true where id='${BID}'`);
await t("consultant accepts counter at counter price", "C", upd(`status='pending', amount_cents=40000, counter_offer_cents=null, counter_offer_message=null, counter_expires_at=null, counter_responded_at=now(), counter_response_message='ok'`), "allow");
await t("consultant 'accepts' counter at inflated price", "C", upd(`status='pending', amount_cents=400000, counter_offer_cents=null`), "block");
await t("consultant keeps original", "C", upd(`status='pending', counter_offer_cents=null, counter_offer_message=null, counter_expires_at=null, counter_responded_at=now()`), "allow");
await t("owner strips counter", "A", upd(`status='pending', counter_offer_cents=null, counter_offer_message=null, counter_expires_at=null, counter_responded_at=now()`), "allow");
await t("owner re-counters", "A", upd(`counter_offer_cents=30000`), "block");
await t("owner resets counter_attempted", "A", upd(`counter_attempted=false`), "block");
await t("service role sets held", "service", upd("payment_status='held', status='accepted'"), "allow");
await db.exec(`update bids set status='declined' where id='${BID}'`);
await t("consultant revives declined bid", "C", upd(`status='pending'`), "block");
// S2
const pupd = (set) => `update profiles set ${set} where id='${U.A}' returning id`;
await t("user sets own role", "A", pupd("role='consultant'"), "block");
await t("user sets own stripe_customer_id", "A", pupd("stripe_customer_id='cus_B'"), "block");
await t("user sets terms_accepted_at", "A", pupd("terms_accepted_at=now()"), "block");
await t("user edits name/phone/linkedin", "A", pupd("full_name='x', phone_number='1', linkedin_url='l', onboarded_at=now(), read_receipts_enabled=false"), "allow");
await t("user edits other user's name", "A", `update profiles set full_name='x' where id='${U.B}' returning id`, "block");
// S3
await t("anon reads owner phone", "anon", `select phone_number from profiles`, "block");
await t("anon reads owner stripe_customer_id", "anon", `select stripe_customer_id from profiles`, "block");
await t("anon reads owner display", "anon", `select id, full_name, role, avatar_path, linkedin_url from profiles`, (r) => r.ok && r.n === 2);
await t("anon reads business_profiles", "anon", `select business_address from business_profiles`, (r) => r.ok && r.n === 1);
await t("anon reads consultant profiles", "anon", `select id from profiles where role='consultant'`, (r) => r.ok && r.n === 0);
await t("consultant reads consultant D", "C", `select id from profiles where id='${U.D}'`, (r) => r.ok && r.n === 0);
await t("consultant reads consultant_profiles of others", "D", `select * from consultant_profiles where user_id <> '${U.D}'`, (r) => r.ok && r.n === 0);
await t("owner reads consultant who bid on their listing", "A", `select id, full_name from profiles where role='consultant'`, (r) => r.ok && r.n === 1 && r.rows[0].id === U.C);
await t("owner can't see consultant who never contacted them", "A", `select id from profiles where id='${U.D}'`, (r) => r.ok && r.n === 0);
await t("owner can't see uncontacted consultant_profiles", "A", `select user_id from consultant_profiles where user_id='${U.D}'`, (r) => r.ok && r.n === 0);
await t("owner can't see uncontacted public portfolio", "A", `select id from portfolio_items where user_id='${U.D}'`, (r) => r.ok && r.n === 0);
await t("owner sees bidder's public portfolio", "A", `select id from portfolio_items where user_id='${U.C}'`, (r) => r.ok && r.n === 1);
await t("owner can't see bids on another business's listing", "A", `select id from bids where listing_id='${LB}'`, (r) => r.ok && r.n === 0);
await t("owner messaging a consultant doesn't unlock them", "A", [`insert into messages(sender_id, recipient_id, body) values ('${U.A}', '${U.D}', 'hi')`, `select id from profiles where id='${U.D}'`], (r) => r.ok && r.n === 0);
await t("consultant messaging an owner unlocks them", "D", [`insert into messages(sender_id, recipient_id, body) values ('${U.D}', '${U.A}', 'hi')`, `select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${U.A}"}', true)`, `select id from profiles where id='${U.D}'`], (r) => r.ok && r.n === 1);
await t("owner reads consultant phone", "A", `select phone_number from profiles where role='consultant'`, "block");
await t("owner reads consultant stripe_account_id", "A", `select stripe_account_id from profiles`, "block");
await t("select * on profiles", "A", `select * from profiles`, "block");
await t("owner reads consultant_profiles", "A", `select * from consultant_profiles`, (r) => r.ok && r.n === 1);
await t("own private via rpc", "A", `select * from get_my_private_profile()`, (r) => r.ok && r.n === 1 && r.rows[0].phone_number === "555-a");
await t("anon cannot call private rpc", "anon", `select * from get_my_private_profile()`, "block");
await t("embed-style join still works", "anon", `select l.title, p.full_name from listings l join profiles p on p.id=l.owner_id`, (r) => r.ok && r.n === 2);
// S4 reviews
const rev = (cid, bid, lid) => `insert into consultant_reviews(listing_id, bid_id, owner_id, consultant_id) values ('${lid}', '${bid}', '${U.B}', '${cid}') returning id`;
await t("owner reviews unrelated consultant D", "B", rev(U.D, PAID, LB), "block");
await t("owner reviews with someone else's bid", "B", rev(U.C, BID, LB), "block");
await t("owner reviews hired consultant", "B", rev(U.C, PAID, LB), "allow");
await t("owner edits review", "B", [rev(U.C, PAID, LB), `update consultant_reviews set communication=1 where bid_id='${PAID}' returning id`], "block");
await t("owner double-reviews", "B", [rev(U.C, PAID, LB), rev(U.C, PAID, LB)], "block");
// messages, grants
await t("recipient rewrites message body", "A", `update messages set body='forged' where recipient_id='${U.A}' returning id`, "block");
await t("recipient marks read", "A", `update messages set read_at=now() where recipient_id='${U.A}' returning id`, "allow");
await t("authenticated truncate bids", "A", `truncate bids`, "block");
await t("anon inserts listing", "anon", `insert into listings values (gen_random_uuid(), '${U.A}', 'open', 'x') returning id`, "block");
// S7
const b = (await db.query(`select file_size_limit, 'text/html' = any(allowed_mime_types) html, 'image/svg+xml' = any(allowed_mime_types) svg, 'application/pdf' = any(allowed_mime_types) pdf from storage.buckets where id='portfolio'`)).rows[0];
const s7 = b.file_size_limit == 52428800 && !b.html && !b.svg && b.pdf; if (!s7) fails++;
console.log(`${s7 ? "PASS" : "FAIL"}  portfolio bucket limits ${JSON.stringify(b)}`);
const ec = (await db.query(`select count(*)::int n from information_schema.columns where table_name='profiles' and column_name='employment_status'`)).rows[0].n;
if (ec) fails++; console.log(`${ec ? "FAIL" : "PASS"}  employment_status dropped`);
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
