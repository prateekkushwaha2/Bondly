import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

async function aiReview(apiKey: string, task: string, facts: Record<string, unknown>) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'openai/gpt-oss-20b', reasoning_effort: 'low', temperature: 0, max_completion_tokens: 520, response_format: { type: 'json_schema', json_schema: { name: 'bondly_decision_brief', strict: true, schema: { type: 'object', properties: { summary: { type: 'string' }, factor_one: { type: 'string' }, factor_two: { type: 'string' }, safeguard_one: { type: 'string' }, safeguard_two: { type: 'string' }, question_to_discuss: { type: 'string' } }, required: ['summary', 'factor_one', 'factor_two', 'safeguard_one', 'safeguard_two', 'question_to_discuss'], additionalProperties: false } } }, messages: [{ role: 'system', content: 'You are Bondly Decision Copilot. Use only supplied facts. Give concise neutral decision support. Never predict trustworthiness, approve or decline, claim certainty, mention credit scores, or invent facts. Do not recommend money movement or override the stated guardrails.' }, { role: 'user', content: JSON.stringify({ task, facts }) }] }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error?.message || 'Decision AI request failed.')
  const brief = JSON.parse(result.choices?.[0]?.message?.content || '{}')
  const fields = ['summary', 'factor_one', 'factor_two', 'safeguard_one', 'safeguard_two', 'question_to_discuss']
  if (!fields.every((field) => typeof brief[field] === 'string' && brief[field].trim())) throw new Error('Decision AI returned an incomplete response.')
  return Object.fromEntries(fields.map((field) => [field, brief[field].trim().slice(0, 220)]))
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Missing authorization.' }, 401)
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: userError } = await client.auth.getUser()
    if (userError || !user) return json({ error: 'Invalid session.' }, 401)
    const { action, agreementId, amount, purpose } = await request.json()
    const apiKey = Deno.env.get('GROQ_API_KEY')
    if (!apiKey) return json({ error: 'Decision AI is not configured.' }, 500)

    if (action === 'repayment_plan') {
      const requested = Number(amount)
      if (!Number.isFinite(requested) || requested <= 0) return json({ error: 'Enter a valid requested amount.' }, 400)
      const { data: context, error } = await client.from('financial_contexts').select('liquid_funds, monthly_emi, upcoming_obligations, emergency_reserve, essential_fund_reserve').eq('user_id', user.id).maybeSingle()
      if (error) throw error
      const values = context || { liquid_funds: 0, monthly_emi: 0, upcoming_obligations: 0, emergency_reserve: 0, essential_fund_reserve: 0 }
      const buffer = Math.max(0, Number(values.liquid_funds) - Number(values.monthly_emi) - Number(values.upcoming_obligations) - Number(values.emergency_reserve) - Number(values.essential_fund_reserve))
      const monthlyCap = Math.max(0, Math.floor(Math.min(requested, buffer * 0.5)))
      const installments = Math.min(12, Math.max(1, Math.ceil(requested / (monthlyCap || Math.ceil(requested / 12)))))
      const brief = await aiReview(apiKey, 'Help a borrower discuss a realistic repayment plan. Computed figures are safeguards, not an affordability decision.', { requested_amount: requested, purpose: purpose || 'Not specified', discretionary_buffer: buffer, suggested_installments: installments, estimated_monthly_payment: Math.ceil(requested / installments), private_data_rule: 'Do not repeat exact private financial inputs.' })
      return json({ suggested_installments: installments, estimated_monthly_payment: Math.ceil(requested / installments), summary: brief.summary, considerations: [brief.factor_one, brief.factor_two, `Question to discuss: ${brief.question_to_discuss}`], limitation: 'AI guidance from your voluntary context and requested amount; it is not an affordability decision.' })
    }

    if (!agreementId || !['lender_review', 'guarantor_review'].includes(action)) return json({ error: 'A valid action and agreementId are required.' }, 400)
    const { data: agreement, error: agreementError } = await client.from('agreements').select('id, lender_id, guarantor_id, amount, outstanding_amount, interest_rate, due_date, purpose, status, payment_schedule(amount, due_date, status, paid_at)').eq('id', agreementId).single()
    if (agreementError || !agreement) return json({ error: 'Agreement not found or unavailable.' }, 404)
    if (action === 'lender_review' && agreement.lender_id !== user.id) return json({ error: 'Only the lender can review these terms.' }, 403)
    if (action === 'guarantor_review' && agreement.guarantor_id !== user.id) return json({ error: 'This guarantee is unavailable.' }, 403)
    const payments = agreement.payment_schedule || []
    const facts = { agreement: { amount: Number(agreement.amount), outstanding_amount: Number(agreement.outstanding_amount), interest_rate: Number(agreement.interest_rate), due_date: agreement.due_date, purpose: agreement.purpose || 'Not specified', status: agreement.status }, payment_history: { scheduled: payments.length, paid: payments.filter((p) => p.status === 'paid').length, overdue: payments.filter((p) => p.status === 'overdue').length }, guardrails: { no_auto_approval: true, human_decision_required: true, no_credit_score: true } }
    const brief = await aiReview(apiKey, action === 'lender_review' ? 'Help the lender review existing agreement terms and repayment record.' : 'Help the guarantor understand existing guarantee exposure and questions to discuss.', facts)
    if (action === 'lender_review') {
      const overdue = facts.payment_history.overdue
      return json({ suggested_amount: overdue ? Math.round(Number(agreement.amount) * 0.75) : Number(agreement.amount), summary: brief.summary, risk_factors: [brief.factor_one, brief.factor_two], suggested_structure: `Question to discuss: ${brief.question_to_discuss}`, safeguards: [brief.safeguard_one, brief.safeguard_two], limitation: 'AI decision support from recorded Bondly facts; not a credit decision or guarantee.' })
    }
    return json({ potential_exposure: Number(agreement.outstanding_amount), summary: brief.summary, considerations: [brief.factor_one, brief.factor_two, `Question to discuss: ${brief.question_to_discuss}`], safeguards: [brief.safeguard_one, brief.safeguard_two], limitation: 'AI decision support from recorded Bondly facts; it does not recommend accepting a guarantee.' })
  } catch (error) { return json({ error: error.message || 'Unexpected decision-agent error.' }, 500) }
})
