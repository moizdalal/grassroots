# Breach response runbook

What to do if grassroots experiences a security incident that may have exposed personal information.

## Definition

A "breach" for our purposes is any incident where personal data we hold may have been:
- accessed by an unauthorized party (e.g. exposed Supabase row, leaked storage URL, compromised admin account),
- exfiltrated by an attacker (e.g. credential stuffing, SQL injection, social engineering),
- or made publicly accessible by accident (e.g. RLS misconfiguration, bucket set to public when it should be private).

Suspected loss of payment card data is routed separately to Stripe — Stripe holds the PCI scope.

## SLA

Most US state breach-notification laws require notice to affected individuals within **30 to 72 days** of discovery. Some require notice to the state Attorney General as well. The fastest clock we plan around is 30 days; assume it for any incident involving more than 500 affected users.

## When something happens — first 60 minutes

1. **Stop the bleeding.** If the cause is active (e.g. exposed admin token, exploitable endpoint, leaked URL), revoke the credential or take the affected component offline. Don't try to investigate before stopping the leak — write a one-line note about what you cut and move on.
2. **Preserve evidence.** Take Supabase logs (`mcp__claude_ai_Supabase__get_logs` for the relevant service), Vercel deployment logs, and any HTTP access logs from around the incident window. Save them locally in a folder named `incident-YYYY-MM-DD/`.
3. **Note the time of discovery.** This starts the notification clock. Write it down somewhere durable. If you only have an estimate, use the earliest plausible time.

## First 24 hours

1. **Scope the damage.**
   - Which table or bucket was exposed?
   - How many user IDs / emails are affected?
   - What fields were readable (just the user ID, or name + email + phone + payment metadata)?
   - When did the exposure begin? Cross-reference with Supabase logs to estimate how many requests touched the affected data.
2. **Pull a list of affected users.** Query the relevant tables and export the `id` + `email` of every user whose data was potentially exposed. Save as `incident-YYYY-MM-DD/affected-users.csv`.
3. **Decide whether it qualifies as a reportable breach** under the laws that apply. Rule of thumb for the US states we serve:
   - Name + email alone — generally not reportable.
   - Name + (SSN | driver's license | financial account number | health info) — reportable, almost always.
   - Account credentials (passwords, password reset tokens) — reportable in most states.
   - Stripe customer IDs / payment intent IDs without the underlying card — not reportable on their own.
   If unsure, treat it as reportable.

## Notifying users

Within the SLA, email every affected user from `hello@grassroots.work`. Use this template — fill in the bracketed bits, don't add hedging language:

> Subject: important notice about your grassroots account
>
> hi,
>
> on [date], we discovered that [short description of what happened — be specific]. as a result, [the following information about your account may have been exposed: list fields].
>
> we [list the steps taken — closed the exposure, rotated keys, audited logs, etc.] within [timeframe] of discovery. we have no evidence that anyone outside grassroots accessed this data, but we wanted you to know in case you want to take additional precautions, such as [specific advice — change password / monitor cards / etc.].
>
> we are sorry. if you have questions, reply to this email. you can also reach us at hello@grassroots.work.
>
> — [your name], grassroots

## Notifying regulators

Most states require notification to the state Attorney General if the breach affects more than a certain number of residents (500 is a common threshold; California requires AG notification at 500+ residents). The major AG portals:

- **California:** oag.ca.gov/privacy/databreach/reporting
- **New York:** ag.ny.gov/internet/data-breach
- **Texas:** texasattorneygeneral.gov/divisions/consumer-protection/databreach

Use the state-provided form. Keep a record of what you submitted.

If payment data was involved, **also notify Stripe** through your Stripe dashboard's support channel — they need to know to monitor for fraud on affected accounts.

## Post-incident

1. **Write an incident report.** One markdown file in `incident-YYYY-MM-DD/incident-report.md`:
   - Timeline (discovery, containment, investigation, notification).
   - Root cause.
   - Scope of impact.
   - What we changed to prevent recurrence.
2. **File the report** under `docs/incidents/` once the incident is closed.
3. **Update prevention controls.** If the root cause was an RLS policy gap, run `npm run verify:rls` and fix the offending policy. If it was a leaked credential, audit how credentials are rotated.

## Contacts (fill in before launch)

| Role | Person | Contact |
|---|---|---|
| Incident commander | [name] | [email/phone] |
| Legal counsel | [firm name] | [email/phone] |
| Cyber insurance | [insurer] | [policy #, claim line] |
| Stripe risk contact | (use dashboard) | dashboard.stripe.com/support |
| Supabase support | (use dashboard) | supabase.com/dashboard/support |

## Drills

Run a tabletop exercise once before launch and once a year afterward. Pick a plausible scenario (an exposed admin token; a leaked database export; a compromised contractor laptop) and walk through this runbook end-to-end without making real changes. Note any gaps and patch them.
