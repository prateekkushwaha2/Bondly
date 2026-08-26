# Bondly — Complete Project Handoff

**Last updated:** 24 August 2026  
**Stack:** React 18, Vite 5, Supabase Auth + Postgres + Row Level Security  
**Local workspace:** `C:\Users\rajpr\Downloads\Buildthon`

This document is the source of truth for continuing development. It describes the original problem, product rules, implemented work, database behavior, setup steps, and the recommended roadmap.

> **Current implementation addendum:** Apply migrations through `014_reagreements_and_overdue_lifecycle.sql`. It adds automatic scheduled-to-overdue transitions in the daily reminder queue and a versioned re-agreement workflow. A participant can propose a revised due date, yearly interest rate, and/or next-payment amount; all lender, borrower, and optional guarantor votes are required before the agreement changes. See `CURRENT_IMPLEMENTATION_STATUS.md` for the up-to-date feature matrix and operational checklist.

---

## 1. Product: what Bondly is

Bondly makes informal lending between friends, family, and colleagues safer and less awkward. It replaces scattered WhatsApp messages and verbal promises with a shared record of the loan, repayment terms, approvals, reminders, and fair resolution options.

The important product principle is: **AI can explain, assess, and propose; people must approve every financial commitment.**

### The problem being solved

People frequently lend informally, but usually have no structured way to:

- create a clear written agreement;
- record who agreed to what;
- track repayments or installments;
- send respectful reminders before a due date;
- request and agree to an extension;
- include a guarantor; or
- resolve a missed payment without harming a relationship.

### Core value proposition

> Clear promises, kind reminders, and fair resolutions—so money does not get in the way of relationships.

---

## 2. People, roles, and permissions

There are three **per-agreement** roles:

| Role | What they do |
|---|---|
| Lender | Creates/funds the agreement and sets its proposed terms. |
| Borrower | Requests or accepts money, repays, and can request a change or extension. |
| Guarantor | Optional. Accepts responsibility if the borrower does not pay. |

### Critical role rule

**Accounts are role-fluid.** A user is never permanently “only a borrower” or “only a lender.” The same person may:

- lend money in agreement A;
- borrow money in agreement B; and
- guarantee agreement C.

The `profiles.primary_role` column only records an onboarding preference (“How will you begin?”). It does **not** control authorization. Actual permissions come from the participant IDs stored on each `agreements` record.

---

## 3. Primary product workflows

### A. Lender-created agreement

1. Lender creates terms: borrower, optional guarantor, amount, purpose, due date, interest, repayment type.
2. Bondly creates an agreement in `pending_approval` status.
3. Bondly creates an approval record for every required participant.
4. The lender is approved immediately because they initiated the agreement.
5. Borrower and optional guarantor receive/see pending approval.
6. Each participant accepts or declines. A PIN confirmation prompt exists in the demo UI; it is **not yet a secure server-verified PIN system**.
7. The database trigger changes the agreement to `active` only when all required participants approved.
8. A decline cancels the agreement.
9. Actual Razorpay money transfer is **not yet implemented**. Current transfer language in the UI is a demo simulation.

### B. Repayment

1. A payment schedule entry is created with the agreement.
2. It appears under **Activity** (currently used as the repayment centre).
3. Lender or borrower can mark a scheduled payment as paid.
4. A database trigger reduces the agreement’s `outstanding_amount`.
5. If the balance reaches zero, the agreement becomes `completed`.
6. Current “Mark as paid” is a ledger action, not a verified payment gateway callback. Razorpay webhook verification must replace it for production.

### C. Missed payment / AI Resolution Room

1. A user opens **Resolve with AI** from the dashboard.
2. The UI shows an AI-style recommendation using a mocked repayment-history explanation.
3. The user chooses one of:
   - gentle reminder;
   - 5-day extension; or
   - two-part payment plan.
4. When Supabase is configured and there is a real agreement, Bondly saves `resolution_cases` and creates a vote for every participant.
5. The person opening the case is pre-recorded as approving the proposal.
6. Other participant(s) see a **Resolution Inbox** card in Agreements.
7. If all votes approve, the case becomes `accepted`; if anyone declines, it becomes `declined`.
8. Migration `007_apply_accepted_resolutions.sql` applies unanimously accepted proposals to the payment ledger: an extension moves the next unpaid due date; a two-part plan splits the next unpaid payment into two weekly installments.

### D. Reminders

