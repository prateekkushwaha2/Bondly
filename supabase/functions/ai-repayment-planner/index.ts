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
    const { amount, purpose } = await request.json()
    if (!Number(amount) || Number(amount) <= 0) return json({ error: 'A valid requested amount is required.' }, 400)
    const { data: context } = await client.from('financial_contexts').select('*').eq('user_id', user.id).maybeSingle()
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'OpenAI is not configured.' }, 500)
    const structuredContext = context ? { liquidFunds: context.liquid_funds, monthlyIncome: context.monthly_income, monthlyEmi: context.monthly_emi, upcomingObligations: context.upcoming_obligations, emergencyReserve: context.emergency_reserve, essentialReserve: context.essential_fund_reserve } : 'No financial context entered.'
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.6', store: false, instructions: 'You are Bondly’s private repayment-planning assistant. Do not tell users to take a loan, guarantee affordability, or use a credit score. Based only on voluntary context, propose a conservative repayment plan that preserves emergency/essential reserves. Return only valid JSON with exactly: suggested_installments (integer 1 to 12), estimated_monthly_payment (number), summary (under 220 chars), considerations (array of max 3 short strings), limitation (short string).', input: JSON.stringify({ requestedAmount: Number(amount), purpose: purpose || 'Not specified', privateFinancialContext: structuredContext }) }) })
    const result = await response.json()
    if (!response.ok) return json({ error: result.error?.message || 'AI repayment planning failed.' }, 502)
    return json({ advice: JSON.parse(result.output_text) })
  } catch (error) { return json({ error: error.message || 'Unexpected repayment-planning error.' }, 500) }
})
