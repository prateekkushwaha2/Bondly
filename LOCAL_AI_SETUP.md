# Hosted Recovery AI Agent

Bondly uses a secure Supabase Edge Function and Groq's free tier for recovery recommendations. The browser never receives the Groq key.

## Setup

1. Create a free Groq account and create an API key.
2. Save the key as the Supabase `GROQ_API_KEY` secret.
3. Deploy the function from the project root:

```powershell
supabase functions deploy recovery-agent
supabase functions deploy reputation-agent
```

4. Start Bondly with `npm run dev`, or deploy the frontend to Vercel.
5. Create a real overdue agreement, open **Recovery**, then choose **Analyse repayment facts**.
6. For an opt-in member profile, open **Trust insights** and choose **Generate my AI profile**. Review it before publishing it to member search.

The model receives only the selected agreement’s amount, due date, interest rate, and payment-status counts. It can choose only a reminder, short extension, two-part plan, or stop-and-review. It cannot pay, alter terms, or contact people.

## Evaluation evidence

Run this locally after setting a temporary environment variable. Do not commit the key:

```powershell
$env:GROQ_API_KEY='your_key_here'
npm run eval:recovery
```

It evaluates 60 isolated synthetic records and prints exact action accuracy, intervention precision/recall, false-positive intervention exposure, missed recovery value, simulated recovered value, and an exception list. It also saves a shareable report to `evaluation/results/latest-recovery-report.json`. These records are evaluation-only and are not inserted into Supabase or rendered in the product.