1. The database has a `notifications` table and `queue_due_payment_reminders()` function.
2. The function creates an in-app notification for scheduled/overdue borrower payments due within three days.
3. It prevents duplicate same-day reminders per recipient/payment/type.
4. Supabase Cron should call it daily.
5. Notification inbox UI and WhatsApp/SMS dispatch are not implemented yet.

---

## 4. Application architecture

```text
React / Vite UI
  ├─ Auth screen: Supabase Auth email/password
  ├─ Dashboard: agreement and lending-health views
  ├─ Agreements inbox: agreement approvals + resolution votes
  ├─ Repayment centre: scheduled payment ledger
  └─ Resolution Room: AI recommendation UI + proposal creation
           │
           ▼
Supabase JavaScript client
  ├─ Authentication session
  ├─ Postgres data reads/writes
  └─ Row Level Security protects participant data
           │
           ▼
Supabase Postgres
  ├─ profiles / agreements / approvals
  ├─ payment_schedule / notifications
  ├─ resolution_cases / resolution_case_votes
  ├─ activity_events
  └─ triggers to activate agreements and calculate balances
```

### Front-end files

| File | Purpose |
|---|---|
| `index.html` | Vite entry HTML, font setup, `#root`. |
| `src/main.jsx` | React root, CSS imports, error boundary. |
| `src/App.jsx` | Nearly all UI components and client-side state. |
| `src/lib/supabase.js` | Initializes Supabase only when environment keys are present. |
| `src/lib/agreements.js` | Data-access functions for profiles, agreements, approvals, payments, and cases. |
| `src/styles.css` | Main dashboard CSS. |
| `src/auth.css` | Authentication screen CSS. |
| `src/inbox.css` | Agreement/resolution inbox CSS. |
| `src/payments.css` | Payment centre CSS. |

### Important UI behavior

- If `.env.local` does not contain valid Supabase values, the app remains usable in **demo mode**. Sign-in succeeds locally with React state only.
- When Supabase is configured, it loads the real user session and dashboard data.
- An error boundary in `src/main.jsx` displays a usable error rather than a blank white page if React crashes.
- Browser extension warnings such as `contentscript.js MaxListenersExceededWarning` are external browser-extension warnings, not Bondly application errors.

---

## 5. Database architecture

### Core tables

| Table | Purpose |
|---|---|
| `profiles` | One profile per `auth.users` user. Holds name, onboarding preference, phone, reserve preference. |
| `agreements` | Loan record with lender, borrower, optional guarantor, amount, terms, state, and outstanding balance. |
| `approvals` | Required approvals for an agreement/version. |
| `payment_schedule` | Scheduled repayments/installments. |
| `resolution_cases` | Persisted AI resolution proposal and structured proposed terms. |
| `resolution_case_votes` | One approval/decline vote per participant for a resolution case. |
| `activity_events` | Audit log for key agreement actions. |
| `notifications` | Queued in-app/email/WhatsApp reminder records. |

### Agreement state machine

```text
draft → pending_approval → active → completed
                  │
                  └────────────→ cancelled

active → overdue  (status is supported in schema; automated overdue marking still needs implementation)
```

### Resolution state machine

```text
open → proposed → accepted
              └→ declined
```

### Security (RLS)

Row Level Security is enabled on every business table. The intended access model:

- Only the profile owner can read/update their profile.
- Only lender, borrower, and guarantor participants can read an agreement and related data.
- Lender can create an agreement and its initial approval/payment records.
- An approver can update only their own agreement approval.
- Borrower/lender can update a scheduled payment.
- Resolution participants can read cases; only the opener creates the required vote list; every voter can update only their own vote.
- Notification recipient can read/mark their own notification.

### Database triggers/functions

| Database object | Behavior |
|---|---|
| `handle_new_user()` | On Supabase Auth signup, creates a `profiles` row from user metadata. |
| `sync_agreement_approval_status()` | Activates when all required approvals are approved; cancels when any approval is declined. |
| `sync_outstanding_balance()` | On a payment changing to `paid`, subtracts its amount and completes agreement if balance becomes zero. |
| `sync_resolution_status()` | Accepts case only when all votes approve; declines if any vote declines. |
| `queue_due_payment_reminders()` | Creates reminder records for payments due soon, due today, or overdue. |

---

## 6. Supabase setup and migration order

### Environment configuration

Create `.env.local` in the project root. Never commit it.

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

`.env.example` has the same keys with placeholders.

### Fresh database setup

For an empty/new Supabase database:

