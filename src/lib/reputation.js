import { supabase } from './supabase'

async function invoke(body) {
  if (!supabase) throw new Error('Connect Supabase to use reputation profiles.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in to use reputation profiles.')
  const { data, error } = await supabase.functions.invoke('reputation-agent', { body, headers: { Authorization: `Bearer ${session.access_token}` } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data.profile
}

export const refreshMyReputationProfile = () => invoke({ action: 'refresh' })
export const setMyReputationVisibility = (isPublic) => invoke({ action: 'set_visibility', isPublic })

export async function getMyReputationProfile(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase.from('reputation_profiles').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

export async function searchReputationProfiles(term) {
  if (!supabase) return []
  const query = term.trim()
  if (query.length < 2) return []
  const { data, error } = await supabase.from('reputation_profiles').select('user_id, display_name, role_badges, total_agreements, completed_agreements, scheduled_payments, paid_payments, overdue_payments, on_time_paid_payments, ai_summary, methodology, generated_at').eq('is_public', true).ilike('display_name', `%${query}%`).order('generated_at', { ascending: false }).limit(12)
  if (error) throw error
  return data || []
}
