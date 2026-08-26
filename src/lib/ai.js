import { supabase } from './supabase'
import { calculateFinancialHealth } from './financialHealth'

// Free deterministic guidance based only on live, permission-checked Bondly records.
async function currentUser() {
  if (!supabase) throw new Error('Connect Supabase to use guidance.')
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new Error('Please sign in again to use guidance.')
  return user
}

async function agreementForUser(agreementId) {
  const { data, error } = await supabase.from('agreements').select('id, lender_id, borrower_id, guarantor_id, amount, outstanding_amount, interest_rate, due_date, purpose, payment_schedule(amount, due_date, status)').eq('id', agreementId).single()
  if (error || !data) throw new Error('Agreement not found or unavailable.')
  return data
}

export async function getResolutionAdvice(agreementId) {
  await currentUser()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again to use recovery AI.')
  const { data, error } = await supabase.functions.invoke('recovery-agent', { body: { agreementId }, headers: { Authorization: `Bearer ${session.access_token}` } })
  if (error || data?.error) throw new Error(data?.error || error.message)
  return data.advice
}

export async function getLoanAdvice(agreementId) {
  const user = await currentUser()
  const agreement = await agreementForUser(agreementId)
  if (agreement.lender_id !== user.id) throw new Error('Only the lender can review these terms.')
  const overdue = (agreement.payment_schedule || []).filter((payment) => payment.status === 'overdue').length
  return { summary: overdue ? 'Existing overdue payments suggest reducing exposure or using installments before extending further credit.' : 'No overdue payment is recorded. Keep the written due date and payment schedule visible to all participants.', risk_factors: overdue ? [`${overdue} overdue payment${overdue === 1 ? '' : 's'} recorded`, 'Outstanding amount remains unpaid'] : ['No overdue payment recorded', 'Repayment outcome still depends on future payments'], suggested_amount: overdue ? Math.round(Number(agreement.amount) * 0.75) : Number(agreement.amount), suggested_structure: overdue ? 'Use installments or a shorter review period.' : 'Use the current written due date and payment schedule.', safeguards: ['Require unanimous approval for changed terms', 'Record each payment through the verified ledger', 'Do not use unshared financial information'], limitation: 'Rule-based guidance from Bondly records; not a credit decision or affordability guarantee.' }
}

export async function getRepaymentPlan(amount) {
  const user = await currentUser()
  if (!Number(amount) || Number(amount) <= 0) throw new Error('Enter a valid requested amount.')
  const { data: context, error } = await supabase.from('financial_contexts').select('*').eq('user_id', user.id).maybeSingle()
  if (error) throw error
  const health = calculateFinancialHealth(context || {})
  const maximumPayment = Math.max(0, Math.floor(Math.min(Number(amount), health.discretionaryBuffer * 0.5)))
  const payment = maximumPayment || Math.ceil(Number(amount) / 12)
  const installments = Math.min(12, Math.max(1, Math.ceil(Number(amount) / payment)))
  return { suggested_installments: installments, estimated_monthly_payment: Math.ceil(Number(amount) / installments), summary: health.discretionaryBuffer > 0 ? 'This plan keeps half of the recorded discretionary buffer uncommitted each month.' : 'Protected funds leave no discretionary buffer. This is a maximum 12-part illustration, not an affordability recommendation.', considerations: health.discretionaryBuffer > 0 ? ['Keep emergency and essential reserves untouched', 'Review if income or obligations change'] : ['Consider a smaller amount or later date', 'Update your financial context before agreeing'], limitation: 'Local calculation from values you entered; it does not access bank data or make a lending decision.' }
}

export async function getGuarantorAdvice(agreementId) {
  const user = await currentUser()
  const agreement = await agreementForUser(agreementId)
  if (agreement.guarantor_id !== user.id) throw new Error('This guarantee is unavailable.')
  const { data: context, error } = await supabase.from('financial_contexts').select('*').eq('user_id', user.id).maybeSingle()
  if (error) throw error
  const health = calculateFinancialHealth(context || {})
  const exposure = Number(agreement.outstanding_amount)
  return { summary: health.discretionaryBuffer >= exposure ? 'Your recorded discretionary buffer covers the current outstanding amount, but a guarantee remains a real obligation.' : 'Your recorded discretionary buffer does not cover the current outstanding amount. Consider reducing exposure or declining the guarantee.', potential_exposure: exposure, considerations: ['Exposure is limited here to the current outstanding amount', `Recorded discretionary buffer: ₹${health.discretionaryBuffer.toLocaleString('en-IN')}`], safeguards: ['Keep guarantee terms written and visible', 'Request early notice of missed payments', 'Do not use protected reserves for a guarantee'], limitation: 'Rule-based guidance from your voluntary financial context, not a guarantee recommendation.' }
}