1. In Supabase, open **SQL Editor** → **New query**.
2. Run `supabase/schema.sql` once only.
3. Then run each migration in order:
   1. `supabase/migrations/002_payment_ledger.sql`
   2. `supabase/migrations/003_resolution_room.sql`
   3. `supabase/migrations/004_resolution_votes.sql`
   4. `supabase/migrations/005_reminder_queue.sql`
   5. `supabase/migrations/006_notification_events.sql`
   6. `supabase/migrations/007_apply_accepted_resolutions.sql`
   7. `supabase/migrations/008_razorpay_orders.sql`
   8. `supabase/migrations/009_profile_backfill.sql`
   9. `supabase/migrations/010_authenticated_table_privileges.sql`
   10. `supabase/migrations/011_edge_function_privileges.sql`

### Existing database rule

Never rerun the complete `schema.sql` after it has succeeded. It creates enums/tables and will fail with errors such as:

```text
ERROR: type "bondly_role" already exists
```

Run only the new incremental file in `supabase/migrations/`.

### Testing reminder queue

After running migration 005, test it in Supabase SQL Editor:

```sql
select public.queue_due_payment_reminders();
```

For daily operation, enable Supabase Cron / `pg_cron` and schedule the function. The suggested SQL is in comments at the bottom of `005_reminder_queue.sql`.

### Supabase Auth settings

In Supabase Dashboard:

- Enable Email/Password provider.
- During testing, consider disabling email confirmation or confirm test emails before logging in.
- Do not place the Supabase `service_role` key in the front-end environment file. The browser gets only the anon/publishable key.

---

## 7. Local development commands

Install packages:

```bash
npm install
```

Run development server (the team has used port 5172):

```bash
npm run dev -- --host 127.0.0.1 --port 5172
```

Open:

```text
http://127.0.0.1:5172/
```

Production build verification:

```bash
npm run build
```

The build passed after the latest implementation changes.

---

## 8. What is real versus demo-only today

### Real Supabase-backed behavior (when `.env.local` is configured)

- Email/password signup and sign-in
- User profile creation via trigger
- Agreement creation
- Approval records and agreement activation/cancellation trigger
- Real participant agreement dashboard reads
- Payment schedule reads and mark-paid ledger update
- Outstanding balance/completion trigger
- Persistent resolution-case creation
- Multi-party resolution votes/status trigger
- Reminder notification queue function
- Role-aware empty states: real accounts do not receive demo agreement data

### Demo/mocked behavior to replace before production

- Loan transfer is displayed as a successful action but does not move money.
- “Mark as paid” is not a payment-gateway-confirmed action.
- PIN is a browser prompt and is not hashed, stored, or server verified.
- AI recommendation messages are hard-coded examples; no LLM API is called.
- Lending-health score and repayment probability are mock figures.
- The new agreement form asks for borrower/guarantor account UUID when using real Supabase; this is temporary and not user-friendly.
- WhatsApp/SMS/email sending is not connected.
- Notifications are queued but not yet shown in a UI.
- An accepted extension/payment-plan proposal does not yet update `payment_schedule` or agreement terms.

---

## 9. Recommended next implementation order

This sequence prioritizes a compelling Razorpay Buildthon demo while preserving data correctness.

### Priority 1 — In-app notifications and invitation UX

1. Add a notification drawer/inbox to the bell icon.
2. Fetch `notifications` for signed-in user and allow marking as read.
3. When an agreement is created, create `agreement_invite` notification records for borrower/guarantor.
4. Replace raw user UUID entry with email/phone invitations.
   - Best route: create an `agreement_invitations` table with recipient email/phone and a secure acceptance token.
   - On account creation/sign-in, match outstanding invitations to the user.
   - Do not expose the entire profiles table or allow public arbitrary user lookup.

### Priority 2 — Make resolution proposals take effect

1. On unanimous `resolution_case_votes` acceptance, inspect `proposed_terms.option`.
2. For `extension`, update the relevant `payment_schedule.due_date` and agreement version/terms snapshot.
3. For `installment_plan`, replace/create payment schedule rows safely.
4. Create new agreement approval records when a material term changes, if required by product policy.
5. Add audit events and notifications for resulting changes.

### Priority 3 — Razorpay payments

1. Use a **Supabase Edge Function** or another server-side endpoint to create Razorpay orders. Keep Razorpay secret keys off the client.
2. Launch Razorpay Checkout from the React app with an order ID.
3. Verify payment signature server-side.
4. Receive/verify Razorpay webhooks.
5. `razorpay-webhook` now independently marks `payment_schedule.status = 'paid'` on a verified `payment.captured` webhook. Browser verification remains for immediate feedback.
6. Store Razorpay payment/order IDs as references.

