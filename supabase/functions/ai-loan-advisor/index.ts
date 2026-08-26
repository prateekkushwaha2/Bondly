import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Missing authorization.' }, 401)
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: userError } = await client.auth.getUser()
    if (userError || !user) return json({ error: 'Invalid session.' }, 401)
    const { agreementId } = await request.json()
    if (!agreementId) return json({ error: 'agreementId is required.' }, 400)
    const { data: agreement, error: agreementError } = await client.from('agreements')
      .select('id, lender_id, borrower_id, amount, outstanding_amount, interest_rate, due_date, purpose, repayment_type, status, payment_schedule(amount, due_date, status, paid_at)')
      .eq('id', agreementId).single()
    if (agreementError || !agreement) return json({ error: 'Agreement not found or unavailable.' }, 404)
    if (agreement.lender_id !== user.id) return json({ error: 'Only the lender can request a loan review.' }, 403)
    const { data: shares } = await client.from('financial_context_shares')
      .select('shared_snapshot, includes_repayment_history, owner_id')
      .eq('agreement_id', agreementId).is('revoked_at', null)
    const borrowerShare = (shares || []).find((share) => share.owner_id === agreement.borrower_id)
    const payments = agreement.payment_schedule || []
    const context = {
      proposedTerms: { amount: agreement.amount, interestRate: agreement.interest_rate, dueDate: agreement.due_date, purpose: agreement.purpose, repaymentType: agreement.repayment_type },
      bondlyHistory: { scheduledPayments: payments.length, paidPayments: payments.filter((payment) => payment.status === 'paid').length, overduePayments: payments.filter((payment) => payment.status === 'overdue').length },
      borrowerSharedContext: borrowerShare?.shared_snapshot || 'No financial context was shared for this agreement.',
      repaymentHistoryConsent: Boolean(borrowerShare?.includes_repayment_history),
    }
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'OpenAI is not configured.' }, 500)
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.6', store: false, instructions: 'You are Bondly’s explainable loan-terms advisor. Do not approve/reject loans, claim someone is trustworthy, create a credit score, or recommend using unshared/private data. Explain only the provided signals. Return only valid JSON with exactly: summary (under 280 chars), risk_factors (array, max 3 short strings), suggested_amount (number not greater than proposed amount), suggested_structure (short string), safeguards (array, max 3 short strings), limitation (short string explicitly noting missing/limited consent data).', input: JSON.stringify(context) }) })
    const result = await response.json()
    if (!response.ok) return json({ error: result.error?.message || 'AI loan review failed.' }, 502)
    const advice = JSON.parse(result.output_text)
    return json({ advice })
  } catch (error) { return json({ error: error.message || 'Unexpected AI loan-review error.' }, 500) }
})
