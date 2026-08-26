# Razorpay Edge Functions

Deploy both functions from the Supabase project root:

```bash
supabase functions deploy create-razorpay-order
supabase functions deploy verify-razorpay-payment
```

Set these secrets in Supabase Dashboard → Edge Functions → Secrets (or with `supabase secrets set`):

```text
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never expose `RAZORPAY_KEY_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` in Vite/React files.

`create-razorpay-order` permits only the agreement borrower to create an order for a scheduled/overdue payment. `verify-razorpay-payment` verifies the checkout HMAC signature before marking the payment paid.

## AI Resolution Advisor

Deploy `ai-resolution-advisor` and set these additional Edge Function secrets:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6
```

The function sends only the selected agreement’s repayment ledger context to the OpenAI Responses API, uses `store: false`, and returns a constrained, non-binding recommendation. It does not make financial decisions.

## AI Loan Advisor

Deploy `ai-loan-advisor`. It uses the same `OPENAI_API_KEY` and `OPENAI_MODEL` secrets as the resolution advisor. It permits only the agreement lender to request a review and uses only agreement data plus the borrower snapshot explicitly shared for that agreement.

## AI Repayment Planner

Deploy `ai-repayment-planner`. It uses the same OpenAI secrets and can access only the signed-in user’s private `financial_contexts` row. It suggests a non-binding repayment structure before the user makes a loan request.

## AI Guarantor Advisor

Deploy `ai-guarantor-advisor`. It uses the same OpenAI secrets, is callable only by the agreement’s guarantor, and returns a non-binding exposure explanation based on the guarantor’s private context plus the borrower’s explicitly shared summary.

## Razorpay webhook

Deploy `razorpay-webhook` and **turn off JWT verification for this function only** in Supabase, because Razorpay sends server-to-server POSTs rather than a user session token. Add this secret:

```text
RAZORPAY_WEBHOOK_SECRET=a-long-random-secret-at-least-32-characters
```

In Razorpay Dashboard → Webhooks (Test Mode while testing), set the URL to:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/razorpay-webhook
```

Subscribe to `payment.captured` and `payment.failed`. The function verifies `X-Razorpay-Signature` against the unmodified/raw request body and ignores duplicate event IDs.

## After editing a function

Redeploy the edited function in Supabase Dashboard. The functions include CORS support for Supabase browser-client headers: `authorization`, `apikey`, `content-type`, and `x-client-info`.
