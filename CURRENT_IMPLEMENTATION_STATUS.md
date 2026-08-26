# Bondly — Current Implementation Status (24 August 2026)

Use this document with `PROJECT_HANDOFF.md` when continuing the project with another AI or developer. It corrects older roadmap statements in the original handoff.

## Reminder and repayment behavior

| Behavior | Status | Notes |
|---|---|---|
| Reminder 3 days before due date | Implemented in backend | `queue_due_payment_reminders()` inserts `upcoming_payment` notifications. Supabase Cron still needs configuration. |
| Reminder on due date | Implemented in backend | Inserts `payment_due` notification. |
| Reminder after due date | Implemented in backend | Daily queue transitions missed schedules and active agreements to `overdue`, then notifies all agreement participants. |
| In-app inbox | Implemented | Bell icon lists notifications and marks a selected record as read. |
| WhatsApp/SMS | Not implemented | No provider, consent record, templates, retries, or delivery analytics exist. |
| Razorpay repayment | Implemented | Checkout → signature verification → ledger update. Webhook gives independent captured-payment confirmation. |

## Agreement changes

| Behavior | Status | Notes |
|---|---|---|
| Ask for extension | Implemented | Resolution Room proposes extension, then all participants vote. |
| Apply extension | Implemented | Unanimous acceptance moves the next unpaid payment date. |
| Two-part repayment plan | Implemented with guardrail | Only applies when exactly one unpaid payment remains. |
| Change/introduce interest rate during re-agreement | Implemented | A proposal may set a new yearly interest rate; it takes effect only after unanimous approval. |
| Full re-agreement / revised terms version | Implemented | Participants can propose a new due date, interest rate, and/or next-payment amount. Prior terms are retained in `terms_snapshot`; accepted terms increment `agreements.version`. |
| Guarantor fallback payment | Not implemented | Guarantor approval/exposure/review exists, but no automatic collection or transfer should occur. |

## Financial Intelligence Layer

1. `financial_contexts` holds voluntary liquidity, income, EMI, obligations, emergency reserve, and essential reserve. It is owner-only through RLS.
2. `financial_context_shares` stores an agreement-specific selected snapshot, not raw data. Active agreement participants can read that snapshot.
3. Financial Health calculates discretionary buffer:

```text
liquid funds − emergency reserve − essential reserve − EMI − upcoming obligations
```

4. Free local guidance is advisory only and uses live, consented app data. It provides repayment-plan, lender-term, guarantor-exposure, and missed-payment resolution suggestions without calling an external AI API.

## Migrations to have run

Run `schema.sql` only on an empty project, then:

```text
002_payment_ledger.sql
003_resolution_room.sql
004_resolution_votes.sql
005_reminder_queue.sql
006_notification_events.sql
007_apply_accepted_resolutions.sql
008_razorpay_orders.sql
009_profile_backfill.sql
010_authenticated_table_privileges.sql
011_edge_function_privileges.sql
012_razorpay_webhook_events.sql
013_financial_context.sql
014_reagreements_and_overdue_lifecycle.sql
015_opt_in_reputation_profiles.sql
016_reputation_decision_lens.sql
```

## Edge Functions to deploy

```text
create-razorpay-order
verify-razorpay-payment
razorpay-webhook              # Disable JWT verification only here
recovery-agent
reputation-agent
decision-agent
```

## Required Edge Function secrets

```text
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
GROQ_API_KEY
```

## Recommended next implementation

## Opt-in AI Reputation Profiles

1. Migration `015_opt_in_reputation_profiles.sql` adds `reputation_profiles`, an aggregate-only, member-searchable table. It is private until its owner explicitly publishes it.
2. `reputation-agent` is the only writer. It calculates role badges and payment/agreement counts from recorded Bondly data, then asks Groq for a neutral summary, decision considerations, and a question the parties should discuss.
3. The browser has read-only access to this table, so users cannot forge their payment history or AI summary.
4. It never publishes bank balance, income, phone number, financial-health input, agreement amounts, private notes, disputes, or a credit/risk/trustworthiness score.
5. It is not identity verification, a credit score, or a guarantee of future behaviour. Users can remove the profile from member search at any time.

## Recommended next implementation

Run migration 015, deploy `reputation-agent`, then test profile generation, publishing, search, and removal with two real test accounts. Keep recovery as the primary Buildathon demo: the profile supports better human decisions but must never automatically approve or reject a loan.
