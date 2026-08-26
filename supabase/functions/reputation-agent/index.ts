import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

async function createSnapshot(admin: ReturnType<typeof createClient>, userId: string) {
  let { data: person, error: personError } = await admin.from('profiles').select('full_name, created_at').eq('id', userId).maybeSingle()
  if (personError) throw personError
  if (!person) {
    const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId)
    if (authError || !authUser.user) throw new Error('Unable to create the missing profile record.')
    const requestedRole = authUser.user.user_metadata?.primary_role
    const primaryRole = ['lender', 'borrower', 'guarantor'].includes(requestedRole) ? requestedRole : 'borrower'
    const { data: created, error: createError } = await admin.from('profiles').insert({
      id: userId,
      full_name: authUser.user.user_metadata?.full_name || authUser.user.email?.split('@')[0] || 'Bondly member',
      primary_role: primaryRole,
    }).select('full_name, created_at').single()
    if (createError || !created) throw new Error('Unable to create the missing profile record.')
    person = created
  }
  const { data: agreements, error: agreementError } = await admin.from('agreements').select('id, lender_id, borrower_id, guarantor_id, status').or(`lender_id.eq.${userId},borrower_id.eq.${userId},guarantor_id.eq.${userId}`)
  if (agreementError) throw agreementError
  const ids = (agreements || []).map((agreement) => agreement.id)
  const { data: payments, error: paymentError } = ids.length ? await admin.from('payment_schedule').select('status, due_date, paid_at').in('agreement_id', ids) : { data: [], error: null }
  if (paymentError) throw paymentError
  const roles = new Set<string>()
  for (const agreement of agreements || []) {
    if (agreement.lender_id === userId) roles.add('lender')
    if (agreement.borrower_id === userId) roles.add('borrower')
    if (agreement.guarantor_id === userId) roles.add('guarantor')
  }
  const allPayments = payments || []
  const paid = allPayments.filter((payment) => payment.status === 'paid')
  const onTime = paid.filter((payment) => payment.paid_at && new Date(payment.paid_at).getTime() <= new Date(`${payment.due_date}T23:59:59Z`).getTime())
  const stats = {
    total_agreements: ids.length,
    completed_agreements: (agreements || []).filter((agreement) => agreement.status === 'completed').length,
    scheduled_payments: allPayments.length,
    paid_payments: paid.length,
    overdue_payments: allPayments.filter((payment) => payment.status === 'overdue').length,
    on_time_paid_payments: onTime.length,
  }
  const roleBreakdown = Object.fromEntries(['borrower', 'lender', 'guarantor'].map((role) => {
    const roleAgreements = (agreements || []).filter((agreement) => agreement[`${role}_id`] === userId)
    return [role, { agreement_count: roleAgreements.length, completed_count: roleAgreements.filter((agreement) => agreement.status === 'completed').length, active_or_overdue_count: roleAgreements.filter((agreement) => ['active', 'overdue'].includes(agreement.status)).length }]
  }))
  const context = { roles: [...roles], stats, role_breakdown: roleBreakdown, member_since: person.created_at.slice(0, 10), rules: 'Use only supplied facts. Never predict trustworthiness, assign a score, recommend lending, mention money amounts, private data, or facts not supplied. Write neutral considerations and a question that helps a human decide.' }
  let aiSummary = `Bondly record: ${stats.total_agreements} agreement${stats.total_agreements === 1 ? '' : 's'} across ${roles.size || 0} role${roles.size === 1 ? '' : 's'}, with ${stats.paid_payments} recorded payment${stats.paid_payments === 1 ? '' : 's'}. This is an opt-in activity summary, not a credit score or guarantee.`
  let considerations = ['Review the recorded payment history alongside the proposed terms.', 'Discuss repayment timing and agree on a written plan before committing.']
  let question = 'What repayment plan would feel realistic if circumstances change?'
  const key = Deno.env.get('GROQ_API_KEY')
  if (key) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'openai/gpt-oss-20b', reasoning_effort: 'low', temperature: 0, max_completion_tokens: 420, response_format: { type: 'json_schema', json_schema: { name: 'reputation_summary', strict: true, schema: { type: 'object', properties: { summary: { type: 'string' }, consideration_one: { type: 'string' }, consideration_two: { type: 'string' }, question_to_ask: { type: 'string' } }, required: ['summary', 'consideration_one', 'consideration_two', 'question_to_ask'], additionalProperties: false } } }, messages: [{ role: 'system', content: 'You write safe factual financial-activity decision support.' }, { role: 'user', content: JSON.stringify(context) }] }) })
    const result = await response.json()
    if (response.ok) {
      const generated = JSON.parse(result.choices?.[0]?.message?.content || '{}')
      if (typeof generated.summary === 'string' && generated.summary.trim()) aiSummary = generated.summary.trim().slice(0, 360)
      if (typeof generated.consideration_one === 'string' && typeof generated.consideration_two === 'string') considerations = [generated.consideration_one.slice(0, 180), generated.consideration_two.slice(0, 180)]
      if (typeof generated.question_to_ask === 'string' && generated.question_to_ask.trim()) question = generated.question_to_ask.trim().slice(0, 180)
    }
  }
  const joinedDate = new Date(person.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const facts = `PROFILE FACTS\nJoined Bondly: ${joinedDate}\nRoles recorded: ${roles.size ? [...roles].join(', ') : 'No agreement role recorded yet'}\nAgreements: ${stats.total_agreements} total · ${stats.completed_agreements} completed\nPayments: ${stats.on_time_paid_payments}/${stats.paid_payments} recorded on time · ${stats.overdue_payments} currently overdue`
  const decisionText = `AI DECISION LENS\n${aiSummary}\nConsider: ${considerations.join(' ')}\nQuestion to discuss: ${question}`.slice(0, 720)
  const decisionSummary = `${facts}\n\n${decisionText}\n\nBondly Member Invite ID: ${userId}`
  return { user_id: userId, display_name: person.full_name, role_badges: [...roles], ...stats, role_breakdown: roleBreakdown, ai_summary: decisionSummary, ai_considerations: considerations, ai_question: question, methodology: { source: 'Recorded Bondly agreements and payment schedule only', excludes: ['bank balance', 'income', 'phone', 'private notes', 'disputes'], disclaimer: 'Not a credit score, identity verification, or guarantee of future behaviour.' }, generated_at: new Date().toISOString(), updated_at: new Date().toISOString() }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Missing authorization.' }, 401)
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error } = await userClient.auth.getUser()
    if (error || !user) return json({ error: 'Invalid session.' }, 401)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { action, isPublic } = await request.json()
    if (action === 'refresh') {
      const snapshot = await createSnapshot(admin, user.id)
      const { data: prior } = await admin.from('reputation_profiles').select('is_public').eq('user_id', user.id).maybeSingle()
      const { data, error: saveError } = await admin.from('reputation_profiles').upsert({ ...snapshot, is_public: prior?.is_public || false }, { onConflict: 'user_id' }).select().single()
      if (saveError) throw saveError
      return json({ profile: data })
    }
    if (action === 'set_visibility') {
      if (typeof isPublic !== 'boolean') return json({ error: 'isPublic must be true or false.' }, 400)
      const { data, error: saveError } = await admin.from('reputation_profiles').update({ is_public: isPublic, updated_at: new Date().toISOString() }).eq('user_id', user.id).select().single()
      if (saveError || !data) return json({ error: 'Generate your profile before changing visibility.' }, 400)
      return json({ profile: data })
    }
    return json({ error: 'Unsupported action.' }, 400)
  } catch (error) { return json({ error: error.message || 'Unexpected reputation-agent error.' }, 500) }
})
