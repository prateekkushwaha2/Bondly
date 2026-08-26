import { supabase } from './supabase'

async function invokeAi(functionName, body) {
  if (!supabase) throw new Error('Connect Supabase to use AI guidance.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again to use AI guidance.')
  const { data, error } = await supabase.functions.invoke(functionName, { body, headers: { Authorization: `Bearer ${session.access_token}` } })
  if (error || data?.error) throw new Error(data?.error || error.message)
  return data
}

export async function getResolutionAdvice(agreementId) {
  const data = await invokeAi('recovery-agent', { agreementId })
  return data.advice
}

export const getLoanAdvice = (agreementId) => invokeAi('decision-agent', { action: 'lender_review', agreementId })
export const getGuarantorAdvice = (agreementId) => invokeAi('decision-agent', { action: 'guarantor_review', agreementId })
export const getRepaymentPlan = (amount, purpose) => invokeAi('decision-agent', { action: 'repayment_plan', amount, purpose })
