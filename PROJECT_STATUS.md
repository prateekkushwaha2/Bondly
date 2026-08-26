# Bondly — Build Status

**Updated:** 25 August 2026

## Completed

- React + Vite application with Supabase Auth
- Role-fluid accounts and lender / borrower / guarantor dashboard views
- Agreements, participant approvals, optional guarantors, payment schedules, activity audit
- Razorpay Checkout order creation, server-side signature verification, and webhook receiver
- Payment ledger: mark paid, outstanding-balance reduction, automatic completion
- AI Resolution Room: reminders, 5-day extension, 2-part payment plan, unanimous participant votes
- Accepted extension moves the next unpaid due date; accepted two-part plan splits one unpaid payment
- In-app notifications: agreement invites and queued repayment reminders
- Financial Health: voluntary liquidity, reserves, EMI, obligations, protected-fund calculation
- Agreement-specific consent snapshots: raw financial context remains private
- Hosted Groq Recovery Agent: analyzes live overdue-agreement facts, chooses one bounded resolution action, drafts a respectful message, logs the recommendation, and requires human approval before any change
- Opt-in AI Reputation Profiles: factual role/payment history, explainable decision lens, member search, and a public member invite ID; never a credit score
- Recovery queue backed by actual overdue agreements; no synthetic borrowers, scores, or recovery estimates

## Implemented but requiring dashboard/operational setup

- Daily Supabase Cron must call `queue_due_payment_reminders()`.
- Razorpay webhook requires Test Mode setup, `RAZORPAY_WEBHOOK_SECRET`, and JWT disabled only for `razorpay-webhook`.
- Razorpay Edge Functions must be deployed with the required Razorpay secrets. The app’s guidance features do not require OpenAI billing or an OpenAI API key.

## Important feature truth

- Before-due, on-due, and after-due reminders: backend notification queue implemented.
- WhatsApp/SMS delivery: not implemented.
- Extension request and unanimous acceptance: implemented.
- Re-agreement with changed due date, next-payment amount, and/or interest rate: implemented as a versioned unanimous-approval workflow (migration 014).
- Automatic guarantor collection/payment: not implemented; guarantor exposure, approvals, and alerts are implemented.
- Automatic scheduled → overdue state conversion: implemented in the daily reminder queue (migration 014).
- Recovery AI runs securely in the deployed Supabase Edge Function using the `GROQ_API_KEY` secret. Its separate 60-record evaluation is run with `npm run eval:recovery`, never seeds customer data, and saves a shareable evidence report.

## Next priority

Run the 60-case recovery evaluation, retain its JSON report as submission evidence, and test one real lender/borrower/guarantor agreement end-to-end.
