// Applies rls_lockdown.sql, add_delivery_release.sql and
// add_support_outcomes.sql to an in-memory
// Postgres (PGlite) and checks that browsers can't set delivery, hold,
// backstop or refund state on bids / bid_phase_payments, while the server
// (service_role) and participants' reads still work.
//
// Usage:
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node scripts/test-delivery-release-grants.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const mig = (f) => fs.readFileSync(path.join(here, "..", "supabase", "migrations", f), "utf8");
const db = new PGlite();
await db.exec(fs.readFileSync(path.join(here, "rls-fixtures", "pre-lockdown-schema.sql"), "utf8"));
// Tables the RLS fixture doesn't mirror, shaped like add_phased_retainer_payments.sql.
await db.exec(`
  create table auth.users (id uuid primary key);
  insert into auth.users select id from profiles;
  create table bid_phase_payments (
    id uuid primary key default gen_random_uuid(), bid_id uuid references bids(id), phase text, period_index int,
    amount_cents int, payment_intent_id text, charge_id text, transfer_id text, status text default 'unpaid',
    paid_at timestamptz, released_at timestamptz, refunded_at timestamptz, consultant_payout_cents int);
  alter table bid_phase_payments enable row level security;
  create policy "phase payments readable by participants" on bid_phase_payments for select to authenticated using (
    exists (select 1 from bids b join listings l on l.id = b.listing_id
            where b.id = bid_phase_payments.bid_id and (auth.uid() = b.consultant_id or auth.uid() = l.owner_id)));
  -- simulate a stray legacy grant + policy the migration must neutralize
  grant select, update on bid_phase_payments to authenticated;
  create policy "legacy upd" on bid_phase_payments for update to authenticated using (true) with check (true);
`);
await db.exec(mig("rls_lockdown.sql"));
await db.exec(mig("add_delivery_release.sql"));
await db.exec(mig("add_support_outcomes.sql"));
// Re-grant the stray UPDATE after the migration so the trigger is what stops it.
await db.exec(`grant update on bid_phase_payments to authenticated`);

const U = { A: "00000000-0000-0000-0000-00000000000a", C: "00000000-0000-0000-0000-00000000000c" };
const PAID = "20000000-0000-0000-0000-000000000002";
const ROW = "30000000-0000-0000-0000-000000000001";
await db.exec(`update bids set payment_status='held', status='accepted', paid_at=now() where id='${PAID}'`);
await db.exec(`insert into bid_phase_payments(id, bid_id, phase, status, amount_cents, paid_at) values ('${ROW}', '${PAID}', 'service', 'held', 1000, now())`);
const owner = (await db.query(`select l.owner_id from bids b join listings l on l.id=b.listing_id where b.id='${PAID}'`)).rows[0].owner_id;
const consultant = (await db.query(`select consultant_id from bids where id='${PAID}'`)).rows[0].consultant_id;

async function as(who, sql) {
  await db.exec("begin");
  try {
    if (who === "service") await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`), await db.exec("set local role service_role");
    else await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "authenticated", sub: who })]), await db.exec("set local role authenticated");
    const r = await db.query(sql);
    return { ok: true, n: r.rows.length || r.affectedRows || 0 };
  } catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("rollback"); }
}
let fails = 0;
async function t(name, who, sql, expect) {
  const r = await as(who, sql);
  const pass = expect === "allow" ? r.ok && r.n > 0 : !r.ok || r.n === 0;
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${r.ok ? `(rows ${r.n})` : `(${r.err})`}`);
}
const ub = (set) => `update bids set ${set} where id='${PAID}' returning id`;
const up = (set) => `update bid_phase_payments set ${set} where id='${ROW}' returning id`;

