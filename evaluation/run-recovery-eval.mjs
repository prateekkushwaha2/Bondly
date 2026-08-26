// Evaluation-only synthetic cases. This file is never imported by the customer app.
// Run with a temporary GROQ_API_KEY: npm run eval:recovery
import { mkdir, writeFile } from 'node:fs/promises'

const model = 'openai/gpt-oss-20b'
if (!process.env.GROQ_API_KEY) throw new Error('Set GROQ_API_KEY temporarily before running this evaluation.')

// Held-out, synthetic reviewer-labelled scenarios. Never sent to Supabase.
const cases = Array.from({ length: 60 }, (_, index) => {
  const overdue = index % 10 < 2 ? 0 : index % 10 < 5 ? 1 : index % 10 < 8 ? 2 : 3
  const daysPastDue = overdue === 0 ? 0 : 2 + ((index * 3) % 21)
  const expected = overdue >= 3 ? 'stop_and_review' : overdue === 2 ? 'installment_plan' : overdue === 1 && daysPastDue > 7 ? 'extension' : 'gentle_reminder'
  const amount = 1500 + ((index * 1375) % 18000)
  return { id: `EVAL-${String(index + 1).padStart(2, '0')}`, outstanding_amount: amount, interest_rate: index % 3 === 0 ? 12 : 0, scheduled_payments: 1 + (index % 4), paid_payments: index % 5, overdue_payments: overdue, days_past_due: daysPastDue, expected, recoverable_amount: expected === 'stop_and_review' ? 0 : amount }
})

const choices = ['gentle_reminder', 'extension', 'installment_plan', 'stop_and_review']
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
async function evaluateBatch(records) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body: JSON.stringify({ model, reasoning_effort: 'low', temperature: 0, max_completion_tokens: 320, response_format: { type: 'json_schema', json_schema: { name: 'evaluation_actions', strict: true, schema: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, option: { type: 'string', enum: choices } }, required: ['id', 'option'], additionalProperties: false } } }, required: ['results'], additionalProperties: false } } }, messages: [{ role: 'system', content: 'For every supplied record, choose exactly one bounded recovery action. Use stop_and_review for 3+ overdue payments, installment_plan for 2, and for 1 overdue payment use gentle_reminder at 7 or fewer days past due otherwise extension. For 0 overdue choose gentle_reminder. Return one result for every input id.' }, { role: 'user', content: JSON.stringify({ records }) }] }) })
    const payload = await response.json()
    if (response.ok) {
      const output = JSON.parse(payload.choices?.[0]?.message?.content || '{}').results || []
      const byId = new Map(output.map((item) => [item.id, item.option]))
      return records.map((record) => {
        const option = byId.get(record.id)
        if (!choices.includes(option)) throw new Error(`Invalid or missing option for ${record.id}`)
        return { ...record, actual: option }
      })
    }
    if (response.status !== 429 || attempt === 3) throw new Error(`Groq returned ${response.status}: ${payload.error?.message || 'rate limit reached'}`)
    const retryAfter = Number(response.headers.get('retry-after'))
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 8000 * (attempt + 1)
    console.log(`Groq rate limit reached; waiting ${Math.ceil(waitMs / 1000)} seconds before retrying…`)
    await pause(waitMs)
  }
}

const results = []
for (let start = 0; start < cases.length; start += 10) {
  const batch = cases.slice(start, start + 10)
  console.log(`Evaluating records ${start + 1}-${start + batch.length} of ${cases.length}…`)
  results.push(...await evaluateBatch(batch))
  if (start + 10 < cases.length) await pause(1200)
}
const correct = results.filter((item) => item.actual === item.expected)
const tp = results.filter((item) => item.actual !== 'stop_and_review' && item.expected !== 'stop_and_review').length
const fp = results.filter((item) => item.actual !== 'stop_and_review' && item.expected === 'stop_and_review').length
const fn = results.filter((item) => item.actual === 'stop_and_review' && item.expected !== 'stop_and_review').length
const simulatedRecovered = results.filter((item) => item.actual === item.expected && item.expected !== 'stop_and_review').reduce((sum, item) => sum + item.recoverable_amount, 0)
const eligibleValue = results.reduce((sum, item) => sum + item.recoverable_amount, 0)
const falsePositiveExposure = results.filter((item) => item.actual !== 'stop_and_review' && item.expected === 'stop_and_review').reduce((sum, item) => sum + item.outstanding_amount, 0)
const missedRecoveryValue = results.filter((item) => item.actual === 'stop_and_review' && item.expected !== 'stop_and_review').reduce((sum, item) => sum + item.recoverable_amount, 0)
const report = { generated_at: new Date().toISOString(), model, dataset: { cases: results.length, synthetic: true, customer_data_used: false }, metrics: { exact_action_accuracy: Number((correct.length / results.length).toFixed(4)), intervention_precision: Number((tp / Math.max(1, tp + fp)).toFixed(4)), intervention_recall: Number((tp / Math.max(1, tp + fn)).toFixed(4)), false_positive_interventions: fp, false_positive_exposure_inr: falsePositiveExposure, missed_recovery_opportunities: fn, missed_recovery_value_inr: missedRecoveryValue, eligible_recovery_value_inr: eligibleValue, simulated_recovered_inr: simulatedRecovered }, exceptions: results.filter((item) => item.actual !== item.expected).map(({ id, expected, actual, overdue_payments, days_past_due }) => ({ id, expected, actual, overdue_payments, days_past_due })) }

await mkdir('evaluation/results', { recursive: true })
await writeFile('evaluation/results/latest-recovery-report.json', `${JSON.stringify(report, null, 2)}\n`)
console.table([{ cases: report.dataset.cases, exact_action_accuracy: `${Math.round(report.metrics.exact_action_accuracy * 100)}%`, intervention_precision: `${Math.round(report.metrics.intervention_precision * 100)}%`, intervention_recall: `${Math.round(report.metrics.intervention_recall * 100)}%`, false_positive_interventions: fp, false_positive_exposure_inr: falsePositiveExposure, missed_recovery_value_inr: missedRecoveryValue, simulated_recovered_inr: simulatedRecovered }])
console.table(report.exceptions)
console.log('Saved evidence to evaluation/results/latest-recovery-report.json')
