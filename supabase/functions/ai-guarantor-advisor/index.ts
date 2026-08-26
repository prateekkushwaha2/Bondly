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
    const { data: agreement, error: agreementError } = await client.from('agreements').select('id, borrower_id, guarantor_id, amount, outstanding_amount, due_date, purpose, payment_schedule(status)').eq('id', agreementId).single()
    if (agreementError || !agreement || agreement.guarantor_id !== user.id) return json({ error: 'This guarantee is unavailable.' }, 403)
    const { data: guarantorContext } = await client.from('financial_contexts').select('liquid_funds, monthly_emi, upcoming_obligations, emergency_reserve, essential_fund_reserve').eq('user_id', user.id).maybeSingle()
    const { data: shares } = await client.from('financial_context_shares').select('owner_id, shared_snapshot, includes_repayment_history').eq('agreement_id', agreementId).is('revoked_at', null)
    const borrowerShare = (shares || []).find((share) => share.owner_id === agreement.borrower_id)
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'OpenAI is not configured.' }, 500)
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.6', store: false, instructions: 'You are Bondly’s guarantor-exposure advisor. Do not tell someone to guarantee a loan, label anyone trustworthy, or use unshared data. Explain potential exposure and safeguards using only the supplied data. Return only JSON with: summary (under 240 chars), potential_exposure (number), considerations (array max 3), safeguards (array max 3), limitation (short string).', input: JSON.stringify({ agreement: { amount: agreement.amount, outstanding: agreement.outstanding_amount, dueDate: agreement.due_date, purpose: agreement.purpose }, guarantorPrivateContext: guarantorContext || 'No context entered', borrowerConsentedContext: borrowerShare?.shared_snapshot || 'No borrower summary shared', borrowerHistoryConsent: Boolean(borrowerShare?.includes_repayment_history) }) }) })
    const result = await response.json()
    if (!response.ok) return json({ error: result.error?.message || 'AI guarantor review failed.' }, 502)
    return json({ advice: JSON.parse(result.output_text) })
  } catch (error) { return json({ error: error.message || 'Unexpected guarantor-review error.' }, 500) }
})