for (const [who, label] of [[consultant, "consultant"], [owner, "owner"]]) {
  await t(`${label} sets bids.delivered_at`, who, ub("delivered_at=now()"), "block");
  await t(`${label} clears bids.support_hold_at`, who, ub("support_hold_at=null"), "block");
  await t(`${label} sets bids.backstop_flagged_at`, who, ub("backstop_flagged_at=now()"), "block");
  await t(`${label} zeroes bids.refunded_cents`, who, ub("refunded_cents=0"), "block");
  await t(`${label} sets bids.changes_requested_at`, who, ub("changes_requested_at=now()"), "block");
  await t(`${label} sets phase delivered_at (stray grant)`, who, up("delivered_at=now()"), "block");
  await t(`${label} sets phase period_end_at (stray grant)`, who, up("period_end_at=now()"), "block");
  await t(`${label} inserts a phase row`, who, `insert into bid_phase_payments(bid_id, phase, status, amount_cents) values ('${PAID}', 'service', 'held', 1) returning id`, "block");
  await t(`${label} reads delivery columns on the bid`, who, `select delivered_at, support_hold_at, refunded_cents from bids where id='${PAID}'`, "allow");
  await t(`${label} reads delivery columns on the phase row`, who, `select delivered_at, period_end_at from bid_phase_payments where id='${ROW}'`, "allow");
}
await t("stranger reads the phase row", U.A === owner ? U.C : U.A, `select id from bid_phase_payments where id='${ROW}'`, "block");
await t("authenticated calls stranded_funds_report", consultant, `select * from stranded_funds_report(0)`, "block");
await t("service marks delivered on bid", "service", ub("delivered_at=now(), delivery_note='done'"), "allow");
await t("service sets hold on phase row", "service", up("support_hold_at=now(), support_hold_reason='x'"), "allow");
await t("service runs stranded_funds_report", "service", `select * from stranded_funds_report(0)`, "allow");
const BID = "20000000-0000-0000-0000-000000000001";
const bidConsultant = (await db.query(`select consultant_id from bids where id='${BID}'`)).rows[0].consultant_id;
await t("negotiation grants intact: consultant withdraws a pending offer", bidConsultant, `update bids set status='declined', declined_at=now() where id='${BID}' returning id`, "allow");
await t("delivery link must be http(s)", "service", ub("delivery_link='javascript:alert(1)'"), "block");

// add_support_outcomes.sql: reported problems, outcomes, audit trail.
await t("owner sets bids.problem_reported_at", owner, ub("problem_reported_at=now()"), "block");
await t("owner clears bids.support_outcome", owner, ub("support_outcome=null"), "block");
await t("consultant sets bids.consultant_choice", consultant, ub("consultant_choice='redo'"), "block");
await t("consultant resets bids.redo_used", consultant, ub("redo_used=false"), "block");
await t("consultant moves bids.redo_deadline_at", consultant, ub("redo_deadline_at=now() + interval '30 days'"), "block");
await t("owner sets phase support_outcome (stray grant)", owner, up("support_outcome='scope_breached'"), "block");
await t("owner reads report columns on the bid", owner, `select problem_report_note, support_outcome, redo_deadline_at, consultant_choice from bids where id='${PAID}'`, "allow");
await t("consultant reads outcome columns on the phase row", consultant, `select support_outcome, redo_used from bid_phase_payments where id='${ROW}'`, "allow");
await t("service sets outcome + report on bid", "service", ub("problem_reported_at=now(), problem_report_count=1, support_outcome='fixable', redo_deadline_at=now()"), "allow");
await t("support_outcome only takes known values", "service", ub("support_outcome='split'"), "block");
await t("consultant_choice only takes known values", "service", ub("consultant_choice='half'"), "block");
await t("problem link must be http(s)", "service", ub("problem_report_link='javascript:alert(1)'"), "block");
await db.exec(`insert into payment_audit(payment_table, payment_id, bid_id, action) values ('bids', '${PAID}', '${PAID}', 'seed')`);
await t("owner reads payment_audit", owner, `select id from payment_audit`, "block");
await t("consultant reads payment_audit", consultant, `select id from payment_audit`, "block");
await t("owner writes payment_audit", owner, `insert into payment_audit(payment_table, payment_id, action) values ('bids', '${PAID}', 'fake') returning id`, "block");
await t("service writes payment_audit", "service", `insert into payment_audit(payment_table, payment_id, bid_id, action, amount_cents) values ('bids', '${PAID}', '${PAID}', 'outcome_meets_scope', 9680) returning id`, "allow");
await t("service reads payment_audit", "service", `select id from payment_audit`, "allow");

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exitCode = fails ? 1 : 0;
