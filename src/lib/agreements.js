import { supabase } from './supabase'

export async function getMyProfile() {
  if (!supabase) return null
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) return null
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
  if (error) throw error
  if (data) return data
  const { data: created, error: createError } = await supabase.from('profiles').insert({
    id: user.id,
    full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Bondly member',
    primary_role: user.user_metadata?.primary_role || 'borrower',
  }).select().single()
  if (createError) throw createError
  return created
}

export async function updateMyProfileName(fullName) {
  const profile = await getMyProfile()
  if (!profile) throw new Error('You must be signed in.')
  const { error } = await supabase.from('profiles').update({ full_name: fullName.trim() }).eq('id', profile.id)
  if (error) throw error
}

export async function getMyAgreements(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('agreements')
    .select('id, lender_id, borrower_id, guarantor_id, amount, outstanding_amount, due_date, interest_rate, purpose, status, lender:profiles!agreements_lender_id_fkey(full_name), borrower:profiles!agreements_borrower_id_fkey(full_name), guarantor:profiles!agreements_guarantor_id_fkey(full_name), payment_schedule(due_date, amount, status)')
    .or(`lender_id.eq.${userId},borrower_id.eq.${userId},guarantor_id.eq.${userId}`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getPendingApprovals(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('approvals')
    .select('id, agreement_id, agreement_version, agreements(id, amount, interest_rate, due_date, purpose, lender:profiles!agreements_lender_id_fkey(full_name))')
    .eq('approver_id', userId)
    .eq('status', 'pending')
    .order('id')
  if (error) throw error
  return data
}

export async function decideApproval(approvalId, decision) {
  if (!supabase) return
  const { error } = await supabase.from('approvals').update({ status: decision, approved_at: decision === 'approved' ? new Date().toISOString() : null }).eq('id', approvalId)
  if (error) throw error
}

export async function getDuePayments(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('payment_schedule')
    .select('id, due_date, amount, status, agreement:agreements!payment_schedule_agreement_id_fkey(id, purpose, lender_id, borrower_id, lender:profiles!agreements_lender_id_fkey(full_name), borrower:profiles!agreements_borrower_id_fkey(full_name))')
    .in('status', ['scheduled', 'overdue'])
    .order('due_date')
  if (error) throw error
  return data.filter((payment) => payment.agreement && [payment.agreement.lender_id, payment.agreement.borrower_id].includes(userId))
}

export async function openResolutionCase({ agreementId, aiSummary, proposedTerms }) {
  const profile = await getMyProfile()
  if (!profile) throw new Error('You must be signed in to open a resolution case.')
  const { data: agreement, error: agreementError } = await supabase.from('agreements').select('lender_id, borrower_id, guarantor_id').eq('id', agreementId).single()
  if (agreementError) throw agreementError
  const { data: resolutionCase, error } = await supabase.from('resolution_cases').insert({
    agreement_id: agreementId,
    opened_by: profile.id,
    status: 'proposed',
    ai_summary: aiSummary,
    proposed_terms: proposedTerms,
  }).select().single()
  if (error) throw error
  const voterIds = [agreement.lender_id, agreement.borrower_id, agreement.guarantor_id].filter(Boolean)
  const { error: voteError } = await supabase.from('resolution_case_votes').insert(voterIds.map((voterId) => ({ case_id: resolutionCase.id, voter_id: voterId, decision: voterId === profile.id ? 'approved' : 'pending', decided_at: voterId === profile.id ? new Date().toISOString() : null })))
  if (voteError) throw voteError
  await supabase.from('activity_events').insert({
    agreement_id: agreementId,
    actor_id: profile.id,
    event_type: 'ai_resolution_proposed',
    metadata: proposedTerms,
  })
}

export async function getPendingResolutionVotes(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase.from('resolution_case_votes')
    .select('id, resolution_case:resolution_cases!resolution_case_votes_case_id_fkey(id, ai_summary, proposed_terms, agreement:agreements!resolution_cases_agreement_id_fkey(purpose, lender:profiles!agreements_lender_id_fkey(full_name)))')
    .eq('voter_id', userId).eq('decision', 'pending')
  if (error) throw error
  return data
}

export async function decideResolutionVote(voteId, decision) {
  if (!supabase) return
  const { error } = await supabase.from('resolution_case_votes').update({ decision, decided_at: new Date().toISOString() }).eq('id', voteId)
  if (error) throw error
}

export async function createReagreementProposal({ agreementId, dueDate, interestRate, paymentAmount, note }) {
  const profile = await getMyProfile()
  if (!profile) throw new Error('You must be signed in to propose new terms.')
  const { data: agreement, error: agreementError } = await supabase.from('agreements').select('version, lender_id, borrower_id, guarantor_id').eq('id', agreementId).single()
  if (agreementError) throw agreementError
  const { data: proposal, error } = await supabase.from('reagreement_proposals').insert({ agreement_id: agreementId, proposed_by: profile.id, base_version: agreement.version, proposed_due_date: dueDate || null, proposed_interest_rate: interestRate === '' ? null : Number(interestRate), proposed_payment_amount: paymentAmount === '' ? null : Number(paymentAmount), note: note || null }).select().single()
  if (error) throw error
  const voterIds = [agreement.lender_id, agreement.borrower_id, agreement.guarantor_id].filter(Boolean)
  const { error: voteError } = await supabase.from('reagreement_votes').insert(voterIds.map((voterId) => ({ proposal_id: proposal.id, voter_id: voterId, decision: voterId === profile.id ? 'approved' : 'pending', decided_at: voterId === profile.id ? new Date().toISOString() : null })))
  if (voteError) throw voteError
  await createParticipantNotifications({ agreementId, recipientIds: voterIds.filter((id) => id !== profile.id), type: 'reagreement_proposal', title: 'Re-agreement needs your approval', body: 'A participant proposed revised repayment terms. Review and approve or decline.' })
}

export async function getPendingReagreementVotes(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase.from('reagreement_votes').select('id, reagreement_proposal:reagreement_proposals!reagreement_votes_proposal_id_fkey(id, proposed_due_date, proposed_interest_rate, proposed_payment_amount, note, agreement:agreements!reagreement_proposals_agreement_id_fkey(purpose))').eq('voter_id', userId).eq('decision', 'pending')
  if (error) throw error
  return data
}

export async function decideReagreementVote(voteId, decision) {
  const { error } = await supabase.from('reagreement_votes').update({ decision, decided_at: new Date().toISOString() }).eq('id', voteId)
  if (error) throw error
}

export async function getMyNotifications(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase.from('notifications')
    .select('id, title, body, notification_type, read_at, created_at, agreement_id')
    .eq('recipient_id', userId).order('created_at', { ascending: false }).limit(30)
  if (error) throw error
  return data
}

export async function markNotificationRead(notificationId) {
  if (!supabase) return
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notificationId)
  if (error) throw error
}

export async function createParticipantNotifications({ agreementId, recipientIds, type, title, body }) {
  if (!supabase || !recipientIds.length) return
  const { error } = await supabase.from('notifications').insert(recipientIds.map((recipientId) => ({ recipient_id: recipientId, agreement_id: agreementId, notification_type: type, title, body })))
  if (error) throw error
}

export async function createAgreement({ borrowerId, guarantorId, amount, dueDate, interestRate, purpose, repaymentType = 'one_time' }) {
  const profile = await getMyProfile()
  if (!profile) throw new Error('You must be signed in to create an agreement.')
  const { data: agreement, error } = await supabase
    .from('agreements')
    .insert({ lender_id: profile.id, borrower_id: borrowerId, guarantor_id: guarantorId || null, amount, outstanding_amount: amount, due_date: dueDate, interest_rate: interestRate, purpose, repayment_type: repaymentType, status: 'pending_approval' })
    .select()
    .single()
  if (error) throw error
  const approverIds = [profile.id, borrowerId, guarantorId].filter(Boolean)
  const { error: approvalError } = await supabase.from('approvals').insert(approverIds.map((approverId) => ({ agreement_id: agreement.id, approver_id: approverId, agreement_version: agreement.version, status: approverId === profile.id ? 'approved' : 'pending', approved_at: approverId === profile.id ? new Date().toISOString() : null })))
  if (approvalError) throw approvalError
  const { error: scheduleError } = await supabase.from('payment_schedule').insert({ agreement_id: agreement.id, installment_number: 1, due_date: dueDate, amount })
  if (scheduleError) throw scheduleError
  await supabase.from('activity_events').insert({ agreement_id: agreement.id, actor_id: profile.id, event_type: 'agreement_created', metadata: { purpose, amount } })
  await createParticipantNotifications({ agreementId: agreement.id, recipientIds: [borrowerId, guarantorId].filter(Boolean), type: 'agreement_invite', title: 'New agreement awaiting approval', body: `You have been invited to review a INR ${Number(amount).toLocaleString('en-IN')} Bondly agreement.` })
  return agreement
}
