# Bondly — explainable AI for safer informal lending

**Razorpay AI Buildathon · AI Revenue Recovery**

Bondly helps people lend, borrow, and guarantee loans with a shared agreement, verified repayments, respectful recovery workflows, and an opt-in reputation record built from actual Bondly activity.

Its central idea is simple: informal lending should not depend only on personal claims or awkward follow-ups. People need an understandable record of past activity and a safe process when repayment becomes difficult.

## The problem

Informal lending is common, but the workflow is fragmented:

- loan terms live in conversations instead of a shared record;
- lenders have no consistent way to follow up on missed payments;
- borrowers may need an extension but hesitate to ask;
- guarantors cannot clearly see the commitment they are accepting; and
- a person can claim to be reliable without any verifiable, consented history.

The outcome is delayed recovery, poor decisions, and damaged relationships.

## The two AI loops

### 1. AI Reputation Profile — better decisions before an agreement

Bondly creates an **opt-in, factual Reputation Profile** that other signed-in Bondly members can search before they decide to lend, borrow from, or guarantee someone.

The profile contains only server-derived Bondly activity:

- date joined;
- roles actually recorded: lender, borrower, and/or guarantor;
- total and completed agreements;
- recorded payments and on-time payment count;
- currently overdue payment count;
- role-specific agreement breakdown;
- a Bondly Member Invite ID for creating an agreement.

Groq AI converts these facts into a neutral **AI Decision Lens**: a concise factual summary, two considerations, and a practical question the parties should discuss before committing.

#### Why this profile can be trusted

The member cannot type, edit, or forge the profile facts or AI summary. The browser has **read-only** access to `reputation_profiles`; the secure `reputation-agent` Edge Function calculates the record directly from agreements and payment schedules, then writes it using a server-only key.

The owner controls only visibility:

- generate and review their profile privately;
- publish it to member search explicitly;
- remove it from search at any time.

It is deliberately **not** a credit score, identity check, “trustworthy/untrustworthy” label, loan recommendation, or guarantee of future behaviour. Bank balances, income, phone numbers, agreement amounts, private notes, disputes, and financial-health inputs are excluded.

### 2. AI Recovery Agent — recover revenue after a missed payment

When a recorded payment becomes overdue, Bondly places the agreement in the AI Recovery queue. The Recovery Agent reads only the selected agreement's live facts:

- outstanding amount;
- due date and days past due;
- overdue-payment count;
- paid-payment count;
- interest rate and agreement context.

It selects one bounded next step:

1. Gentle reminder
2. Short extension proposal
3. Two-part repayment-plan proposal
4. Stop and request manual review

It also shows the evidence used and drafts respectful, situation-specific language. This replaces the manual work of inspecting each overdue agreement, choosing an appropriate intervention, and writing a sensitive follow-up.

### AI guardrails

- AI cannot move money, change terms, contact members, or approve a proposal.
- Every extension, installment plan, and re-agreement requires lender, borrower, and optional guarantor approval.
- Recommendations are recorded in the agreement activity trail.
- The Groq API key stays in Supabase Edge Function Secrets; it is never sent to the browser.
- Recovery guidance is available only for actual overdue agreements.

## Product workflow

```text
Opt-in member profile → search factual history → create agreement
                                      ↓
                      lender + borrower + guarantor approve
                                      ↓
                          repayment through Razorpay
                                      ↓
                         overdue payment detected
                                      ↓
                    AI suggests a bounded recovery action
                                      ↓
                   participants approve or decline proposal
                                      ↓
                  accepted terms update schedule + audit trail
```

## Core features

| Feature | What it does |
|---|---|
| Role-specific workspaces | Lenders create agreements and use recovery; borrowers make repayments and manage private financial context; guarantors review exposure and votes. |
| Shared agreements | Captures amount, due date, interest, purpose, participants, approvals, and payment schedule. |
| Razorpay repayments | Creates checkout orders, verifies signatures server-side, and records verified payments. |
| Reminder lifecycle | Supports upcoming, due-today, and overdue in-app notification records. |
| Re-agreement | Participants can propose a revised due date, interest rate, or payment amount; unanimous approval is required. |
| Activity audit | Records agreement, recovery, and re-agreement events. |
| Private financial context | Optional data is owner-only and can be shared only as an agreement-specific consented snapshot. |

## Evaluation evidence

The recovery agent was evaluated on 60 isolated, synthetic, reviewer-labelled scenarios. The dataset is never inserted into Supabase or shown to customers.

Latest report: [evaluation/results/latest-recovery-report.json](evaluation/results/latest-recovery-report.json)

| Measure | Latest result |
|---|---:|
| Exact action accuracy | 100% (60/60) |
| Intervention precision | 100% |
| Intervention recall | 100% |
| False-positive intervention exposure | ₹0 |
| Missed recovery value | ₹0 |
| Eligible simulated recovery value | ₹477,000 |

These are simulated results against a deterministic labelled test set—not field recovery claims.

Run it locally with a temporary Groq key:

```powershell
$env:GROQ_API_KEY='your_groq_key'
npm run eval:recovery
```

## Architecture

```text
React + Vite
  └─ Supabase Auth + role-specific UI
       ├─ agreements, approvals, payments, notifications
       ├─ Recovery Agent → Groq via secure Edge Function
       └─ Reputation Agent → Groq via secure Edge Function

Supabase Postgres + RLS
  ├─ agreements / payment_schedule / activity_events
  ├─ resolution and re-agreement voting
  ├─ opt-in reputation_profiles (browser read-only)
  └─ Razorpay order and webhook records
```

## Run locally

1. Create `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

2. Apply `supabase/schema.sql` to an empty project, then migrations `002` through `016` in order.
3. Add `GROQ_API_KEY` to Supabase Edge Function Secrets.
4. Deploy the AI functions:

```powershell
npx supabase functions deploy recovery-agent --use-api
npx supabase functions deploy reputation-agent --use-api
```

5. Start the app:

```powershell
npm install
npm run dev
```

For deployment status and operational details, see [CURRENT_IMPLEMENTATION_STATUS.md](CURRENT_IMPLEMENTATION_STATUS.md).
