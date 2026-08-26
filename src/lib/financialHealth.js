import { supabase } from './supabase'

export function calculateFinancialHealth(context = {}) {
  const liquidFunds = Number(context.liquid_funds || 0)
  const emergencyReserve = Number(context.emergency_reserve || 0)
  const essentialReserve = Number(context.essential_fund_reserve || 0)
  const upcomingObligations = Number(context.upcoming_obligations || 0)
  const monthlyEmi = Number(context.monthly_emi || 0)
  const protectedFunds = emergencyReserve + essentialReserve + upcomingObligations + monthlyEmi
  const discretionaryBuffer = liquidFunds - protectedFunds
  const status = discretionaryBuffer >= 0 ? (discretionaryBuffer >= liquidFunds * 0.2 ? 'Healthy' : 'Tight') : 'At risk'
  return { liquidFunds, emergencyReserve, essentialReserve, upcomingObligations, monthlyEmi, protectedFunds, discretionaryBuffer, status }
}

export async function getMyFinancialContext(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase.from('financial_contexts').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

export async function saveMyFinancialContext(userId, values) {
  const record = { user_id: userId, ...values, updated_at: new Date().toISOString() }
  const { error } = await supabase.from('financial_contexts').upsert(record, { onConflict: 'user_id' })
  if (error) throw error
}

export async function shareFinancialSummary({ userId, agreementId, health, shareLiquidity, shareObligations, shareRepayment }) {
  const shared_snapshot = {
    liquidity_health: shareLiquidity ? health.status : undefined,
    discretionary_buffer_range: shareLiquidity ? (health.discretionaryBuffer < 0 ? 'negative' : health.discretionaryBuffer < 10000 ? 'under_10k' : health.discretionaryBuffer < 30000 ? '10k_to_30k' : 'over_30k') : undefined,
    upcoming_obligations: shareObligations ? health.upcomingObligations : undefined,
    monthly_emi: shareObligations ? health.monthlyEmi : undefined,
  }
  Object.keys(shared_snapshot).forEach((key) => shared_snapshot[key] === undefined && delete shared_snapshot[key])
  if (!Object.keys(shared_snapshot).length && !shareRepayment) throw new Error('Choose at least one summary to share.')
  const { error } = await supabase.from('financial_context_shares').upsert({ owner_id: userId, agreement_id: agreementId, shared_snapshot, includes_repayment_history: shareRepayment, revoked_at: null }, { onConflict: 'owner_id,agreement_id' })
  if (error) throw error
}

export async function getSharedFinancialSummaries(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase.from('financial_context_shares')
    .select('id, agreement_id, owner_id, shared_snapshot, includes_repayment_history, created_at, owner:profiles!financial_context_shares_owner_id_fkey(full_name)')
    .is('revoked_at', null)
  if (error) throw error
  return data
}