**Implemented scaffold:** Migration `008_razorpay_orders.sql`, Edge Functions `create-razorpay-order` and `verify-razorpay-payment`, plus the browser Checkout integration in `src/lib/razorpay.js`. Deploy the Edge Functions and set their Razorpay test secrets before testing. Webhook verification remains the recommended final reliability layer.

### Priority 4 — Reminder delivery

1. Keep `queue_due_payment_reminders()` for creating durable notification intents.
2. Build an Edge Function triggered by Cron or a webhook to deliver email/WhatsApp.
3. Use a provider such as Twilio/Meta WhatsApp Business API after user consent.
4. Track `channel`, delivery state, provider ID, failures, and retries.
5. Do not send financial details through WhatsApp without reviewing consent/privacy requirements.

### Priority 5 — Real AI layer

Use a server-side LLM integration; never put API keys in React.

Useful AI functions:

- Convert plain-language terms into a clear agreement draft.
- Suggest repayment schedule/due date based on stated needs.
- Explain repayment risk using *only consented, in-product agreement history*.
- Recommend gentle reminder tone and extension duration.
- Summarize both participants’ private context into a neutral proposal.
- Translate legal/financial text into simple English/Hinglish.

AI safety/product rules:

- AI must not automatically lend, charge interest, transfer money, or bind an agreement.
- Display why a recommendation was made and what data it used.
- Require every impacted participant to approve a material change.
- Do not present behavioral/risk score as a credit score or legal decision.

### Priority 6 — Reliability and legal readiness

- Add validation for dates, amounts, interest caps, and installment totals.
- Add a proper secure transaction-confirmation system (PIN/OTP/passkey), with hashed data/verification server-side.
- Add immutable agreement terms/version documents, signing timestamps, and downloadable PDF.
- Add tests for RLS policies and database triggers.
- Assess Indian lending, interest, KYC, privacy, and payment-regulation requirements before calling it a regulated lending product. Position initial version as peer agreement/repayment coordination until legally reviewed.

---

## 10. Key technical caveats for the next developer/model

1. `src/App.jsx` is intentionally a single file for fast hackathon iteration. Split it into pages/components/hooks before production-scale work.
2. Do not use a service-role key in a Vite `VITE_*` environment variable. It will be publicly exposed.
3. RLS policies are the main data isolation layer. Every new table needs RLS enabled and policies defined before being used in the client.
4. Database changes must be new migration files; do not edit/re-run initial schema in an existing project.
5. Current `createAgreement()` is multi-step client-side inserts. A production build should replace it with an atomic Postgres RPC/transaction to avoid partly-created agreements if a later insert fails.
6. Current payment marking is intentionally a prototype. It must be protected by verified server-side Razorpay webhook logic in production.
7. Relationship-selection syntax in Supabase queries depends on the foreign key names created by the provided schema. Keep those constraints/names intact or update `src/lib/agreements.js` queries.
8. The development server previously displayed a blank page because JSX required `React` in scope. `src/main.jsx` and `src/App.jsx` now import `React` explicitly; do not remove those default imports unless JSX transform config is changed deliberately.

---

## 11. Current file map

```text
Buildthon/
├─ .env.example
├─ .env.local                    # local only; contains Supabase values; do not commit
├─ package.json
├─ package-lock.json
├─ index.html
├─ PROJECT_STATUS.md             # compact current checklist
├─ PROJECT_HANDOFF.md            # this complete continuation document
├─ src/
│  ├─ main.jsx
│  ├─ App.jsx
│  ├─ styles.css
│  ├─ auth.css
│  ├─ inbox.css
│  ├─ payments.css
│  └─ lib/
│     ├─ supabase.js
│     └─ agreements.js
└─ supabase/
   ├─ schema.sql
   └─ migrations/
      ├─ 002_payment_ledger.sql
      ├─ 003_resolution_room.sql
      ├─ 004_resolution_votes.sql
      └─ 005_reminder_queue.sql
```

---

## 12. Suggested demo narrative for Buildthon

1. Rahul needs ₹15,000 for laptop repair and sends a request.
2. Prateek sees the request, a repayment-history insight, and approves a clear agreement.
3. Rahul accepts it; a guarantor can be added for higher-stakes loans.
4. Bondly keeps the agreement and repayment plan visible to everyone.
5. Before a due date, Bondly sends a respectful reminder.
6. If payment is difficult, the AI Resolution Room proposes a fair extension or installment plan.
7. Rahul, Prateek, and the guarantor all approve the change; no one is surprised and the relationship is protected.

The strongest pitch is not “AI scores people.” It is: **Bondly gives people a fair, transparent process for lending to people they already trust.**
