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
      .select('amount, outstanding_amount, interest_rate, due_date, purpose, status, payment_schedule(due_date, amount, status, paid_at)')
      .eq('id', agreementId).single()
    if (agreementError || !agreement) return json({ error: 'Agreement not found or unavailable.' }, 404)
    const payments = agreement.payment_schedule || []
    const paidCount = payments.filter((payment) => payment.status === 'paid').length
    const lateCount = payments.filter((payment) => payment.status === 'overdue').length
    const prompt = {
      agreement: { amount: agreement.amount, outstandingAmount: agreement.outstanding_amount, interestRate: agreement.interest_rate, dueDate: agreement.due_date, purpose: agreement.purpose, status: agreement.status },
      repaymentHistory: { scheduledPayments: payments.length, paidPayments: paidCount, overduePayments: lateCount },
    }
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'OpenAI is not configured.' }, 500)
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.6',
        store: false,
        instructions: 'You are Bondly’s fair-resolution advisor. You do not decide, promise, transfer money, determine creditworthiness, or set interest. Based only on the provided agreement data, recommend one: gentle_reminder, extension, or installment_plan. Return only valid JSON with exactly: summary (plain-language string under 280 characters), option (one of those values), extension_days (number or 0), installments (number or 0), rationale (string under 180 characters). Be empathetic and neutral.',
        input: JSON.stringify(prompt),
      }),
    })
    const result = await response.json()
    if (!response.ok) return json({ error: result.error?.message || 'AI advisor request failed.' }, 502)
    const outputText = result.output_text
    const advice = JSON.parse(outputText)
    if (!['gentle_reminder', 'extension', 'installment_plan'].includes(advice.option)) throw new Error('AI returned an unsupported recommendation.')
    return json({ advice })
  } catch (error) { return json({ error: error.message || 'Unexpected AI advisor error.' }, 500) }
})
