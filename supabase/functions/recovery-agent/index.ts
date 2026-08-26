import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const allowedOptions = new Set(['gentle_reminder', 'extension', 'installment_plan', 'stop_and_review'])

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
      .select('id, amount, outstanding_amount, interest_rate, due_date, purpose, payment_schedule(amount, due_date, status)')
      .eq('id', agreementId).single()
    if (agreementError || !agreement) return json({ error: 'Agreement not found or unavailable.' }, 404)
    const payments = agreement.payment_schedule || []
    const overdue = payments.filter((payment) => payment.status === 'overdue').length
    if (!overdue) return json({ error: 'Recovery guidance is available only for an overdue agreement.' }, 400)

    const apiKey = Deno.env.get('GROQ_API_KEY')
    if (!apiKey) return json({ error: 'Recovery AI is not configured.' }, 500)
    const overduePayments = payments.filter((payment) => payment.status === 'overdue')
    const earliestOverdue = overduePayments.map((payment) => payment.due_date).sort()[0]
    const daysPastDue = earliestOverdue ? Math.max(1, Math.ceil((Date.now() - new Date(`${earliestOverdue}T00:00:00Z`).getTime()) / 86400000)) : 0
    const paidCount = payments.filter((payment) => payment.status === 'paid').length
    const evidence = [`INR ${Number(agreement.outstanding_amount).toLocaleString('en-IN')} currently outstanding`, `${overdue} overdue payment${overdue === 1 ? '' : 's'} recorded`, earliestOverdue ? `Earliest overdue payment is ${daysPastDue} day${daysPastDue === 1 ? '' : 's'} past due` : 'No past-due date available', `${paidCount} payment${paidCount === 1 ? '' : 's'} recorded as paid`]
    const context = { agreement: { purpose: agreement.purpose || 'Not specified', amount: Number(agreement.amount), outstanding_amount: Number(agreement.outstanding_amount), interest_rate: Number(agreement.interest_rate), due_date: agreement.due_date }, payment_history: { scheduled_payments: payments.length, paid_payments: paidCount, overdue_payments: overdue, days_past_due: daysPastDue }, guardrails: { allowed_actions: [...allowedOptions], max_extension_days: 14, max_installments: 2, no_money_movement: true, unanimous_human_approval_required: true } }
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-oss-20b', reasoning_effort: 'low', temperature: 0, max_completion_tokens: 700, response_format: { type: 'json_schema', json_schema: { name: 'recovery_recommendation', strict: true, schema: { type: 'object', properties: { option: { type: 'string' }, summary: { type: 'string' }, rationale: { type: 'string' }, message_draft: { type: 'string' } }, required: ['option', 'summary', 'rationale', 'message_draft'], additionalProperties: false } } }, messages: [
        { role: 'system', content: 'You are Bondly Recovery Agent. Use only supplied facts. Select exactly one action: gentle_reminder, extension, installment_plan, stop_and_review. Select stop_and_review for 3+ overdue payments or insufficient facts. You cannot send money, change terms, contact users, set interest, or approve. Write a concise plain-language summary, rationale, and one respectful message draft under 240 characters. Never threaten, shame, claim certainty, or mention credit scores.' },
        { role: 'user', content: JSON.stringify(context) },
      ] }),
    })
    const result = await response.json()
    if (!response.ok) return json({ error: result.error?.message || 'Recovery model request failed.' }, 502)
    const advice = JSON.parse(result.choices?.[0]?.message?.content || '')
    if (!allowedOptions.has(advice.option) || typeof advice.summary !== 'string' || typeof advice.rationale !== 'string' || typeof advice.message_draft !== 'string') return json({ error: 'Recovery model returned an unsafe or incomplete action.' }, 502)
    const safeAdvice = { option: advice.option, summary: advice.summary.slice(0, 220), rationale: advice.rationale.slice(0, 180), message_draft: advice.message_draft.slice(0, 240), evidence, extension_days: advice.option === 'extension' ? 7 : 0, installments: advice.option === 'installment_plan' ? 2 : 0, confidence: 'medium' }
    await client.from('activity_events').insert({ agreement_id: agreementId, actor_id: user.id, event_type: 'recovery_ai_recommended', metadata: { option: safeAdvice.option, confidence: safeAdvice.confidence, overdue_payments: overdue, model: 'openai/gpt-oss-20b' } })
    return json({ advice: safeAdvice })
  } catch (error) { return json({ error: error.message || 'Unexpected recovery-agent error.' }, 500) }
})
